"""T-0093 — devolucoes reais da Shopee no publisher de insumos da DRE.

Regras PURAS (sem banco): inercia antes da 045, contrato da linha publicada
(cobertura em dias, kokeshi fora, ausencia != zero, sinal), recusa so' das
devolucoes, deriva do CHECK sob o lock e o contrato com a migration 045. Uma
prova de SERVIDOR (PostgreSQL descartavel, SKIP sem os binarios) confere a SQL
real: so' ACCEPTED soma e o mes e' o da criacao em BRT.
"""
from __future__ import annotations

import pathlib
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text

from pipelines.dre import insumo_publisher as P
from pipelines.tests.postgres_descartavel import (
    MOTIVO_SEM_POSTGRES,
    cluster_da_sessao,
    postgres_disponivel,
)
from pipelines.tests.test_dre_impostos_webgex import carregar_migration_040
from pipelines.tests.test_dre_insumo_publisher import (
    CHECK_025,
    _AlvoFake,
    _carregar_migration,
    _ConnAlvo,
    _ConnFonte,
    _EngQuebra,
    _FonteFake,
    _lista_do_check,
    _Res,
    carregar_migration_025,
    esperado,
)

SET = date(2026, 9, 1)
OUT = date(2026, 10, 1)
NOV = date(2026, 11, 1)
AGORA = datetime(2026, 12, 2, 12, 0, tzinfo=timezone.utc)
LOJAS = ("apice", "barbours", "lescent", "rituaria")


def carregar_migration_045():
    return _carregar_migration("045_dre_insumo_devolucoes_shopee.py")


def _definicao(componentes) -> str:
    return "CHECK ((componente = ANY (ARRAY[" + ", ".join(f"'{c}'::text" for c in componentes) + "])))"


CHECK_040 = _definicao(carregar_migration_040().COMPONENTES)
CHECK_045 = _definicao(carregar_migration_045().COMPONENTES)


def dev(marca="apice", mes=OUT, devolucoes=10, aceitas=6, reembolsado="1234.50", sem_valor=0, negativas=0,
        atualizado=datetime(2026, 11, 10, 9, 30)):
    """Uma linha de `SQL_DEVOLUCOES_SHOPEE` (competencia x marca)."""
    return {"competencia": mes, "marca": marca, "devolucoes": devolucoes, "aceitas": aceitas,
            "aceitas_sem_valor": sem_valor, "aceitas_negativas": negativas,
            "reembolsado": None if reembolsado is None else Decimal(reembolsado), "atualizado_em": atualizado}


def lote(marcas=LOJAS + ("kokeshi",), comps=(OUT,), devolucoes=None):
    esp = [esperado("shopee", m, gmv=100_000, mes=c) for c in comps for m in marcas]
    return P.montar_lote(esperado=esp, cmv=[], contraprova=[], repasse=[], canais=["shopee"], comps=list(comps),
                         devolucoes_shopee=devolucoes)


def linhas_dev(lt) -> dict:
    return {(r["competencia"], r["marca"]): r for r in lt.linhas if r["componente"] == P.DEVOLUCAO_SHOPEE}


# ---------------------------------------------------------------------------
# Inerte antes da 045
# ---------------------------------------------------------------------------

def test_inerte_sem_a_045_o_lote_e_identico_ao_de_antes():
    antes = P.montar_lote(esperado=[esperado("shopee", m, gmv=100_000, mes=OUT) for m in LOJAS], cmv=[],
                          contraprova=[], repasse=[], canais=["shopee"], comps=[OUT])
    inerte = lote(marcas=LOJAS, devolucoes=None)
    assert inerte.linhas == antes.linhas and inerte.extraidas == antes.extraidas
    assert inerte.devolucoes_estado is None and inerte.fora_do_escopo == antes.fora_do_escopo
    assert not linhas_dev(inerte)
    assert "migration 045 pendente" in P.estado_devolucoes_shopee(None)


class _Proibida:
    def connect(self):  # pragma: no cover - so' falha se alguem consultar
        raise AssertionError("a fonte de devolucoes nao pode ser consultada sem a 045")


def test_inerte_nao_consulta_a_fonte():
    linhas, estado = P.ler_devolucoes_shopee(_Proibida(), [OUT], ["shopee"], list(LOJAS), aceita=False)
    assert linhas is None and estado.startswith("inerte: ") and "045" in estado
    assert P.ler_devolucoes_shopee(_Proibida(), [OUT], ["ml"], list(LOJAS), aceita=True) == (None, "fora do escopo")


