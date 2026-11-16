"""T-0111 — "sem dado != 0" na API da Torre.

Casos da validacao da Torre (13/11/2026):
- A1-13 / MCP-02: `/performance/overview` sem linha devolvia gmv/orders/
  avg_ticket = 0 em `current` e `previous`.
- C2-10: `/regioes/summary` sem linha regional devolvia gmv/orders/units_sold 0.
- B2-09: `/performance/ml-fulfillment` (marca sem ML, D0) e
  `/performance/shopee-fbs` sem linha devolviam totais 0.
- B2-10: `/performance/shopee-fbs?brands=apice` listava as outras 4 contas em
  `missing_accounts`, embora elas so' estivessem fora do filtro.

Regra: sem linha na fonte -> null; 0 so' quando a fonte tem linha com 0.

Testes de ROTA (TestClient + `get_db` sobrescrito por uma sessao falsa que
responde por trecho de SQL). Nenhum banco e' tocado.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import get_db
from app.deps import filters as filters_mod
from app.main import app
from app.services import shopee_fbs_service as fbs_svc
from app.services.performance_service import ML_ID, TIKTOK_ID

MARCAS = {"apice", "barbours", "kokeshi", "lescent", "rituaria"}
AGORA = datetime.now(timezone.utc)


class _Res:
    def __init__(self, linhas):
        self._l = list(linhas)

    def mappings(self):
        return self

    def all(self):
        return list(self._l)

    def first(self):
        return self._l[0] if self._l else None

    def one(self):
        return self._l[0] if self._l else {}

    def scalar(self):
        return list(self._l[0].values())[0] if self._l else None

    def scalars(self):
        return self

    def __iter__(self):
        return iter(self._l)


class FakeSession:
    """Responde pelo PRIMEIRO trecho de SQL que casar; senao, conjunto vazio
    (o que o banco devolve para um recorte sem linha)."""

    def __init__(self, respostas: list[tuple[str, list]] | None = None):
        self.respostas = respostas or []
        self.sql: list[str] = []

    def rollback(self):
        pass

    def execute(self, stmt, params=None):
        t = str(getattr(stmt, "text", stmt))
        self.sql.append(t)
        for trecho, linhas in self.respostas:
            if trecho in t:
                return _Res(linhas)
        return _Res([])


@pytest.fixture()
def rota(monkeypatch):
    """Cliente com `get_db` sobrescrito. Marcas validas vem de lista fixa
    (a consulta real a `dim_loja` nao roda)."""
    monkeypatch.setattr(filters_mod, "get_scope_brand_keys", lambda db: set(MARCAS))

    def _client(db: FakeSession) -> TestClient:
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app)

    yield _client
    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# A1-13 / MCP-02 — /performance/overview
# ---------------------------------------------------------------------------

OVERVIEW = "/api/v1/performance/overview"
OUT_26 = {"date_from": "2026-10-01", "date_to": "2026-10-31"}


def test_a1_13_overview_sem_linha_devolve_null_em_current_e_previous(rota):
    r = rota(FakeSession()).get(OVERVIEW, params={
        "channels": "ml", "brands": "apice", "compare": "true", **OUT_26})
    assert r.status_code == 200, r.text
    b = r.json()
    for lado in ("current", "previous"):
        assert b[lado]["gmv"] is None, lado
        assert b[lado]["orders"] is None, lado
        assert b[lado]["avg_ticket"] is None, lado
    assert b["gmv_mom_pct"] is None


def test_a1_10_overview_sem_compare_previous_e_null_nao_zero(rota):
    r = rota(FakeSession()).get(OVERVIEW, params={"channels": "all", **OUT_26})
    assert r.status_code == 200, r.text
    prev = r.json()["previous"]
    assert prev["gmv"] is None and prev["orders"] is None and prev["avg_ticket"] is None


def _kpi(mkt_id, gmv, orders):
    return {"marketplace_id": mkt_id, "gmv": gmv, "orders": orders,
            "canceled_orders": 0, "unique_buyers": 0, "ad_spend": 0, "ad_revenue": 0}


class _OverviewPorJanela(FakeSession):
    """Linhas so' na janela ATUAL; a anterior (set/26) fica sem linha."""

    def __init__(self, atual):
        super().__init__()
        self.atual = atual

    def execute(self, stmt, params=None):
        t = str(stmt)
        if "GROUP BY f.marketplace_id" in t and params and params.get("start") == date(2026, 10, 1):
            return _Res(self.atual)
        return super().execute(stmt, params)


