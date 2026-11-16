"""
T-0118 — `total_shipments` do ML: conector -> transform -> upsert, e o backfill.

O "não entregue" do ML passa a dividir por ENVIOS (gold.total_shipments), não
por pedidos pagos. Este arquivo prova o caminho do dado até a fato:

  * a QUERY do conector traz `g.total_shipments`;
  * o transform leva a chave, e ausente vira None (nunca 0);
  * o upsert do ML escolhe o SQL pela FORMA de cada registro, e um lote misto
    (com e sem a chave) não apaga o valor de quem veio sem ela — em dublê e,
    quando há PostgreSQL descartável, no servidor de verdade;
  * `sync_ml_total_shipments`: dry-run não grava, apply só faz UPDATE (nunca
    INSERT na fato), marca sem loja é ignorada com contagem.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date

import pytest
from sqlalchemy import create_engine, text

from pipelines import sync_ml_total_shipments as bf
from pipelines.connectors.mercadolivre import connector as ml_connector
from pipelines.ingestion import daily_performance as dp
from pipelines.tests.banco_descartavel import DDL as MARTS_DDL
from pipelines.tests.postgres_descartavel import (
    MOTIVO_SEM_POSTGRES,
    cluster_descartavel,
    postgres_disponivel,
)
from pipelines.transforms import ml_gestao_diaria

D1, D2 = date(2026, 10, 10), date(2026, 10, 11)


def _linha_gold(**over) -> dict:
    row = {
        "date": D1, "brand": "kokeshi", "gmv": 1000.0, "orders": 10,
        "units_sold": 12, "canceled_orders": 1, "delivered_orders": 7,
        "total_shipments": 8, "marketplace_fee": 170.0, "fee_orders": 10,
    }
    row.update(over)
    return row


# ---------------------------------------------------------------------------
# Conector
# ---------------------------------------------------------------------------

def test_query_do_conector_traz_total_shipments_da_gold():
    sql = " ".join(ml_connector.QUERY.split())
    assert "g.total_shipments," in sql
    # o numerador continua vindo da mesma linha da gold
    assert "g.delivered_shipments AS delivered_orders" in sql


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------

def test_transform_leva_total_shipments():
    out = ml_gestao_diaria.transform(_linha_gold(total_shipments=8))
    assert out["total_shipments"] == 8
    assert out["delivered_orders"] == 7


def test_transform_ausente_vira_none_nunca_zero():
    linha = _linha_gold()
    del linha["total_shipments"]
    assert ml_gestao_diaria.transform(linha)["total_shipments"] is None
    assert ml_gestao_diaria.transform(_linha_gold(total_shipments=None))["total_shipments"] is None


def test_transform_zero_medido_continua_zero():
    assert ml_gestao_diaria.transform(_linha_gold(total_shipments=0))["total_shipments"] == 0


# ---------------------------------------------------------------------------
# Upsert — texto e escolha por forma
# ---------------------------------------------------------------------------

def _sem_espacos(sql) -> str:
    return " ".join(str(sql).split())


def test_upsert_ml_inclui_a_coluna_no_insert_e_no_update():
    s = _sem_espacos(dp.UPSERT_ML_SQL)
    assert "source_updated_at, total_shipments ) VALUES (" in s
    assert ":source_updated_at, :total_shipments )" in s
    assert "total_shipments = EXCLUDED.total_shipments" in s


def test_upsert_compartilhado_nao_cita_a_coluna():
    """TikTok e o caminho antigo nao podem depender da migration 047."""
    assert "total_shipments" not in str(dp.UPSERT_SQL)
    assert "total_shipments" not in str(dp.UPSERT_TIKTOK_SQL)


def test_sql_do_ml_escolhe_pela_forma_do_registro():
    com = {"total_shipments": 5}
    com_none = {"total_shipments": None}
    sem = {}
    assert dp.sql_do_ml(com) is dp.UPSERT_ML_SQL
    assert dp.sql_do_ml(com_none) is dp.UPSERT_ML_SQL
    assert dp.sql_do_ml(sem) is dp.UPSERT_SQL


class _SessaoRegistradora:
    def __init__(self):
        self.execucoes: list[tuple[str, dict]] = []

    def execute(self, sql, params=None):
        self.execucoes.append((str(sql), params))


def test_run_ml_com_lote_misto_usa_um_sql_por_forma(monkeypatch):
    """O caminho real de `run()` com um lote misto: cada linha com o seu SQL."""
    sessao = _SessaoRegistradora()

    @contextmanager
    def _sessao():
        yield sessao

    @contextmanager
    def _lock(mid):
        yield 918_130_002

    monkeypatch.setattr(dp, "fato_diaria_lock", _lock)
    monkeypatch.setattr(dp, "local_session", _sessao)
    monkeypatch.setattr(dp, "_start_sync_run", lambda *a, **k: 1)
    monkeypatch.setattr(dp, "_finish_sync_run", lambda *a, **k: None)
    monkeypatch.setattr(dp, "_log_quality_checks", lambda *a, **k: None)
    monkeypatch.setattr(dp, "_assert_canonical_rows_closed", lambda *a, **k: None)
    monkeypatch.setattr(dp.ml_fee_reconciliation, "reconciliar", lambda *a, **k: None)
    monkeypatch.setattr(dp.quality, "run_all", lambda rows: [])
    monkeypatch.setattr(ml_connector, "fetch_incremental", lambda **k: [{}, {}])

    com = ml_gestao_diaria.transform(_linha_gold(date=D1))
    sem = dict(ml_gestao_diaria.transform(_linha_gold(date=D2, brand="barbours")))
    del sem["total_shipments"]
    monkeypatch.setattr(ml_gestao_diaria, "transform_batch", lambda rows: [com, sem])

    res = dp.run(source="ml", mode="incremental")

    assert res["rows_loaded"] == 2
    (sql_com, p_com), (sql_sem, p_sem) = sessao.execucoes
    assert "total_shipments" in sql_com and p_com["total_shipments"] == 8
    assert "total_shipments" not in sql_sem and "total_shipments" not in p_sem


# ---------------------------------------------------------------------------
# Upsert — servidor de verdade (lote misto não apaga ninguém)
# ---------------------------------------------------------------------------

@pytest.fixture()
def banco():
    if not postgres_disponivel():
        pytest.skip(MOTIVO_SEM_POSTGRES)
    with cluster_descartavel() as url:
        eng = create_engine(url)
        with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            for stmt in filter(None, (s.strip() for s in MARTS_DDL.split(";"))):
                conn.execute(text(stmt))
        yield eng
        eng.dispose()


def _carregar(banco, *canonicos):
    with banco.begin() as conn:
        for c in canonicos:
            conn.execute(dp.sql_do_ml(c), c)


def _envios(banco) -> dict:
    with banco.connect() as conn:
        rows = conn.execute(text(
            "SELECT date, loja_id, total_shipments "
            "FROM marts.fact_marketplace_daily_performance WHERE marketplace_id = 2"
        )).all()
    return {(d, loja): ts for d, loja, ts in rows}


def test_pg_lote_misto_nao_apaga_quem_veio_sem_a_chave(banco):
    kokeshi = ml_gestao_diaria.transform(_linha_gold(date=D1, total_shipments=8))
    barbours = ml_gestao_diaria.transform(_linha_gold(date=D1, brand="barbours",
                                                      total_shipments=40))
    _carregar(banco, kokeshi, barbours)
    assert _envios(banco) == {(D1, 3): 8, (D1, 2): 40}

    # rerun misto: kokeshi COM a chave (valor novo), barbours SEM a chave
    kokeshi2 = ml_gestao_diaria.transform(_linha_gold(date=D1, total_shipments=9))
    barbours2 = dict(barbours)
    del barbours2["total_shipments"]
    _carregar(banco, kokeshi2, barbours2)

    assert _envios(banco) == {(D1, 3): 9, (D1, 2): 40}


def test_pg_lote_inteiro_sem_a_chave_preserva_e_insere_null(banco):
    _carregar(banco, ml_gestao_diaria.transform(_linha_gold(date=D1, total_shipments=8)))
    velho = dict(ml_gestao_diaria.transform(_linha_gold(date=D1)))
    del velho["total_shipments"]
    novo = dict(ml_gestao_diaria.transform(_linha_gold(date=D2)))
    del novo["total_shipments"]
    _carregar(banco, velho, novo)
    assert _envios(banco) == {(D1, 3): 8, (D2, 3): None}


# ---------------------------------------------------------------------------
# Backfill — cursor/sessão fake
# ---------------------------------------------------------------------------

class _Res:
    def __init__(self, linhas=None, rowcount=1, escalar=None):
        self._linhas = linhas or []
        self.rowcount = rowcount
        self._escalar = escalar

    def mappings(self):
        return self

    def all(self):
        return self._linhas

    def scalar(self):
        return self._escalar


class _SessaoFake:
    def __init__(self, fato, lock_livre=True, rowcount=1):
        self.fato = fato
        self.lock_livre = lock_livre
        self.rowcount = rowcount
        self.sqls: list[tuple[str, dict | None]] = []
        self.commits = self.rollbacks = self.closes = 0

    def execute(self, sql, params=None):
        s = " ".join(str(sql).split())
        self.sqls.append((s, params))
        if "pg_try_advisory_xact_lock" in s:
            return _Res(escalar=self.lock_livre)
        if s.startswith("SELECT date, loja_id, total_shipments"):
            return _Res(linhas=self.fato)
        if s.startswith("UPDATE"):
            return _Res(rowcount=self.rowcount)
        return _Res()

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closes += 1


GOLD = [
    {"ref_date": D1, "brand": "kokeshi", "total_shipments": 80},    # muda (NULL -> 80)
    {"ref_date": D1, "brand": "barbours", "total_shipments": 40},   # igual: nao muda
    {"ref_date": D1, "brand": "lescent", "total_shipments": None},  # sem observacao
    {"ref_date": D2, "brand": "kokeshi", "total_shipments": 7},     # sem linha na fato
    {"ref_date": D1, "brand": "marca_nova", "total_shipments": 3},  # sem loja
]
FATO = [
    {"date": D1, "loja_id": 3, "total_shipments": None},
    {"date": D1, "loja_id": 2, "total_shipments": 40},
    {"date": D1, "loja_id": 4, "total_shipments": 12},
]


def _rodar(apply, sessao):
    return bf.executar(D1, D2, apply=apply, ler_gold=lambda s, e: list(GOLD),
                       session_factory=lambda: sessao)


def test_backfill_dry_run_conta_e_nao_grava():
    sessao = _SessaoFake(FATO)
    res = _rodar(False, sessao)
    assert res == {
        "applied": False, "start": D1, "end": D2,
        "linhas_gold": 5, "casadas_na_fato": 3, "mudariam": 1,
        "gold_sem_fato": 1, "marca_sem_loja": 1, "gold_sem_total_shipments": 1,
    }
    assert sessao.commits == 0 and sessao.rollbacks == 1 and sessao.closes == 1
    assert sessao.sqls[0][0] == "SET TRANSACTION READ ONLY"
    assert not any(s.startswith(("UPDATE", "INSERT")) for s, _ in sessao.sqls)
    assert not any("advisory" in s for s, _ in sessao.sqls)


def test_backfill_apply_so_faz_update_na_fato():
    sessao = _SessaoFake(FATO)
    res = _rodar(True, sessao)
    assert res["applied"] is True and res["rows_updated"] == 1
    assert res["marca_sem_loja"] == 1
    assert sessao.commits == 1 and sessao.closes == 1

    assert "pg_try_advisory_xact_lock" in sessao.sqls[0][0]
    assert sessao.sqls[0][1] == {"chave": bf.LOCK_KEY}
    updates = [(s, p) for s, p in sessao.sqls if s.startswith("UPDATE")]
    assert updates == [(
        updates[0][0], {"date": D1, "loja_id": 3, "total_shipments": 80})]
    u = updates[0][0]
    assert "SET total_shipments = :total_shipments WHERE" in u
    assert "marketplace_id = 2" in u and "loja_id = :loja_id" in u and "date = :date" in u
    # nunca INSERT na fato; o unico INSERT e' a auditoria
    inserts = [s for s, _ in sessao.sqls if s.startswith("INSERT")]
    assert inserts and all("audit.source_sync_run" in s for s in inserts)
    assert not any("INSERT INTO marts" in s for s, _ in sessao.sqls)


def test_backfill_lock_proprio_nao_e_o_da_fato_diaria():
    assert bf.LOCK_KEY != 918_130_002
    assert bf.LOCK_KEY not in (918_130_001, 918_130_003, 918_140_025, 918_140_026)


def test_backfill_lock_ocupado_nao_le_nem_grava():
    sessao = _SessaoFake(FATO, lock_livre=False)
    with pytest.raises(bf.MlTotalShipmentsLockOcupado):
        _rodar(True, sessao)
    assert len(sessao.sqls) == 1 and sessao.commits == 0 and sessao.rollbacks == 1


def test_backfill_rowcount_inesperado_desfaz_tudo():
    sessao = _SessaoFake(FATO, rowcount=0)
    with pytest.raises(bf.MlTotalShipmentsError, match="esperado 1"):
        _rodar(True, sessao)
    assert sessao.commits == 0 and sessao.rollbacks == 1


def test_backfill_valor_negativo_reprova_antes_de_gravar():
    sessao = _SessaoFake(FATO)
    with pytest.raises(bf.MlTotalShipmentsError, match="invalido"):
        bf.executar(D1, D1, apply=True,
                    ler_gold=lambda s, e: [{"ref_date": D1, "brand": "kokeshi",
                                            "total_shipments": -1}],
                    session_factory=lambda: sessao)
    assert not any(s.startswith("UPDATE") for s, _ in sessao.sqls)
    assert sessao.commits == 0


def test_backfill_chave_repetida_na_gold_reprova():
    with pytest.raises(bf.MlTotalShipmentsError, match="repetida"):
        bf.planejar([{"ref_date": D1, "brand": "kokeshi", "total_shipments": 1}] * 2, [])


def test_backfill_cli_dry_run_por_padrao(monkeypatch, capsys):
    chamadas = []

    def _executar(start, end, *, apply=False, **k):
        chamadas.append(apply)
        return {"applied": apply, "linhas_gold": 0}

    monkeypatch.setattr(bf, "executar", _executar)
    assert bf.main(["--start", "2026-10-01", "--end", "2026-10-31"]) == 0
    assert chamadas == [False]
    assert "DRY-RUN" in capsys.readouterr().out
    assert bf.main(["--start", "2026-10-01", "--end", "2026-10-31", "--apply"]) == 0
    assert chamadas == [False, True]


def test_backfill_sanitiza_dsn():
    msg = bf.sanitizar("falhou em postgresql://u:segredo@10.0.0.1:5432/db")
    assert "segredo" not in msg and "10.0.0.1" not in msg