class _FonteDev(_FonteFake):
    """Data Mart fake que responde `SQL_DEVOLUCOES_SHOPEE` e guarda os params."""

    def __init__(self, alvo, devolucoes=(), **kw):
        super().__init__(alvo, [], **kw)
        self.devolucoes, self.lidas, self.params = list(devolucoes), [], None

    def connect(self):
        fonte = self

        class C(_ConnFonte):
            def execute(self, sql, params=None):
                fonte.lidas.append(sql)
                if sql is P.SQL_DEVOLUCOES_SHOPEE:
                    fonte.ao_ler()
                    fonte.params = params
                    return _Res(linhas=fonte.devolucoes)
                return super().execute(sql, params)
        return C(self)


def _publicar(alvo, fonte, comps=(OUT,)):
    return P.publicar(alvo, fonte, list(comps), ["shopee"], agora=AGORA)


def test_publicar_sem_a_045_nao_le_a_fonte_e_nao_grava_o_componente():
    alvo = _AlvoFake([esperado("shopee", m, mes=OUT) for m in LOJAS], check=CHECK_040)
    fonte = _FonteDev(alvo, [dev(m) for m in LOJAS])
    res = _publicar(alvo, fonte)
    assert P.SQL_DEVOLUCOES_SHOPEE not in fonte.lidas
    assert res["aplicado"] is True and res["devolucoes_shopee"].startswith("inerte: ")
    assert not any(r["componente"] == P.DEVOLUCAO_SHOPEE for r in alvo.inseridas)
    assert P.DEVOLUCAO_SHOPEE not in res["por_componente"]


# ---------------------------------------------------------------------------
# Com a 045: contrato da linha
# ---------------------------------------------------------------------------

def test_com_a_045_publica_as_quatro_lojas_out_25_de_31_e_nov_inteiro():
    rows = [dev(m, mes=c, reembolsado=f"{100 + i}.25") for c in (OUT, NOV) for i, m in enumerate(LOJAS)]
    lt = lote(comps=(OUT, NOV), devolucoes=rows)
    ln = linhas_dev(lt)
    assert lt.recusas == [] and lt.devolucoes_estado == "publicado"
    assert set(ln) == {(c, m) for c in (OUT, NOV) for m in LOJAS}
    for i, m in enumerate(LOJAS):
        assert ln[(OUT, m)]["cobertura"] == Decimal("0.806452")  # 25/31
        assert ln[(NOV, m)]["cobertura"] == Decimal("1.000000")
        for c in (OUT, NOV):
            r = ln[(c, m)]
            assert r["valor"] == Decimal(f"{100 + i}.25") and r["valor"] > 0
            assert r["sinal_origem"] == 1 and r["canal"] == "shopee"
            assert r["status_reconciliacao"] == "nao_avaliado" and r["procedencia"] == P.PROC_DEVOLUCAO_SHOPEE
            assert r["data_max_origem"] == datetime(2026, 11, 10, 9, 30, tzinfo=timezone.utc)
    assert ln[(OUT, "apice")]["motivo"] == (
        "raw.shopee_returns: ACCEPTED, por criacao da devolucao, BRT; 6 aceita(s) de 10 devolucao(oes); "
        "cobertura 25 de 31 dias (dado desde 07/10/2026)")
    assert "cobertura 30 de 30 dias" in ln[(NOV, "apice")]["motivo"]
    assert Decimal(25) / Decimal(31) - ln[(OUT, "apice")]["cobertura"] < Decimal("0.000001")


def test_kokeshi_nunca_publica_nem_com_linha_na_fonte():
    lt = lote(devolucoes=[dev("kokeshi"), dev("apice")])
    assert not any(r["marca"] == "kokeshi" for r in linhas_dev(lt).values())
    assert ("devolucoes_shopee", OUT, "shopee", "kokeshi") in lt.fora_do_escopo
    assert linhas_dev(lt)[(OUT, "apice")]["valor"] == Decimal("1234.50")


def test_competencia_antes_de_07_10_nao_publica():
    assert P.DEVOLUCOES_SHOPEE_INICIO == date(2026, 10, 7)
    assert P.cobertura_devolucao_shopee(SET) is None
    lt = lote(comps=(SET, OUT), devolucoes=[dev("apice", mes=SET), dev("apice", mes=OUT)])
    ln = linhas_dev(lt)
    assert not any(c == SET for c, _ in ln)
    assert ("devolucoes_shopee", SET, "shopee", "apice") in lt.fora_do_escopo
    assert ln[(OUT, "apice")]["valor"] == Decimal("1234.50")


