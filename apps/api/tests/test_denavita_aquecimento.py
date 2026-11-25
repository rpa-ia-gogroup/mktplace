"""Cache de itens por conta (migration 052) e rotina de aquecimento das duas contas do Bling. Tudo com dubles."""
from __future__ import annotations

import ast
import re
from datetime import date
from pathlib import Path

import pytest

from app.services import bling_cache, bling_warm
from app.services import marcas_menores_service as svc
from app.services.bling_token import BlingIndisponivel
from tests.test_bling_cache import FakeCache
from tests.test_bling_denavita import DEN_ML, DEN_SHOPEE, DEN_TIKTOK, CANCELADO_DEN, FakeBlingDenavita
from tests.test_denavita_itens import DEN, DEN_ITENS, RIT, RIT_ITENS
from tests.test_marcas_menores import FakeBling

HOJE = date(2026, 11, 16)
VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


@pytest.fixture(autouse=True)
def _limpo():
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def _ciclo(cache=None, den=True, **kw):
    cache = cache or FakeCache()
    rit = FakeBling({k: list(v) for k, v in RIT.items()}, RIT_ITENS)
    den_cli = FakeBlingDenavita({k: list(v) for k, v in DEN.items()}, DEN_ITENS) if den is True else den
    stats = bling_warm.sincronizar(rit, cache, HOJE, cli_denavita=den_cli, **kw)
    return stats, cache, rit, den_cli


def _detalhes(fake):
    return [c for c, _ in fake.chamadas if c.startswith("/pedidos/vendas/") and c != "/pedidos/vendas"]


def test_o_ciclo_aquece_as_duas_contas_cada_uma_na_sua_chave():
    stats, cache, rit, den = _ciclo()
    assert set(cache.itens_) == {11, 12}, "Rituaria"
    assert set(cache.outras) == {("denavita", 11), ("denavita", 14)}, "Denavita: ML e Shopee; sem cancelado e sem TikTok"
    assert cache.itens_[11][0]["codigo"] == "RIT-A" and cache.outras[("denavita", 11)][0]["codigo"] == "DEN-X"
    assert stats["itens_lidos"] == 4 and stats["itens_faltando"] == 0
    assert stats["denavita_itens_lidos"] == 2 and stats["denavita_itens_faltando"] == 0
    assert sorted(_detalhes(den)) == ["/pedidos/vendas/11", "/pedidos/vendas/14"]


def test_o_segundo_ciclo_nao_rele_item_de_nenhuma_conta():
    stats, cache, *_ = _ciclo()
    svc.limpar_cache()  # como num reinicio do Render: a memoria some, o banco fica
    stats2, _, rit2, den2 = _ciclo(cache=cache)
    assert stats2["itens_lidos"] == 0 and stats2["itens_faltando"] == 0
    assert _detalhes(rit2) == [] and _detalhes(den2) == []


def test_um_limite_so_dividido_entre_as_contas_rituaria_primeiro():
    s1, cache, *_ = _ciclo(limite_detalhes=2)
    assert set(cache.itens_) == {11, 12} and cache.outras == {}, "o limite acabou na Rituaria"
    assert s1["itens_lidos"] == 2 and s1["denavita_itens_lidos"] == 0 and s1["denavita_itens_faltando"] == 2
    assert s1["itens_faltando"] == 2, "o backlog da Denavita conta: o proximo ciclo vem logo"
    assert bling_warm.proxima_espera(s1) == bling_warm.PROXIMO_COM_BACKLOG_S
    s2, cache, *_ = _ciclo(cache=cache, limite_detalhes=2)
    assert set(cache.outras) == {("denavita", 11), ("denavita", 14)}
    assert s2["denavita_itens_lidos"] == 2 and s2["itens_faltando"] == 0
    assert bling_warm.proxima_espera(s2) >= 60 and bling_warm.proxima_espera(s2) != bling_warm.PROXIMO_COM_BACKLOG_S


def test_pedidos_mais_novos_da_denavita_primeiro():
    # Rituaria ja' pronta no cache: o limite inteiro sobra para a Denavita; com limite 1, so' o mais novo
    s, cache, *_ = _ciclo(cache=_cache_com_rituaria(), limite_detalhes=1)
    assert set(cache.outras) == {("denavita", 14)}, "14 (05/11) e' mais novo que 11 (03/11)"
    assert s["denavita_itens_faltando"] == 1


def _cache_com_rituaria():
    cache = FakeCache()
    for pid, itens in RIT_ITENS.items():
        cache.salvar_itens(pid, itens)
    # a lista da Rituaria tambem precisa estar no cache para o ciclo nao ter o que ler
    for loja, linhas in RIT.items():
        cache.salvar_pedidos([{"id": p["id"], "loja_id": loja, "data": date.fromisoformat(p["data"]), "total": p["total"], "situacao_id": 9} for p in linhas])
    return cache


def test_bling_da_denavita_fora_nao_derruba_o_ciclo_da_rituaria():
    class Fora(FakeBlingDenavita):
        def get(self, caminho, params=None):
            if caminho == "/canais-venda":
                raise BlingIndisponivel("Bling da Denavita recusou o token.")
            return super().get(caminho, params)

    stats, cache, *_ = _ciclo(den=Fora(DEN, DEN_ITENS))
    assert set(cache.itens_) == {11, 12} and cache.outras == {}
    assert stats["denavita_itens_lidos"] == 0 and stats["itens_lidos"] == 2


