"""Produtos > Mercado Livre por periodo (silver do Data Mart, uma consulta so')."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.routers import performance as perf_router
from app.services import datamart_leitura
from app.services import produtos_ml_mes_service as svc
from app.services.produtos_ml_mes_service import get_resumo, get_tabela, sinal

OUT = (date(2026, 10, 1), date(2026, 10, 31))


def _l(item, gmv, units, *, brand="kokeshi", pedidos=1, cancel=0, spend=None, ad_rev=None, ad_dir=None,
       pmin=None, pmax=None, title=None):
    return {"brand": brand, "item_id": item, "seller_sku": None, "title": title or item,
            "units_sold": units, "gross_revenue": gmv, "unique_buyers": pedidos if units else None,
            "pedidos": pedidos, "cancelados": cancel, "min_price": pmin, "max_price": pmax,
            "ad_spend": spend, "ad_revenue": ad_rev, "ad_revenue_direta": ad_dir,
            "ads_ate_date": date(2026, 10, 30), "refreshed_at": datetime(2026, 11, 16, 9, 0)}


LINHAS = [
    _l("MLB1", Decimal("600"), 6, pedidos=9, cancel=1, spend=Decimal("50"), ad_rev=Decimal("200"), ad_dir=Decimal("150")),
    _l("MLB2", Decimal("300"), 3),
    _l("MLB3", Decimal("100"), 1, brand="lescent"),
    _l("MLB4", None, None, pedidos=0, spend=Decimal("20"), ad_rev=Decimal("0"), ad_dir=Decimal("0")),  # so' ads, sem venda
]


def _fake(chamadas, linhas=LINHAS):
    def consultar(sql, params):
        chamadas.append(params)
        return linhas
    return consultar


def test_janela_em_brt_para_mes_e_intervalo_livre():
    chamadas = []
    get_tabela(_fake(chamadas), *OUT, None, None, 25, 0, None, None)
    p = chamadas[0]
    # date_created vem em -04:00: meia-noite BRT = 23h do dia anterior no relogio do ML.
    assert p["ini_ml"] == datetime(2026, 9, 30, 23) and p["fim_ml"] == datetime(2026, 10, 31, 23)
    assert (p["ini"], p["fim"]) == OUT  # Ads no MESMO periodo das vendas
    assert p["marcas"] == ["barbours", "kokeshi", "lescent", "rituaria"]
    chamadas.clear()
    r = get_tabela(_fake(chamadas), date(2026, 11, 9), date(2026, 11, 15), "lescent", None, 25, 0, None, None)
    p = chamadas[0]
    assert p["marcas"] == ["lescent"] and (p["ini"], p["fim"]) == (date(2026, 11, 9), date(2026, 11, 15))
    assert p["ini_ml"] == datetime(2026, 11, 8, 23) and p["fim_ml"] == datetime(2026, 11, 15, 23)
    assert r["data_inicio"] == "2026-11-09" and r["data_fim"] == "2026-11-15" and r["ref_month"] is None


def test_linhas_pareto_ads_e_ausencia_nao_vira_zero():
    r = get_tabela(_fake([]), *OUT, None, None, 25, 0, None, None, ref_month="2026-10")
    assert r["scope"] == "mes" and r["ref_month"] == "2026-10" and r["ads_ate"] == "2026-10-30"
    assert r["total"] == 4
    a, b, c, d = r["items"]
    assert [x["item_id"] for x in r["items"]] == ["MLB1", "MLB2", "MLB3", "MLB4"]
    assert a["pareto_bucket"] == "A_top50" and b["pareto_bucket"] == "B_next30"  # antes de MLB2: 60%
    assert c["pareto_bucket"] == "C_next15" and d["pareto_bucket"] is None    # antes de MLB3: 90%
    assert a["revenue_share_pct"] == 60.0 and a["avg_price"] == 100.0
    assert a["cancel_rate_pct"] == 10.0 and a["ad_acos_pct"] == 25.0
    # ROAS como no ML: (direta + indireta) / gasto; o direto separado.
    assert a["ad_roas"] == 4.0 and a["ad_roas_direto"] == 3.0
    assert b["ad_spend"] is None and b["ad_roas"] is None and b["ad_roas_direto"] is None  # sem ads: vazio, nao zero
    assert d["gross_revenue"] == 0 and d["ad_spend"] == 20 and d["ad_roas"] == 0 and d["ad_acos_pct"] is None
    assert d["avg_price"] is None and d["cancel_rate_pct"] is None
    assert all(x["revenue_velocity"] is None and x["product_status"] is None for x in r["items"])


def _p(**kw):
    base = {"ad_spend": None, "ad_roas": None, "units_sold": 0, "cancel_rate_pct": None, "price_spread_pct": None}
    return {**base, **kw}


def test_sinais_regras_e_prioridade():
    assert sinal(_p(ad_spend=51, ad_roas=0)).startswith("REVIEW")
    assert sinal(_p(ad_spend=50, ad_roas=0)) is None                       # limite: > 50
    assert sinal(_p(ad_spend=101, ad_roas=2.9, units_sold=3)) == "ACAO: considerar pausar ads (ROAS < 3x)"
    assert sinal(_p(ad_spend=100, ad_roas=2.9, units_sold=3)) is None      # limite: > 100
    assert sinal(_p(ad_spend=49, ad_roas=15, units_sold=3)) == "ACAO: aumentar investimento (ROAS > 15x)"
    assert sinal(_p(ad_spend=50, ad_roas=15, units_sold=3)) is None        # limite: < 50
    assert sinal(_p(units_sold=10)) == "OPORTUNIDADE: produto vende organico, considerar ads"
    assert sinal(_p(units_sold=9)) is None
    assert sinal(_p(units_sold=10, ad_spend=1, ad_roas=5)) is None         # tem ads: nao e' organico
    assert sinal(_p(units_sold=1, cancel_rate_pct=10.01)) == "ALERTA: taxa cancelamento alta (> 10%)"
    assert sinal(_p(units_sold=1, cancel_rate_pct=10)) is None
    assert sinal(_p(units_sold=1, price_spread_pct=50.1)) == "ATENCAO: grande variacao de preco"
    # Prioridade do ranking do Airflow: o primeiro que bate vence.
    assert sinal(_p(ad_spend=200, ad_roas=1, units_sold=2, cancel_rate_pct=50, price_spread_pct=90)).startswith("ACAO: considerar")
    assert sinal(_p(units_sold=20, cancel_rate_pct=50)).startswith("OPORTUNIDADE")
    assert sinal(_p(units_sold=1, cancel_rate_pct=50, price_spread_pct=90)).startswith("ALERTA")


def test_sinais_no_periodo_spread_e_filtro():
    linhas = [
        _l("MLB1", Decimal("600"), 12, pmin=Decimal("40"), pmax=Decimal("70")),            # spread 75%, organico vence
        _l("MLB2", Decimal("300"), 3, pmin=Decimal("40"), pmax=Decimal("70")),             # spread 75%
        _l("MLB3", None, None, pedidos=0, spend=Decimal("80"), ad_rev=Decimal("0"), ad_dir=Decimal("0")),
    ]
    r = get_tabela(_fake([], linhas), *OUT, None, None, 25, 0, None, None)
    por_id = {x["item_id"]: x["action_signal"] for x in r["items"]}
    assert por_id == {"MLB1": "OPORTUNIDADE: produto vende organico, considerar ads",
                      "MLB2": "ATENCAO: grande variacao de preco",
                      "MLB3": "REVIEW: spend sem vendas no período de orders"}
    f = get_tabela(_fake([], linhas), *OUT, None, None, 25, 0, None, None, action_signal="ATENCAO: grande variacao de preco")
    assert f["total"] == 1 and f["items"][0]["item_id"] == "MLB2"
    s = get_resumo(_fake([], linhas), *OUT, None, action_signal="ATENCAO: grande variacao de preco")
    assert s["total_gmv"] == 300 and s["eligible_count"] == 1


def test_ordena_com_nulos_no_fim_filtra_bucket_e_pagina():
    r = get_tabela(_fake([]), *OUT, None, None, 25, 0, "ad_roas", "asc")
    assert [x["item_id"] for x in r["items"]] == ["MLB4", "MLB1", "MLB2", "MLB3"]
    r = get_tabela(_fake([]), *OUT, None, None, 25, 0, "ad_roas", "desc")
    assert [x["item_id"] for x in r["items"]] == ["MLB1", "MLB4", "MLB2", "MLB3"]
    r = get_tabela(_fake([]), *OUT, None, "B_next30", 25, 0, None, None)
    assert r["total"] == 1 and r["items"][0]["item_id"] == "MLB2"
    r = get_tabela(_fake([]), *OUT, None, None, 2, 2, None, None)
    assert r["total"] == 4 and [x["item_id"] for x in r["items"]] == ["MLB3", "MLB4"]


def test_resumo_mesmo_conjunto_da_tabela():
    s = get_resumo(_fake([]), *OUT, None)
    assert s["total_gmv"] == 1000 and s["total_count"] == 4 and s["eligible_count"] == 3
    assert s["excluded_zero_gmv_count"] == 1 and s["avg_price_weighted"] == 100.0
    assert [(b["bucket"], b["count"], b["gmv"]) for b in s["buckets"]] == [
        ("A_top50", 1, 600), ("B_next30", 1, 300), ("C_next15", 1, 100), ("D_tail", 0, 0)]
    assert s["refreshed_at"] == "2026-11-16T09:00:00"


def test_periodo_sem_dado():
    s = get_resumo(lambda sql, p: [], *OUT, "kokeshi")
    assert s["total_count"] == 0 and s["ads_ate"] is None and s["avg_price_weighted"] is None


# --- SQL de verdade (Postgres): o gasto de Ads nunca se replica entre SKUs ---------------------

try:
    from app.database import SessionLocal
except Exception:  # pragma: no cover
    SessionLocal = None


def test_sql_ads_por_item_nao_replica_gasto_entre_skus():
    """Caso real da gold: barbours MLB6173766266 vende como KIT115 e Kit115 e a gold
    soma o gasto do anuncio duas vezes. Aqui: uma linha, gasto uma vez, ROAS sobre ele."""
    if SessionLocal is None:
        pytest.skip("banco nao configurado nesta maquina (DATABASE_URL ausente)")
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db.close()
        pytest.skip("Postgres local inacessivel")
    try:
        db.execute(text("""
            CREATE TEMP TABLE stg_ml_orders (order_id text, brand text, status text, buyer_id text,
                                             date_created timestamp, updated_at timestamp) ON COMMIT DROP;
            CREATE TEMP TABLE stg_ml_order_items (order_id text, brand text, item_id text, seller_sku text,
                                                  title text, quantity int, unit_price numeric) ON COMMIT DROP;
            CREATE TEMP TABLE stg_ml_ads_items (brand text, item_id text, ref_date date, title text, cost numeric,
                                                direct_amount numeric, indirect_amount numeric) ON COMMIT DROP;
            INSERT INTO stg_ml_orders VALUES
              ('o1', 'barbours', 'paid', 'b1', '2026-10-05 10:00', '2026-10-06'),
              ('o2', 'barbours', 'paid', 'b2', '2026-10-06 10:00', '2026-10-06'),
              ('o3', 'barbours', 'paid', 'b3', '2026-11-02 10:00', '2026-11-02');
            INSERT INTO stg_ml_order_items VALUES
              ('o1', 'barbours', 'MLB6173766266', 'KIT115', 'Kit', 1, 100),
              ('o2', 'barbours', 'MLB6173766266', 'Kit115', 'Kit', 2, 100),
              ('o3', 'barbours', 'MLB6173766266', 'KIT115', 'Kit', 5, 100);
            INSERT INTO stg_ml_ads_items VALUES
              ('barbours', 'MLB6173766266', '2026-10-05', 'Kit', 30, 200, 100),
              ('barbours', 'MLB6173766266', '2026-10-06', 'Kit', 30, 100, 0),
              ('barbours', 'MLB6173766266', '2026-11-01', 'Kit', 999, 0, 0);
        """))
        sql = svc.SQL_MES.replace("silver.", "pg_temp.")

        def consultar(q, params):
            return [dict(r._mapping) for r in db.execute(text(q), params)]

        r = get_tabela(lambda q, p: consultar(sql, p), *OUT, "barbours", None, 25, 0, None, None)
        assert r["total"] == 1
        it = r["items"][0]
        assert it["units_sold"] == 3 and it["gross_revenue"] == 300   # novembro fora
        assert it["ad_spend"] == 60                                      # nao 120 (2 SKUs) nem 1059 (novembro)
        assert it["ad_roas"] == 6.67 and it["ad_roas_direto"] == 5.0
        assert r["ads_ate"] == "2026-10-06"
    finally:
        db.rollback()
        db.close()


# --- Rotas ------------------------------------------------------------------------------------

client = TestClient(app)


def test_router_periodo_recusa_filtros_do_ranking_acumulado():
    for rota in ("/api/v1/performance/produtos/ml", "/api/v1/performance/produtos/ml/summary"):
        r = client.get(rota, params={"ref_month": "2026-10", "product_status": "inactive"})
        assert r.status_code == 422


def test_router_intervalo_livre_e_atalho_do_mes(monkeypatch):
    chamadas = []
    monkeypatch.setattr(datamart_leitura, "consultar", _fake(chamadas))
    monkeypatch.setattr(perf_router, "today_brt", lambda: date(2026, 11, 16))
    rota = "/api/v1/performance/produtos/ml"
    r = client.get(rota, params={"data_inicio": "2026-11-09", "data_fim": "2026-11-15",
                                 "action_signal": "ACAO: aumentar investimento (ROAS > 15x)"})
    assert r.status_code == 200, r.text
    assert r.json()["data_inicio"] == "2026-11-09" and r.json()["ref_month"] is None
    assert (chamadas[-1]["ini"], chamadas[-1]["fim"]) == (date(2026, 11, 9), date(2026, 11, 15))
    r = client.get(rota, params={"ref_month": "2026-10"})
    assert r.json()["ref_month"] == "2026-10" and r.json()["data_fim"] == "2026-10-31"
    # Intervalo invalido: 422 (mesmas travas do filtro global).
    for ruim in ({"data_inicio": "2026-11-15", "data_fim": "2026-11-09"},
                 {"data_inicio": "2026-11-01", "data_fim": "2026-11-20"},
                 {"data_inicio": "2026-11-01"},
                 {"data_inicio": "2025-01-01", "data_fim": "2026-11-15"}):
        assert client.get(rota, params=ruim).status_code == 422, ruim


def test_router_tiktok_aceita_intervalo(monkeypatch):
    visto = {}
    monkeypatch.setattr(perf_router, "today_brt", lambda: date(2026, 11, 16))
    monkeypatch.setattr(perf_router, "_require_db", lambda db: object())

    def fake_resumo(db, brand, year, month, *, start=None, end=None):
        visto.update(start=start, end=end)
        return {"ref_month": f"{year:04d}-{month:02d}", "total_gmv": 0, "total_count": 0, "eligible_count": 0,
                "excluded_zero_gmv_count": 0, "brand": brand, "buckets": [], "avg_price_weighted": None}
    monkeypatch.setattr(perf_router.perf_svc, "get_produtos_tiktok_summary", fake_resumo)
    r = client.get("/api/v1/performance/produtos/tiktok/summary",
                   params={"data_inicio": "2026-11-09", "data_fim": "2026-11-15"})
    assert r.status_code == 200, r.text
    assert visto == {"start": date(2026, 11, 9), "end": date(2026, 11, 15)}


def test_router_periodo_usa_o_data_mart_e_falha_vira_503(monkeypatch):
    monkeypatch.setattr(datamart_leitura, "consultar", lambda sql, p: LINHAS)
    r = client.get("/api/v1/performance/produtos/ml", params={"ref_month": "2026-10", "limit": 2})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "mes" and body["total"] == 4 and len(body["items"]) == 2 and body["ads_ate"] == "2026-10-30"
    assert body["items"][0]["ad_roas_direto"] == 3.0

    def quebra(sql, p):
        raise RuntimeError("senha=xyz")
    monkeypatch.setattr(datamart_leitura, "consultar", quebra)
    r = client.get("/api/v1/performance/produtos/ml/summary", params={"ref_month": "2026-10"})
    assert r.status_code == 503 and "xyz" not in r.text