def test_loja_sem_devolucao_no_mes_e_ausente_com_valor_nulo_nunca_zero():
    lt = lote(devolucoes=[dev("apice")])  # barbours, lescent, rituaria: nenhuma linha na fonte
    ln = linhas_dev(lt)
    for m in ("barbours", "lescent", "rituaria"):
        r = ln[(OUT, m)]
        assert r["valor"] is None and r["status_reconciliacao"] == "ausente_na_origem"
        assert r["sinal_origem"] is None
        assert "nenhuma devolucao da marca no mes (ausencia nao e' zero)" in r["motivo"]
    assert lt.recusas == []
    # fonte vazia para o lote inteiro: toda loja ausente
    assert all(r["valor"] is None for r in linhas_dev(lote(devolucoes=[])).values())


def test_devolucoes_sem_nenhuma_aceita_e_zero_medido():
    """Houve devolucao no mes, nenhuma ACCEPTED: nada foi reembolsado (mesma regra
    da kokeshi na API). Diferente de nao haver devolucao nenhuma (ausente)."""
    r = linhas_dev(lote(devolucoes=[dev("apice", devolucoes=3, aceitas=0, reembolsado=None)]))[(OUT, "apice")]
    assert r["valor"] == Decimal(0) and r["status_reconciliacao"] == "nao_avaliado" and r["sinal_origem"] == 1


def test_aceitas_sem_refund_amount_viram_nulo_e_parcial_fica_no_motivo():
    r = linhas_dev(lote(devolucoes=[dev("apice", aceitas=2, reembolsado=None, sem_valor=2)]))[(OUT, "apice")]
    assert r["valor"] is None and r["status_reconciliacao"] == "ausente_na_origem"
    assert "nenhuma com refund_amount" in r["motivo"]
    r = linhas_dev(lote(devolucoes=[dev("apice", aceitas=3, reembolsado="50", sem_valor=1)]))[(OUT, "apice")]
    assert r["valor"] == Decimal(50) and "1 aceita(s) sem refund_amount fora da soma" in r["motivo"]


def test_sql_so_soma_accepted_por_criacao_em_brt():
    sql = " ".join(str(P.SQL_DEVOLUCOES_SHOPEE).split())
    assert "FROM raw.shopee_returns" in sql and "WHERE brand = ANY(:marcas)" in sql
    assert "SUM(refund_amount) FILTER (WHERE status = 'ACCEPTED') AS reembolsado" in sql
    assert "date_trunc('month', (create_time AT TIME ZONE 'America/Sao_Paulo'))::date AS competencia" in sql
    assert "MAX(update_time) AS atualizado_em" in sql
    assert "COALESCE" not in sql.upper()


# ---------------------------------------------------------------------------
# Validacao: reprova so' as devolucoes
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("rows,trecho", [
    ([dev("apice", negativas=1, reembolsado="-10")], "refund_amount negativo"),
    ([dev("apice"), dev("apice")], "chave repetida"),
])
def test_validacao_reprovada_descarta_so_as_devolucoes(rows, trecho):
    lt = lote(marcas=LOJAS, devolucoes=rows)
    assert lt.recusas == []
    assert not linhas_dev(lt)
    assert lt.linhas == lote(marcas=LOJAS, devolucoes=None).linhas
    assert lt.devolucoes_estado.startswith("recusado: ") and trecho in lt.devolucoes_estado


# ---------------------------------------------------------------------------
# CHECK do Neon e publicar
# ---------------------------------------------------------------------------

class _Conn:
    def __init__(self, definicao):
        self.definicao = definicao

    def execute(self, _sql):
        return self

    def scalar(self):
        return self.definicao


def test_so_aceita_com_o_componente_no_check():
    assert P.check_aceita_devolucoes(_Conn(CHECK_040)) is False
    assert P.check_aceita_devolucoes(_Conn(None)) is False
    assert P.check_aceita_devolucoes(_Conn(CHECK_045)) is True
    assert P.check_aceita_impostos(_Conn(CHECK_045)) is True and P.check_aceita_taxa_shopee(_Conn(CHECK_045))


