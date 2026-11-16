"""Produtos > Mercado Livre por mes (silver do Data Mart, uma consulta so')."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi.testclient import TestClient

from app.main import app
from app.services import datamart_leitura
from app.services.produtos_ml_mes_service import get_resumo, get_tabela


def _l(item, gmv, units, *, brand="kokeshi", pedidos=1, cancel=0, spend=None, ad_rev=None, title=None):
    return {"brand": brand, "item_id": item, "seller_sku": None, "title": title or item,
            "units_sold": units, "gross_revenue": gmv, "unique_buyers": pedidos if units else None,
            "pedidos": pedidos, "cancelados": cancel, "ad_spend": spend, "ad_revenue": ad_rev,
            "ads_ate_date": date(2026, 10, 30), "refreshed_at": datetime(2026, 11, 16, 9, 0)}


LINHAS = [
    _l("MLB1", Decimal("600"), 6, pedidos=9, cancel=1, spend=Decimal("50"), ad_rev=Decimal("200")),
    _l("MLB2", Decimal("300"), 3),
    _l("MLB3", Decimal("100"), 1, brand="lescent"),
    _l("MLB4", None, None, pedidos=0, spend=Decimal("20"), ad_rev=Decimal("0")),  # so' ads, sem venda
]


def _fake(chamadas):
    def consultar(sql, params):
        chamadas.append(params)
        return LINHAS
    return consultar


def test_janela_do_mes_em_brt_e_marcas_do_ml():
    chamadas = []
    get_tabela(_fake(chamadas), 2026, 10, None, None, 25, 0, None, None)
    p = chamadas[0]
    # date_created vem em -04:00: meia-noite BRT = 23h do dia anterior no relogio do ML.
    assert p["ini_ml"] == datetime(2026, 9, 30, 23) and p["fim_ml"] == datetime(2026, 10, 31, 23)
    assert (p["ini"], p["fim"]) == (date(2026, 10, 1), date(2026, 10, 31))
    assert p["marcas"] == ["barbours", "kokeshi", "lescent", "rituaria"]
    chamadas.clear()
    get_tabela(_fake(chamadas), 2026, 12, "lescent", None, 25, 0, None, None)
    assert chamadas[0]["marcas"] == ["lescent"] and chamadas[0]["fim_ml"] == datetime(2026, 12, 31, 23)


def test_linhas_pareto_ads_e_ausencia_nao_vira_zero():
    r = get_tabela(_fake([]), 2026, 10, None, None, 25, 0, None, None)
    assert r["scope"] == "mes" and r["ref_month"] == "2026-10" and r["ads_ate"] == "2026-10-30"
    assert r["total"] == 4
    a, b, c, d = r["items"]
    assert [x["item_id"] for x in r["items"]] == ["MLB1", "MLB2", "MLB3", "MLB4"]
    assert a["pareto_bucket"] == "A_top50" and b["pareto_bucket"] == "B_next30"  # antes de MLB2: 60%
    assert c["pareto_bucket"] == "C_next15" and d["pareto_bucket"] is None    # antes de MLB3: 90%
    assert a["revenue_share_pct"] == 60.0 and a["avg_price"] == 100.0
    assert a["cancel_rate_pct"] == 10.0 and a["ad_roas"] == 4.0 and a["ad_acos_pct"] == 25.0
    assert b["ad_spend"] is None and b["ad_roas"] is None  # sem ads no mes: vazio, nao zero
    assert d["gross_revenue"] == 0 and d["ad_spend"] == 20 and d["ad_roas"] == 0 and d["ad_acos_pct"] is None
    assert d["avg_price"] is None and d["cancel_rate_pct"] is None
    assert all(x["action_signal"] is None and x["revenue_velocity"] is None for x in r["items"])


def test_ordena_com_nulos_no_fim_filtra_bucket_e_pagina():
    r = get_tabela(_fake([]), 2026, 10, None, None, 25, 0, "ad_roas", "asc")
    assert [x["item_id"] for x in r["items"]] == ["MLB4", "MLB1", "MLB2", "MLB3"]
    r = get_tabela(_fake([]), 2026, 10, None, None, 25, 0, "ad_roas", "desc")
    assert [x["item_id"] for x in r["items"]] == ["MLB1", "MLB4", "MLB2", "MLB3"]
    r = get_tabela(_fake([]), 2026, 10, None, "B_next30", 25, 0, None, None)
    assert r["total"] == 1 and r["items"][0]["item_id"] == "MLB2"
    r = get_tabela(_fake([]), 2026, 10, None, None, 2, 2, None, None)
    assert r["total"] == 4 and [x["item_id"] for x in r["items"]] == ["MLB3", "MLB4"]


def test_resumo_mesmo_conjunto_da_tabela():
    s = get_resumo(_fake([]), 2026, 10, None)
    assert s["total_gmv"] == 1000 and s["total_count"] == 4 and s["eligible_count"] == 3
    assert s["excluded_zero_gmv_count"] == 1 and s["avg_price_weighted"] == 100.0
    assert [(b["bucket"], b["count"], b["gmv"]) for b in s["buckets"]] == [
        ("A_top50", 1, 600), ("B_next30", 1, 300), ("C_next15", 1, 100), ("D_tail", 0, 0)]
    assert s["refreshed_at"] == "2026-11-16T09:00:00"


def test_mes_sem_dado():
    s = get_resumo(lambda sql, p: [], 2026, 10, "kokeshi")
    assert s["total_count"] == 0 and s["ads_ate"] is None and s["avg_price_weighted"] is None


client = TestClient(app)


def test_router_mes_recusa_filtros_do_ranking_acumulado():
    for rota in ("/api/v1/performance/produtos/ml", "/api/v1/performance/produtos/ml/summary"):
        r = client.get(rota, params={"ref_month": "2026-10", "product_status": "inactive"})
        assert r.status_code == 422


def test_router_mes_usa_o_data_mart_e_falha_vira_503(monkeypatch):
    monkeypatch.setattr(datamart_leitura, "consultar", lambda sql, p: LINHAS)
    r = client.get("/api/v1/performance/produtos/ml", params={"ref_month": "2026-10", "limit": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "mes" and body["total"] == 4 and len(body["items"]) == 2 and body["ads_ate"] == "2026-10-30"

    def quebra(sql, p):
        raise RuntimeError("senha=xyz")
    monkeypatch.setattr(datamart_leitura, "consultar", quebra)
    r = client.get("/api/v1/performance/produtos/ml/summary", params={"ref_month": "2026-10"})
    assert r.status_code == 503 and "xyz" not in r.text