def test_sem_cliente_da_denavita_o_ciclo_e_o_de_antes():
    stats, cache, *_ = _ciclo(den=None)
    assert "denavita_itens_lidos" not in stats and set(cache.itens_) == {11, 12} and cache.outras == {}


def test_ciclo_da_rotina_passa_o_cliente_da_denavita(monkeypatch):
    import app.database as database
    from app.services import bling_client

    visto = {}

    class Db:
        def close(self):
            visto["fechou"] = True

    monkeypatch.setattr(database, "SessionLocal", lambda: Db())
    monkeypatch.setattr(bling_warm.settings, "bling_client_id", "id")
    monkeypatch.setattr(bling_warm, "cliente_com_sessao", lambda db: "cli-rituaria")
    monkeypatch.setattr(bling_client, "cliente_denavita", lambda db: ("cli-denavita", None))
    monkeypatch.setattr(bling_cache, "ArmazemCachePg", lambda db: "cache")
    monkeypatch.setattr(bling_warm, "sincronizar", lambda cli, cache, hoje, **kw: visto.update(kw, cli=cli, cache=cache) or {"pedidos": 0})
    assert bling_warm._ciclo() == {"pedidos": 0}
    assert visto["cli"] == "cli-rituaria" and visto["cli_denavita"] == "cli-denavita" and visto["fechou"]
    # sem token da Denavita, a rotina segue so' com a Rituaria
    monkeypatch.setattr(bling_client, "cliente_denavita", lambda db: (None, "Bling da Denavita: conta ainda sem autorização (sem token gravado)."))
    bling_warm._ciclo()
    assert visto["cli_denavita"] is None


# ---------------------------------------------------------------- armazem Postgres (SQL e parametros)

class _Res:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class DbFalso:
    def __init__(self, rows=()):
        self.rows, self.chamadas = list(rows), []

    def execute(self, sql, params=None):
        self.chamadas.append((str(sql), params))
        return _Res(self.rows)

    def commit(self):
        pass

    def rollback(self):
        pass


def test_armazem_le_e_grava_itens_pela_chave_conta_e_pedido():
    db = DbFalso(rows=[(11, [{"codigo": "DEN-X"}])])
    cache = bling_cache.ArmazemCachePg(db)
    assert cache.itens([11, 14], "denavita") == {11: [{"codigo": "DEN-X"}]}
    sql, params = db.chamadas[-1]
    assert "conta = :conta" in sql and "pedido_id = ANY(:ids)" in sql
    assert params == {"conta": "denavita", "ids": [11, 14]}
    cache.itens([11])
    assert db.chamadas[-1][1]["conta"] == "rituaria", "sem conta explicita, a Rituaria"
    cache.salvar_itens(11, [{"codigo": "DEN-X"}], "denavita")
    sql, params = db.chamadas[-1]
    assert "ON CONFLICT (conta, pedido_id) DO NOTHING" in sql and params["c"] == "denavita" and params["p"] == 11
    cache.salvar_itens(12, [])
    assert db.chamadas[-1][1]["c"] == "rituaria"
    cache.ids_sem_itens([1], date(2026, 11, 1), HOJE, 15)
    sql, params = db.chamadas[-1]
    assert "i.conta = :conta AND i.pedido_id = p.id" in sql and params["conta"] == "rituaria", "a rotina da lista e' da Rituaria"


# ---------------------------------------------------------------- migration 052

def _migration():
    """Le as constantes da migration pela AST: o pacote local `alembic/` sombreia o `alembic.op` no import."""
    texto = (VERSIONS / "052_bling_itens_por_conta.py").read_text(encoding="utf-8")
    ns = {}
    for no in ast.parse(texto).body:
        if isinstance(no, ast.Assign) and isinstance(no.targets[0], ast.Name):
            try:
                ns[no.targets[0].id] = ast.literal_eval(no.value)
            except ValueError:
                pass
    return texto, ns


def test_migration_052_encadeia_em_051_e_e_a_unica_cabeca():
    texto, ns = _migration()
    assert ns["revision"] == "052" and ns["down_revision"] == "051"
    filhos = [f.name for f in VERSIONS.glob("*.py") if re.search(r'^down_revision\s*=\s*"051"', f.read_text(encoding="utf-8"), re.M)]
    assert filhos == ["052_bling_itens_por_conta.py"]


def test_migration_052_so_mexe_na_tabela_de_itens_com_default_rituaria_e_chave_dupla():
    _, ns = _migration()
    up = " ".join(ns["UPGRADE_SQL"])
    assert "ALTER TABLE audit.bling_pedido_itens ADD COLUMN IF NOT EXISTS conta TEXT NOT NULL DEFAULT 'rituaria'" in up
    assert "PRIMARY KEY (conta, pedido_id)" in up and "IS DISTINCT FROM 2" in up, "idempotente"
    assert "bling_pedido " not in up.replace("bling_pedido_itens", ""), "a lista (audit.bling_pedido) nao muda"
    assert "%" not in up and not re.search(r"(?<![:\w]):[A-Za-z_]", up), "sem % nem :nome (op.execute passa por text())"
    down = " ".join(ns["DOWNGRADE_SQL"])
    assert "DELETE FROM audit.bling_pedido_itens WHERE conta <> 'rituaria'" in down
    assert down.index("DELETE") < down.index("PRIMARY KEY (pedido_id)") < down.index("DROP COLUMN IF EXISTS conta")