def test_publicar_com_a_045_le_desde_07_10_sem_conexao_do_neon_e_grava():
    alvo = _AlvoFake([esperado("shopee", m, mes=OUT) for m in LOJAS + ("kokeshi",)], check=CHECK_045)
    fonte = _FonteDev(alvo, [dev(m) for m in LOJAS])
    res = _publicar(alvo, fonte)
    assert res["aplicado"] is True and res["recusas"] == [] and res["devolucoes_shopee"] == "publicado"
    assert fonte.params == {"marcas": list(LOJAS), "inicio": date(2026, 10, 7), "fim_exclusivo": NOV}
    assert set(fonte.abertas_na_leitura) == {0}
    dev_ins = [r for r in alvo.inseridas if r["componente"] == P.DEVOLUCAO_SHOPEE]
    assert sorted(r["marca"] for r in dev_ins) == list(LOJAS)
    assert alvo.deletes == 1 and alvo.auditoria == ["running", "success"]


def test_check_mudou_entre_a_pre_leitura_e_o_lock_recusa_antes_do_delete():
    def chega_a_045(a):
        a.check = CHECK_045

    kok = (OUT, "shopee", "apice")
    alvo = _AlvoFake([esperado("shopee", "apice", mes=OUT)], fotografia={kok}, check=CHECK_040)
    fonte = _FonteDev(alvo, [dev("apice")], depois_da_leitura=chega_a_045)
    with pytest.raises(P.PublicacaoRecusada) as exc:
        _publicar(alvo, fonte)
    assert any("CHECK ck_fdim_componente) mudou" in m for m in exc.value.motivos)
    assert alvo.deletes == 0 and alvo.inserts == 0 and alvo.fotografia == {kok}
    assert alvo.auditoria == ["failed"]


class _ConnAlvoDry(_ConnAlvo):
    """O fake do alvo nao conhece `SQL_ATUAL` (so' o dry-run le'): fotografia vazia."""

    def execute(self, sql, params=None):
        if sql is P.SQL_ATUAL:
            return _Res(linhas=[])
        return super().execute(sql, params)


class _AlvoDry(_AlvoFake):
    def connect(self):
        return _ConnAlvoDry(self, transacional=False)


def test_dry_run_mostra_o_estado_no_resumo():
    alvo = _AlvoDry([esperado("shopee", m, mes=OUT) for m in LOJAS], check=CHECK_040)
    res, _ = P.diagnosticar(alvo, _FonteDev(alvo, [dev("apice")]), [OUT], ["shopee"])
    assert res["devolucoes_shopee"].startswith("inerte: ")
    alvo.check = CHECK_045
    res, _lt = P.diagnosticar(alvo, _FonteDev(alvo, [dev("apice")]), [OUT], ["shopee"])
    assert res["devolucoes_shopee"] == "publicado" and res["por_componente"][P.DEVOLUCAO_SHOPEE]["linhas"] == 4
    assert alvo.inserts == 0 and alvo.deletes == 0


def test_erro_na_leitura_vira_indisponivel_sem_dsn():
    linhas, estado = P.ler_devolucoes_shopee(_EngQuebra(), [OUT], ["shopee"], list(LOJAS), aceita=True)
    assert linhas is None and estado == "indisponivel: ProgrammingError"  # so' a classe, nada de host
    fonte = pathlib.Path(P.__file__).read_text(encoding="utf-8")
    trecho = fonte[fonte.index("def ler_devolucoes_shopee"):fonte.index("def estado_devolucoes_shopee")]
    assert trecho.index("SET TRANSACTION READ ONLY") < trecho.index("statement_timeout = '600s'") \
        < trecho.index("SQL_DEVOLUCOES_SHOPEE")
    assert "except SQLAlchemyError" in trecho and "except Exception" not in trecho


# ---------------------------------------------------------------------------
# Contrato com a migration 045
# ---------------------------------------------------------------------------

def test_045_estende_a_040_com_o_componente_e_o_downgrade_recusa_com_linha():
    m025, m040, m045 = carregar_migration_025(), carregar_migration_040(), carregar_migration_045()
    assert (m045.revision, m045.down_revision) == ("045", "044")
    assert m045.COMPONENTES == m040.COMPONENTES + (P.DEVOLUCAO_SHOPEE,)
    assert m045.NOVOS == (P.DEVOLUCAO_SHOPEE,)
    (up,) = m045.UPGRADE_SQL
    guarda, restaura = m045.DOWNGRADE_SQL
    assert _lista_do_check(up, "ck_fdim_componente") == m045.COMPONENTES
    assert _lista_do_check(restaura, "ck_fdim_componente") == m040.COMPONENTES
    for sql in (up, restaura):
        assert sql.count("CONSTRAINT") == 2 and "DROP CONSTRAINT ck_fdim_componente," in sql
        assert m045.TABELA in sql
    assert "DELETE" not in " ".join(m045.DOWNGRADE_SQL).upper()
    assert "RAISE EXCEPTION" in guarda and f"componente = '{P.DEVOLUCAO_SHOPEE}'" in guarda
    assert "%" not in " ".join(m045.UPGRADE_SQL + m045.DOWNGRADE_SQL)
    lt = lote(devolucoes=[dev("apice")])
    assert {r["componente"] for r in lt.linhas} <= set(m045.COMPONENTES)
    assert {r["status_reconciliacao"] for r in lt.linhas} <= set(m025.STATUS)
    assert CHECK_025  # o CHECK minimo do fake continua sem o componente (inerte por padrao)
    assert P.check_aceita_devolucoes(_Conn(CHECK_025)) is False


