"""VENDAS-REALIZADAS — `base=pagos|realizados` nas rotas do Gerencial (sem banco).

`pagos` (padrao) nao le' as colunas de nao pagos e devolve o de sempre.
`realizados` soma `unpaid_orders`/`unpaid_gmv` a pedidos e GMV (ticket recalculado);
margem/custo continuam na base paga e o ML (sem fonte) fica `false` em
`nao_pago_disponivel`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.deps.period import EffectivePeriod
from app.main import app
from app.schemas.performance import (
    BrandsResponse, CanaisResponse, OverviewResponse, TrendResponse,
)
from app.services import hoje_por_hora_service as hph
from app.services import performance_service as perf_svc

PERIODO = EffectivePeriod(start=date(2026, 10, 1), end=date(2026, 10, 31), ref_month="2026-10")


class _R:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class Sessao:
    """Escolhe a resposta pelo texto do SQL e guarda tudo o que foi executado."""

    def __init__(self, principal, disponibilidade=()):
        self.principal, self.disponibilidade, self.sqls = principal, list(disponibilidade), []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.sqls.append(sql)
        if "COUNT(f.unpaid_orders) AS n" in sql:
            return _R(self.disponibilidade)
        if "MAX(f.ingested_at)" in sql:
            return _R([{"refreshed_at": None}])
        return _R(self.principal)

    @property
    def leu_nao_pagos(self):
        return any("unpaid" in s for s in self.sqls)


def _mkt(mid, gmv, orders, unpaid_gmv=None, unpaid_orders=None, **kw):
    r = {"marketplace_id": mid, "gmv": gmv, "orders": orders, "canceled_orders": 0, "unique_buyers": 0,
         "ad_spend": 0, "ad_revenue": 0}
    if unpaid_gmv is not None:      # so' a base realizados traz as colunas
        r.update(unpaid_gmv=unpaid_gmv, unpaid_orders=unpaid_orders)
    return {**r, **kw}


KPIS_PAGOS = [_mkt(1, 100, 2), _mkt(2, 300, 3), _mkt(3, 200, 4)]
KPIS_REAL = [_mkt(1, 100, 2, 50, 1), _mkt(2, 300, 3, 0, 0), _mkt(3, 200, 4, 30, 1)]
DISPONIVEL = [{"marketplace_id": 1, "n": 7}, {"marketplace_id": 3, "n": 5}]     # ML so' NULL: sem linha


def _overview(db, base):
    return perf_svc.get_overview(db, "all", 2026, 10, period=PERIODO, base=base)


def test_pagos_e_identico_ao_de_sempre_e_nao_le_colunas_novas():
    db = Sessao(KPIS_PAGOS)
    r = _overview(db, "pagos")
    assert (r["current"]["gmv"], r["current"]["orders"]) == (600.0, 9)
    assert r["current"]["avg_ticket"] == pytest.approx(600 / 9)
    assert r["base"] == "pagos" and r["nao_pago_disponivel"] is None
    assert not db.leu_nao_pagos
    OverviewResponse(**r)       # valido no schema


def test_realizados_soma_nao_pagos_e_recalcula_ticket():
    db = Sessao(KPIS_REAL, DISPONIVEL)
    r = _overview(db, "realizados")
    cur = r["current"]
    assert cur["gmv"] == 680.0 and cur["orders"] == 11
    assert cur["avg_ticket"] == pytest.approx(680 / 11)
    assert (cur["tiktok_gmv"], cur["ml_gmv"], cur["shopee_gmv"]) == (150.0, 300.0, 230.0)
    # ML nao tem fonte: segue pago e vem marcado false.
    assert r["base"] == "realizados"
    assert r["nao_pago_disponivel"] == {"tiktok": True, "ml": False, "shopee": True}
    assert OverviewResponse(**r).nao_pago_disponivel.ml is False


def test_brands_realizados_soma_e_custo_continua_na_base_paga():
    def brand(rows):
        return [{**r, "brand_key": "apice", "total_fees": -10} for r in rows]
    pagos = perf_svc.get_brands(Sessao(brand(KPIS_PAGOS)), "all", 2026, 10, period=PERIODO, base="pagos")
    real = perf_svc.get_brands(Sessao(brand(KPIS_REAL), DISPONIVEL), "all", 2026, 10, period=PERIODO,
                               base="realizados")
    p, q = pagos["brands"][0], real["brands"][0]
    assert (p["total_gmv"], p["orders"]) == (600.0, 9)
    assert (q["total_gmv"], q["orders"]) == (680.0, 11)
    assert q["avg_ticket"] == round(680 / 11, 2)
    assert q["tiktok_gmv"] == 150.0 and q["ml_gmv"] == 300.0
    assert p["cos_pct"] == q["cos_pct"] == 10.0          # tarifa / GMV PAGO do TikTok
    assert pagos["base"] == "pagos" and pagos["nao_pago_disponivel"] is None
    assert real["nao_pago_disponivel"]["ml"] is False
    BrandsResponse(**real)


def test_trend_realizados_soma_no_sql_e_pagos_nao_toca_nas_colunas():
    linha = [{"bucket": date(2026, 10, 1), "gmv": 680, "orders": 11}]
    pagos_db, real_db = Sessao(linha), Sessao(linha, DISPONIVEL)
    pagos = perf_svc.get_trend(pagos_db, "all", None, PERIODO, granularity="day", base="pagos")
    real = perf_svc.get_trend(real_db, "all", None, PERIODO, granularity="day", base="realizados")
    assert not pagos_db.leu_nao_pagos and pagos["nao_pago_disponivel"] is None
    assert "COALESCE(SUM(f.unpaid_gmv), 0)" in real_db.sqls[0] and "COALESCE(SUM(f.unpaid_orders), 0)" in real_db.sqls[0]
    assert real["data"][0]["gmv"] == 680.0 and real["nao_pago_disponivel"]["shopee"] is True
    TrendResponse(**real)


def _canais(base, linhas, disp=()):
    db = Sessao(linhas, disp)
    return perf_svc.get_canais(db, "all", 2026, 10, period=PERIODO, base=base)


def _linha_canal(mid, gmv, orders, **kw):
    return {"brand_key": "apice", "marketplace_id": mid, "gmv": gmv, "orders": orders, "gmv_video": 0,
            "gmv_live": 0, "gmv_card": 0, "visitors": 0, "unique_buyers": 0, "new_buyers": 0,
            "repeat_buyers": 0, "canceled_orders": 0, "avg_conversion_rate": None, "ad_spend": 0,
            "ad_revenue": 0, "total_fees": 0, "seller_shipping_cost": 0, "ad_spend_n": 0,
            "total_fees_n": 0, "seller_shipping_cost_n": 0, **kw}


def test_canais_realizados_soma_gmv_e_pedidos_so_de_tiktok_e_shopee():
    pagos_linhas = [_linha_canal(1, 100, 2), _linha_canal(2, 300, 3), _linha_canal(3, 200, 4)]
    real_linhas = [_linha_canal(1, 100, 2, unpaid_gmv=50, unpaid_orders=1),
                   _linha_canal(2, 300, 3, unpaid_gmv=0, unpaid_orders=0),
                   _linha_canal(3, 200, 4, unpaid_gmv=30, unpaid_orders=1)]
    pagos, real = _canais("pagos", pagos_linhas), _canais("realizados", real_linhas, DISPONIVEL)
    assert (pagos["kpis"]["tiktok_gmv"], pagos["kpis"]["shopee_gmv"]) == (100, 200)
    assert (real["kpis"]["tiktok_gmv"], real["kpis"]["shopee_gmv"]) == (150, 230)
    brand = real["brands"][0]
    assert (brand["tiktok_gmv"], brand["ml_gmv"], brand["shopee_gmv"]) == (150, 300, 230)
    rows = {r["channel"]: r for r in real["channel_rows"]}
    assert [(c, rows[c]["gmv"], rows[c]["orders"]) for c in ("tiktok", "ml", "shopee")] == [
        ("tiktok", 150, 3), ("ml", 300, 3), ("shopee", 230, 5)]
    assert [r["channel"] for r in real["channel_rows"]] == ["ml", "shopee", "tiktok"]    # reordenado por GMV
    assert pagos["base"] == "pagos" and pagos["nao_pago_disponivel"] is None
    assert real["nao_pago_disponivel"] == {"tiktok": True, "ml": False, "shopee": True}
    CanaisResponse(**real)


# ---------------------------------------------------------------------------
# Hoje por hora
# ---------------------------------------------------------------------------

BRT = timezone(timedelta(hours=-3))
HOJE = date(2026, 11, 3)
AGORA = datetime(2026, 11, 3, 13, 41, tzinfo=BRT)


class SessaoHora:
    def __init__(self, vendas):
        self.vendas, self.sqls = vendas, []

    def execute(self, sql, params=None):
        sql = str(sql)
        self.sqls.append(sql)
        if "to_regclass" in sql:
            return type("E", (), {"scalar": lambda s: True})()
        if hph.FONTES in sql:
            return _Iter([(m, datetime(2026, 11, 3, 13, 35, tzinfo=BRT)) for m in params["m"]])
        if "-- por_marca" in sql:
            return _R([])
        return _R(self.vendas)


class _Iter(_R):
    def __iter__(self):
        return iter(self._rows)


def test_hoje_por_hora_pagos_nao_le_nao_pagos_e_realizados_soma():
    pagos_db = SessaoHora([{"dia": HOJE, "marketplace_id": 1, "gmv": 1000, "pedidos": 20}])
    pagos = hph.get_hoje_por_hora(pagos_db, [1, 2, 3], None, agora=AGORA)
    assert not any("unpaid" in s for s in pagos_db.sqls)
    assert pagos["hoje"] == {"gmv": 1000.0, "pedidos": 20, "ticket": 50.0}
    assert pagos["base"] == "pagos" and pagos["nao_pago_disponivel"] is None

    # O SQL ja' devolve pagos + nao pagos somados (h.gmv + COALESCE(h.unpaid_gmv, 0)).
    real_db = SessaoHora([{"dia": HOJE, "marketplace_id": 1, "gmv": 1100, "pedidos": 22, "unpaid_n": 6},
                          {"dia": HOJE, "marketplace_id": 2, "gmv": 300, "pedidos": 5, "unpaid_n": 0}])
    real = hph.get_hoje_por_hora(real_db, [1, 2, 3], None, agora=AGORA, base="realizados")
    assert "h.gmv + COALESCE(h.unpaid_gmv, 0)" in real_db.sqls[-1] or any(
        "h.gmv + COALESCE(h.unpaid_gmv, 0)" in s for s in real_db.sqls)
    assert real["hoje"] == {"gmv": 1400.0, "pedidos": 27, "ticket": round(1400 / 27, 2)}
    assert real["base"] == "realizados"
    assert real["nao_pago_disponivel"] == {"tiktok": True, "ml": False, "shopee": False}   # ML: so' NULL


# ---------------------------------------------------------------------------
# Borda HTTP
# ---------------------------------------------------------------------------

client = TestClient(app)
ROTAS = ["overview", "brands", "trend", "executive-summary", "canais", "hoje-por-hora"]


@pytest.mark.parametrize("rota", ROTAS)
def test_base_invalida_e_422_e_valida_passa_a_borda(rota):
    from app.database import get_db
    app.dependency_overrides[get_db] = lambda: None          # sem banco: valida na borda e cai no 503
    try:
        url = f"/api/v1/performance/{rota}"
        assert client.get(url, params={"base": "tudo"}).status_code == 422
        for base in ("pagos", "realizados"):
            assert client.get(url, params={"base": base}).status_code == 503
        assert client.get(url).status_code == 503              # padrao = pagos
    finally:
        app.dependency_overrides.pop(get_db, None)