def test_overview_com_linha_soma_so_quem_tem_dado_e_delta_null_sem_base(rota):
    db = _OverviewPorJanela([_kpi(TIKTOK_ID, Decimal("1000"), 10)])
    r = rota(db).get(OVERVIEW, params={"channels": "all", "compare": "true", **OUT_26})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["current"]["gmv"] == 1000.0
    assert b["current"]["orders"] == 10
    assert b["current"]["avg_ticket"] == 100.0
    assert b["previous"]["gmv"] is None          # anterior sem linha
    assert b["gmv_mom_pct"] is None              # base null -> delta null


def test_overview_linha_com_zero_continua_zero(rota):
    """0 so' quando a fonte tem linha com 0; ticket sem pedido e' null."""
    db = _OverviewPorJanela([_kpi(ML_ID, Decimal("0"), 0)])
    r = rota(db).get(OVERVIEW, params={"channels": "ml", **OUT_26})
    assert r.status_code == 200, r.text
    cur = r.json()["current"]
    assert cur["gmv"] == 0.0
    assert cur["orders"] == 0
    assert cur["avg_ticket"] is None


def test_resumo_executivo_continua_valido_sem_linha(rota):
    """Consumidor interno do get_overview: segue no contrato float/int e
    trata a ausencia como `no_data` (status critical), como antes."""
    r = rota(FakeSession()).get("/api/v1/performance/executive-summary", params={
        "channels": "ml", "brands": "apice", **OUT_26})
    assert r.status_code == 200, r.text
    h = r.json()["health"]
    assert h["status"] == "critical"
    assert h["gmv"] == 0.0 and h["orders"] == 0


# ---------------------------------------------------------------------------
# C2-10 — /regioes/summary
# ---------------------------------------------------------------------------

#: O que o Postgres devolve para o agregado SEM GROUP BY quando nenhuma linha
#: casa: uma linha, com os COALESCE em 0 e o COUNT(*) em 0.
_REGIAO_VAZIA = {
    "gmv": 0, "orders": 0, "units_sold": 0, "ufs_com_venda": 0,
    "uf_known_orders": 0, "uf_eligible_orders": 0,
    "shipping_cost_covered_orders": 0, "shipping_cost_eligible_orders": 0,
    "seller_shipping_cost": None, "linhas": 0,
}