# ===========================================================================
# Servidor real (PostgreSQL descartavel): a SQL de leitura
# ===========================================================================

pg = pytest.mark.skipif(not postgres_disponivel(), reason=MOTIVO_SEM_POSTGRES)


@pg
def test_sql_real_so_accepted_e_mes_da_criacao_em_brt():
    from pipelines.tests import test_dre_insumo_publisher_integracao as I

    with cluster_da_sessao() as base:
        adm = create_engine(base, future=True, isolation_level="AUTOCOMMIT")
        with adm.connect() as conn:
            conn.execute(text("DROP DATABASE IF EXISTS dev_fonte WITH (FORCE)"))
            conn.execute(text("CREATE DATABASE dev_fonte"))
        adm.dispose()
        fonte = create_engine(I._url_db(base, "dev_fonte"), future=True)
        try:
            with fonte.begin() as c:
                c.execute(text("CREATE SCHEMA raw"))
                c.execute(text("""CREATE TABLE raw.shopee_returns (brand TEXT, return_sn TEXT, status VARCHAR(30),
                                  refund_amount NUMERIC(14, 2), create_time TIMESTAMPTZ, update_time TIMESTAMPTZ)"""))
                for brand, sn, status, valor, criado in [
                    ("apice", "a1", "ACCEPTED", "100.00", "2026-10-10 12:00+00"),
                    ("apice", "a2", "CANCELLED", "999.00", "2026-10-11 12:00+00"),
                    ("apice", "a3", "REQUESTED", "888.00", "2026-10-12 12:00+00"),
                    # 01/11 02:00 UTC = 31/10 23:00 BRT: conta em OUTUBRO
                    ("apice", "a4", "ACCEPTED", "50.00", "2026-11-01 02:00+00"),
                    # 01/11 04:00 UTC = 01/11 01:00 BRT: conta em NOVEMBRO
                    ("apice", "a5", "ACCEPTED", "7.00", "2026-11-01 04:00+00"),
                    ("kokeshi", "k1", "ACCEPTED", "555.00", "2026-10-10 12:00+00"),
                    ("barbours", "b1", "JUDGING", "40.00", "2026-10-20 12:00+00"),
                ]:
                    c.execute(text("INSERT INTO raw.shopee_returns VALUES (:b, :sn, :st, :v, :ct, :ct)"),
                              {"b": brand, "sn": sn, "st": status, "v": Decimal(valor), "ct": criado})
            linhas, estado = P.ler_devolucoes_shopee(fonte, [OUT, NOV], ["shopee"], ["apice", "barbours", "kokeshi"],
                                                     aceita=True)
        finally:
            fonte.dispose()
    assert estado == "lido"
    por = {(r["competencia"], r["marca"]): r for r in linhas}
    assert set(por) == {(OUT, "apice"), (NOV, "apice"), (OUT, "barbours")}  # kokeshi nem e' lida
    assert por[(OUT, "apice")]["reembolsado"] == Decimal("150.00")
    assert (por[(OUT, "apice")]["devolucoes"], por[(OUT, "apice")]["aceitas"]) == (4, 2)
    assert por[(NOV, "apice")]["reembolsado"] == Decimal("7.00")
    assert por[(OUT, "barbours")]["reembolsado"] is None and por[(OUT, "barbours")]["aceitas"] == 0
    lt = lote(marcas=LOJAS, comps=(OUT, NOV), devolucoes=linhas)
    ln = linhas_dev(lt)
    assert ln[(OUT, "barbours")]["valor"] == Decimal(0)        # devolucao sem aceita: zero medido
    assert ln[(OUT, "lescent")]["valor"] is None               # sem devolucao: ausente
