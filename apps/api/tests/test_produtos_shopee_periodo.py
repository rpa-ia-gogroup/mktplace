"""Produtos > Shopee por anuncio e periodo, com Ads por produto (raw.shopee_ads_items)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.routers import performance as perf_router
from app.services import datamart_leitura
from app.services import produtos_shopee_periodo_service as svc

OUT = (date(2026, 10, 1), date(2026, 10, 31))
ORGANICO = "OPORTUNIDADE: produto vende organico, considerar ads"


def _l(item, gmv, units, *, brand="kokeshi", spend=None, ad_rev=None, ad_dir=None, com_ads="kokeshi"):
    return {"brand": brand, "item_id": item, "seller_sku": None, "title": f"Item {item}",
            "units_sold": units, "gross_revenue": gmv, "unique_buyers": units, "pedidos": units, "cancelados": 0,
            "min_price": None, "max_price": None, "ad_spend": spend, "ad_revenue": ad_rev, "ad_revenue_direta": ad_dir,
            "ads_ate_date": date(2026, 10, 30) if com_ads else None, "marcas_com_ads": com_ads,
            "refreshed_at": datetime(2026, 11, 16, 9, 0)}


LINHAS = [
    _l("111", Decimal("900"), 12, spend=Decimal("40"), ad_rev=Decimal("800"), ad_dir=Decimal("600")),
    _l("222", Decimal("500"), 15),                    # kokeshi tem coleta: sem linha de Ads = organico
    _l("333", Decimal("400"), 20, brand="lescent"),   # lescent sem coleta: "sem dado", nunca organico
]


def test_ads_por_loja_sem_coleta_e_sem_dado_nunca_zero():
    chamadas = []
    r = svc.get_tabela(lambda q, p: chamadas.append(p) or LINHAS, *OUT, None, None, 25, 0, None, None)
    assert chamadas[0]["marcas"] == list(svc.MARCAS) and (chamadas[0]["ini"], chamadas[0]["fim"]) == OUT
    por = {i["item_id"]: i for i in r["items"]}
    assert por["111"]["ad_roas"] == 20.0 and por["111"]["ad_roas_direto"] == 15.0 and por["111"]["ad_spend"] == 40
    assert por["111"]["action_signal"] == "ACAO: aumentar investimento (ROAS > 15x)"
    assert por["222"]["ads_sem_dado"] is False and por["222"]["action_signal"] == ORGANICO
    assert por["333"]["ads_sem_dado"] is True and por["333"]["ad_spend"] is None and por["333"]["ad_roas"] is None
    assert por["333"]["action_signal"] is None
    assert r["marcas_sem_ads"] == ["apice", "barbours", "lescent", "rituaria"] and r["ads_ate"] == "2026-10-30"
    assert r["ads_sem_coleta"] is False


def test_raw_ausente_cai_para_so_vendas_com_ads_sem_dado():
    sqls = []

    def consultar(sql, p):
        sqls.append(sql)
        if "raw.shopee_ads_items" in sql:
            raise RuntimeError("relation raw.shopee_ads_items does not exist")
        return [_l("222", Decimal("500"), 15, com_ads=None)]
    r = svc.get_resumo(consultar, *OUT, "kokeshi")
    assert len(sqls) == 2 and sqls[1] == svc.SQL_SO_VENDAS
    assert r["marcas_sem_ads"] == ["kokeshi"] and r["ads_ate"] is None and r["total_gmv"] == 500
    assert r["ads_sem_coleta"] is True  # nenhuma loja do escopo com Ads: a tela avisa uma vez, no cabecalho
    t = svc.get_tabela(consultar, *OUT, "kokeshi", None, 25, 0, None, None)
    assert t["items"][0]["ads_sem_dado"] is True and t["items"][0]["action_signal"] is None


def test_sql_shopee_item_texto_e_gasto_sem_replicar_entre_variacoes():
    """Anuncio com 2 variacoes (model_id) vende nas duas: uma linha so', gasto do item uma vez."""
    from app.database import SessionLocal
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
            CREATE TEMP TABLE stg_shopee_orders (shop_account text, order_sn text, brand text, order_status text,
                is_sale boolean, buyer_user_id text, created_date_brt date, ingested_at timestamptz,
                pay_time timestamptz) ON COMMIT DROP;
            CREATE TEMP TABLE stg_shopee_order_items (shop_account text, order_sn text, item_id text, model_id text,
                item_name text, item_sku text, quantity int, discounted_price numeric, item_total numeric,
                is_freebie boolean) ON COMMIT DROP;
            CREATE TEMP TABLE shopee_ads_items (brand varchar(50), item_id text, ref_date date, cost numeric(14,2),
                direct_amount numeric(14,2), indirect_amount numeric(14,2)) ON COMMIT DROP;
            INSERT INTO stg_shopee_orders VALUES
              ('k', 'A', 'kokeshi', 'completed', true,  'b1', '2026-10-05', '2026-10-06', '2026-10-05'),
              ('k', 'B', 'kokeshi', 'completed', true,  'b2', '2026-10-06', '2026-10-06', '2026-10-06'),
              ('k', 'C', 'kokeshi', 'cancelled', false, 'b3', '2026-10-06', '2026-10-06', '2026-10-06'),
              ('k', 'E', 'kokeshi', 'cancelled', false, 'b5', '2026-10-06', '2026-10-06', NULL),  -- nao pago: fora
              ('k', 'D', 'kokeshi', 'completed', true,  'b4', '2026-11-01', '2026-11-01', '2026-11-01');
            INSERT INTO stg_shopee_order_items VALUES
              ('k', 'A', '22990011', 'm1', 'Batom', 'BAT', 1, 50, 50, false),
              ('k', 'B', '22990011', 'm2', 'Batom', 'BAT', 2, 50, 100, false),
              ('k', 'C', '22990011', 'm1', 'Batom', 'BAT', 1, 50, 50, false),
              ('k', 'E', '22990011', 'm1', 'Batom', 'BAT', 1, 50, 50, false),
              ('k', 'D', '22990011', 'm1', 'Batom', 'BAT', 9, 50, 450, false);
            INSERT INTO shopee_ads_items VALUES
              ('kokeshi', '22990011', '2026-10-05', 10, 80, 20),
              ('kokeshi', '22990011', '2026-10-06', 10, 40, 0),
              ('kokeshi', '22990011', '2026-11-01', 999, 0, 0);
        """))
        sql = svc.SQL_COM_ADS.replace("silver.", "pg_temp.").replace("raw.", "pg_temp.")

        def consultar(q, params):
            return [dict(r._mapping) for r in db.execute(text(sql), params)]

        r = svc.get_tabela(consultar, *OUT, "kokeshi", None, 25, 0, None, None)
        assert r["total"] == 1
        it = r["items"][0]
        assert it["units_sold"] == 3 and it["gross_revenue"] == 150 and it["cancel_rate_pct"] == 33.33
        assert it["ad_spend"] == 20                       # nao 40 (2 variacoes) nem 1019 (novembro)
        assert it["ad_roas"] == 7.0 and it["ad_roas_direto"] == 6.0
        assert it["ads_sem_dado"] is False and r["ads_ate"] == "2026-10-06"
    finally:
        db.rollback()
        db.close()


client = TestClient(app)
ROTA = "/api/v1/performance/produtos/shopee/anuncios"


def test_router_intervalo_marca_e_503(monkeypatch):
    chamadas = []
    monkeypatch.setattr(datamart_leitura, "consultar", lambda q, p: chamadas.append(p) or LINHAS)
    monkeypatch.setattr(perf_router, "today_brt", lambda: date(2026, 11, 16))
    r = client.get(ROTA, params={"data_inicio": "2026-11-09", "data_fim": "2026-11-15", "action_signal": ORGANICO})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data_inicio"] == "2026-11-09" and body["total"] == 1 and body["items"][0]["item_id"] == "222"
    assert (chamadas[-1]["ini"], chamadas[-1]["fim"]) == (date(2026, 11, 9), date(2026, 11, 15))
    s = client.get(ROTA + "/summary", params={"ref_month": "2026-10"})
    assert s.status_code == 200 and s.json()["marcas_sem_ads"] == ["apice", "barbours", "lescent", "rituaria"]
    assert client.get(ROTA, params={"brand": "gocase"}).status_code == 422
    assert client.get(ROTA, params={"data_inicio": "2026-11-15", "data_fim": "2026-11-09"}).status_code == 422

    def quebra(sql, p):
        raise RuntimeError("senha=xyz")
    monkeypatch.setattr(datamart_leitura, "consultar", quebra)
    r = client.get(ROTA + "/summary", params={"ref_month": "2026-10"})
    assert r.status_code == 503 and "xyz" not in r.text
