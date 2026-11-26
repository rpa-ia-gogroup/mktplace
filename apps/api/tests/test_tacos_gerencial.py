"""TACOS por canal na Gerencial: Ads / GMV TOTAL do canal, so' das marcas com Ads.

Marca sem Ads no recorte fica fora do numerador e do denominador (senao o TACOS
sai subestimado) e aparece na cobertura (`ml_ads_cobertura`, parcial). Sem Ads,
None, nunca 0.
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import text

from app.services import performance_service as ps

ML, SHOPEE = 2, 3


def test_tacos_usa_so_o_gmv_das_marcas_com_ads():
    assert ps._tacos({"ad_spend": 50.0, "tacos_gmv": 1000.0, "gmv": 5000.0}) == 5.0
    assert ps._tacos({"ad_spend": 0, "tacos_gmv": 0, "gmv": 5000.0}) is None
    assert ps._tacos({}) is None  # leitura antiga/sem linha: sem dado, nunca 0


def test_cobertura_parcial_sem_dado_e_canal_sem_gmv():
    assert ps._ads_cobertura_da_leitura({"ads_marcas_total": 3, "ads_marcas_sem": ["lescent"]}) == {
        "status": "parcial", "marcas_com_dado": 2, "marcas_total": 3, "marcas_sem_dado": ["lescent"]}
    assert ps._ads_cobertura_da_leitura({"ads_marcas_total": 2, "ads_marcas_sem": ["a", "b"]})["status"] == "sem_dado"
    assert ps._ads_cobertura_da_leitura({"ads_marcas_total": 2, "ads_marcas_sem": []})["status"] == "completa"
    assert ps._ads_cobertura_da_leitura(None) is None
    assert ps._ads_cobertura_da_leitura({"ads_marcas_total": 0}) is None


def test_sql_tacos_exclui_marca_sem_ads_do_denominador():
    """Postgres de verdade (tabelas temporarias): ML com 2 marcas, so' uma com Ads."""
    from app.database import SessionLocal
    if SessionLocal is None:
        pytest.skip("banco nao configurado nesta maquina (DATABASE_URL ausente)")
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db.close()
        pytest.skip("Postgres inacessivel")
    try:
        db.execute(text("""
            CREATE TEMP TABLE dim_loja (loja_id int, brand_key text) ON COMMIT DROP;
            CREATE TEMP TABLE fact_marketplace_daily_performance (loja_id int, marketplace_id int, date date,
                gmv numeric, orders int, canceled_orders int, unique_buyers int, ad_spend numeric,
                ad_revenue numeric, unpaid_orders int, unpaid_gmv numeric) ON COMMIT DROP;
            INSERT INTO dim_loja VALUES (1, 'kokeshi'), (2, 'lescent');
            INSERT INTO fact_marketplace_daily_performance VALUES
              (1, 2, '2026-11-01', 600, 6, 0, 6, 30, 300, 1, 100),
              (1, 2, '2026-11-02', 400, 4, 0, 4, 20, 200, 0, 0),
              (2, 2, '2026-11-01', 4000, 40, 0, 40, NULL, NULL, 0, 0),
              (1, 3, '2026-11-01', 500, 5, 0, 5, NULL, NULL, 0, 0);
        """))

        class Temp:
            def execute(self, stmt, params=None):
                return db.execute(text(str(stmt).replace("marts.", "pg_temp.")), params)

        for base, esperado in (("pagos", 5.0), ("realizados", round(50 / 1100 * 100, 2))):
            raw = ps._mkt_kpis(Temp(), date(2026, 11, 1), date(2026, 11, 30), [ML, SHOPEE], None, base)
            assert ps._tacos(raw[ML]) == esperado      # 50 / 1000 (kokeshi), nao 50 / 5000
            assert float(raw[ML]["gmv"]) == 5000       # o GMV do canal segue inteiro
            assert ps._ads_cobertura_da_leitura(raw[ML]) == {
                "status": "parcial", "marcas_com_dado": 1, "marcas_total": 2, "marcas_sem_dado": ["lescent"]}
            assert ps._tacos(raw[SHOPEE]) is None      # Shopee sem Ads: sem dado, nunca 0
    finally:
        db.rollback()
        db.close()


def test_brands_tacos_por_marca_com_anterior_da_mesma_leitura_e_sem_ads(monkeypatch):
    """Detalhe do TACOS por marca: Ads / GMV da marca no canal, o anterior da leitura do
    comparativo (sem consulta nova) e marca sem Ads = None (o front escreve 'sem Ads')."""
    from app.deps.period import EffectivePeriod

    def linha(gmv, spend):
        return {"gmv": gmv, "orders": 10, "canceled_orders": 0, "ad_spend": spend, "ad_revenue": 0, "total_fees": 0}

    leituras = {
        date(2026, 11, 1): {"kokeshi": {ML: linha(1000.0, 50.0), SHOPEE: linha(2000.0, 120.0)},
                            "lescent": {SHOPEE: linha(500.0, 0.0)}},
        date(2026, 10, 1): {"kokeshi": {ML: linha(800.0, 32.0), SHOPEE: linha(1000.0, 0.0)}},
    }
    chamadas = []

    def fake(db, start, end, mkt_ids, extra_cols="", brand_keys=None, base="pagos"):
        chamadas.append(start)
        return leituras.get(start, {})
    monkeypatch.setattr(ps, "_brand_mkt_rows", fake)
    monkeypatch.setattr(ps, "_max_refreshed_at", lambda *a, **k: None)
    r = ps.get_brands(None, "all", 2026, 11,
                      period=EffectivePeriod(date(2026, 11, 1), date(2026, 11, 25), None),
                      compare_period=EffectivePeriod(date(2026, 10, 1), date(2026, 10, 25), None))
    assert chamadas == [date(2026, 11, 1), date(2026, 10, 1)]   # as 2 leituras de sempre, nenhuma nova
    por = {b["brand"]: b for b in r["brands"]}
    k, l = por["kokeshi"], por["lescent"]
    assert k["ml_tacos_pct"] == 5.0 and k["ml_tacos_pct_prev"] == 4.0 and k["ml_ad_spend"] == 50.0
    assert k["shopee_tacos_pct"] == 6.0 and k["shopee_tacos_pct_prev"] is None   # sem Ads no anterior: sem comparacao
    assert l["shopee_tacos_pct"] is None and l["shopee_ad_spend"] is None         # sem Ads: nunca 0