def test_c2_10_regioes_summary_sem_linha_devolve_null(rota):
    db = FakeSession([("SUM(f.seller_shipping_cost)", [_REGIAO_VAZIA])])
    r = rota(db).get("/api/v1/regioes/summary", params={
        "date_from": "2026-11-01", "date_to": "2026-11-12"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["gmv"] is None
    assert b["orders"] is None
    assert b["units_sold"] is None
    assert b["ufs_com_venda"] is None


def test_regioes_summary_com_linha_mantem_valores(rota):
    linha = dict(_REGIAO_VAZIA, gmv=Decimal("10.5"), orders=2, units_sold=3,
                 ufs_com_venda=1, linhas=4)
    db = FakeSession([("SUM(f.seller_shipping_cost)", [linha])])
    r = rota(db).get("/api/v1/regioes/summary", params={
        "date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["gmv"], b["orders"], b["units_sold"], b["ufs_com_venda"]) == (10.5, 2, 3, 1)


# ---------------------------------------------------------------------------
# B2-09 — /performance/ml-fulfillment
# ---------------------------------------------------------------------------

ML_FULL = "/api/v1/performance/ml-fulfillment"
_FRESCOR_ML = [("COUNT(*) AS linhas", [{
    "refreshed_at": AGORA - timedelta(hours=1),
    "source_max_date": date(2026, 11, 12), "linhas": 500}])]


@pytest.mark.parametrize("params", [
    {"brands": "apice", **OUT_26},                                    # marca sem ML
    {"date_from": AGORA.date().isoformat(), "date_to": AGORA.date().isoformat()},  # D0
], ids=["apice_sem_ml", "d0"])
def test_b2_09_ml_fulfillment_sem_linha_totais_null(rota, params):
    r = rota(FakeSession(_FRESCOR_ML)).get(ML_FULL, params=params)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["paid_gmv_total"] is None
    assert b["paid_orders_total"] is None
    assert b["paid_units_total"] is None
    assert b["share_full_gmv"] is None
    assert any(l.startswith("sem_dado") for l in b["quality"]["limitations"])


# ---------------------------------------------------------------------------
# B2-09 / B2-10 — /performance/shopee-fbs
# ---------------------------------------------------------------------------

FBS = "/api/v1/performance/shopee-fbs"
_LIMITES_FBS = {"source_min_date": date(2026, 1, 1), "source_max_date": date(2026, 11, 12),
                "refreshed_at": AGORA - timedelta(hours=2),
                "source_watermark_at": AGORA - timedelta(hours=3), "linhas": 1648}
_ESCOPO_VAZIO = {"effective_date_from": None, "effective_date_to": None,
                 "refreshed_at": None, "source_watermark_at": None, "linhas": 0}


def _linha_fbs(classe, conta="apice"):
    return {"fbs_class": classe, "brand": conta, "shop_account": conta,
            "gross_gmv": Decimal("100"), "gross_units": 1, "created_orders": 1,
            "eligible_orders": 1, "cancelled_orders": 0, "to_return_orders": 0,
            "to_return_gmv": Decimal("0"), "unpaid_orders": 0, "unpaid_gmv": Decimal("0"),
            "handling_seconds_sum": 60, "handling_sample_count": 1,
            "source_watermark_at": AGORA - timedelta(hours=3)}


def _fbs_db(classe_rows, observadas, escopo):
    # Ordem importa: o primeiro trecho que casar responde.
    return FakeSession([
        ("SET TRANSACTION", []),
        ("MIN(ref_date) AS source_min_date", [_LIMITES_FBS]),
        ("effective_date_from", [escopo]),
        ("SELECT DISTINCT shop_account", observadas),
        ("ref_date, fbs_class", []),
        ("GROUP BY shop_account, brand, fbs_class", classe_rows),
        ("GROUP BY brand, fbs_class", classe_rows),
        ("GROUP BY fbs_class", classe_rows),
    ])


@pytest.fixture()
def fbs_ligado(monkeypatch):
    monkeypatch.setattr(settings, "shopee_fbs_enabled", True)


def test_b2_10_shopee_fbs_missing_accounts_respeita_filtro_de_marca(rota, fbs_ligado):
    db = _fbs_db([_linha_fbs("fbs"), _linha_fbs("seller")],
                 [{"shop_account": "apice", "brand": "apice"}],
                 dict(_ESCOPO_VAZIO, effective_date_from=date(2026, 10, 1),
                      effective_date_to=date(2026, 10, 31), linhas=62))
    r = rota(db).get(FBS, params={"brands": "apice", **OUT_26})
    assert r.status_code == 200, r.text
    m = r.json()["meta"]
    assert m["expected_accounts"] == ["apice"]
    assert m["missing_accounts"] == []
    assert not any("sem linha na janela" in w for w in m["warnings"])


def test_b2_10_conta_da_marca_pedida_sem_linha_continua_ausente(rota, fbs_ligado):
    """Contraprova: dentro do filtro, a ausencia continua sendo denunciada."""
    db = _fbs_db([], [], _ESCOPO_VAZIO)
    r = rota(db).get(FBS, params={"brands": "apice", **OUT_26})
    assert r.status_code == 200, r.text
    assert r.json()["meta"]["missing_accounts"] == ["apice"]


def test_b2_09_shopee_fbs_sem_linha_totais_null(rota, fbs_ligado):
    db = _fbs_db([], [], _ESCOPO_VAZIO)
    r = rota(db).get(FBS, params={"brands": "apice", **OUT_26})
    assert r.status_code == 200, r.text
    b = r.json()
    t = b["totals"]
    for campo in ("gross_gmv", "gross_units", "created_orders", "eligible_orders",
                  "cancelled_orders", "to_return_orders", "to_return_gmv",
                  "unpaid_orders", "unpaid_gmv"):
        assert t[campo] is None, campo
    assert t["handling"]["seconds_avg"] is None
    assert b["shares"]["share_fbs_gmv"] is None
    assert b["rates"]["cancellation_rate"] is None
    assert any(w.startswith("sem_dado") for w in b["meta"]["warnings"])


def test_shopee_fbs_mapa_conta_marca_cobre_a_allowlist():
    assert set(fbs_svc.ACCOUNT_BRAND) == set(fbs_svc.EXPECTED_ACCOUNTS)
    assert set(fbs_svc.ACCOUNT_BRAND.values()) <= set(fbs_svc.EXPECTED_BRANDS)
