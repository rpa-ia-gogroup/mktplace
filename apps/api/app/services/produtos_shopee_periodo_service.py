"""Produtos > Shopee por anuncio (item_id) e periodo, com Ads por produto. Data Mart.

Mesma abordagem do ML (produtos_ml_mes_service, #481):
  vendas  silver.stg_shopee_order_items x stg_shopee_orders, com as regras de
          silver.shopee_item_daily (so' is_sale, dia = created_date_brt, GMV =
          item_total). Lidas da stg porque a daily nao tem cancelados nem preco.
  ads     raw.shopee_ads_items (migration 66 do Airflow): item-dia, D-1,
          somado por (brand, item_id) ANTES do join: gasto nunca se replica.
item_id e' texto nas duas pontas (CHECK '^[0-9]+$' na raw); o join compara texto com texto.

Loja sem linha de Ads no periodo (sem coleta, ex.: Lescent) ou raw ainda
inexistente: Ads "sem dado" (nulos + ads_sem_dado), nunca zero. Uma consulta
so' por (periodo, marcas); a segunda (so' vendas) roda apenas se a raw falhar.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from app.services.produtos_ml_mes_service import Consultar, montar, resumo, tabela

logger = logging.getLogger(__name__)

MARCAS = ("apice", "barbours", "kokeshi", "lescent", "rituaria")

_VENDAS = """
vendas AS (
    SELECT o.brand, i.item_id::text AS item_id, MAX(NULLIF(i.item_sku, '')) AS seller_sku, MAX(i.item_name) AS title,
           SUM(i.quantity) FILTER (WHERE o.is_sale) AS units_sold,
           SUM(i.item_total) FILTER (WHERE o.is_sale) AS gross_revenue,
           COUNT(DISTINCT o.buyer_user_id) FILTER (WHERE o.is_sale) AS unique_buyers,
           COUNT(DISTINCT o.order_sn) FILTER (WHERE o.is_sale) AS pedidos,
           -- so' cancelamento de pedido pago (como no ML): o nao pago que a Shopee cancela sozinha nao conta
           COUNT(DISTINCT o.order_sn) FILTER (WHERE o.order_status = 'cancelled' AND o.pay_time IS NOT NULL) AS cancelados,
           -- brinde (preco 0) nao conta na variacao de preco
           MIN(i.discounted_price) FILTER (WHERE o.is_sale AND NOT i.is_freebie) AS min_price,
           MAX(i.discounted_price) FILTER (WHERE o.is_sale AND NOT i.is_freebie) AS max_price
      FROM silver.stg_shopee_order_items i
      JOIN silver.stg_shopee_orders o ON o.shop_account = i.shop_account AND o.order_sn = i.order_sn
     WHERE o.brand = ANY(:marcas) AND o.created_date_brt BETWEEN :ini AND :fim
     GROUP BY 1, 2
)"""

_REFRESH = """(SELECT MAX(ingested_at) FROM silver.stg_shopee_orders
         WHERE brand = ANY(:marcas) AND created_date_brt >= :ini) AS refreshed_at"""

SQL_COM_ADS = f"""
WITH {_VENDAS}, ads AS (
    SELECT brand, item_id::text AS item_id, SUM(cost) AS ad_spend,
           SUM(direct_amount + indirect_amount) AS ad_revenue,
           SUM(direct_amount) AS ad_revenue_direta
      FROM raw.shopee_ads_items
     WHERE brand = ANY(:marcas) AND ref_date BETWEEN :ini AND :fim
     GROUP BY 1, 2
    HAVING SUM(cost) > 0
)
SELECT COALESCE(v.brand, a.brand) AS brand, COALESCE(v.item_id, a.item_id) AS item_id,
       v.seller_sku, v.title, v.units_sold, v.gross_revenue, v.unique_buyers, v.pedidos, v.cancelados,
       v.min_price, v.max_price, a.ad_spend, a.ad_revenue, a.ad_revenue_direta,
       (SELECT MAX(ref_date) FROM raw.shopee_ads_items
         WHERE cost > 0 AND brand = ANY(:marcas) AND ref_date BETWEEN :ini AND :fim) AS ads_ate_date,
       (SELECT string_agg(DISTINCT brand, ',') FROM raw.shopee_ads_items
         WHERE brand = ANY(:marcas) AND ref_date BETWEEN :ini AND :fim) AS marcas_com_ads,
       {_REFRESH}
  FROM vendas v FULL JOIN ads a ON a.brand = v.brand AND a.item_id = v.item_id
"""

SQL_SO_VENDAS = f"""
WITH {_VENDAS}
SELECT v.*, NULL::numeric AS ad_spend, NULL::numeric AS ad_revenue, NULL::numeric AS ad_revenue_direta,
       NULL::date AS ads_ate_date, NULL::text AS marcas_com_ads, {_REFRESH}
  FROM vendas v
"""


def _ler(consultar: Consultar, ini: date, fim: date, brand: Optional[str],
         ref_month: Optional[str] = None) -> tuple[list[dict], dict]:
    marcas = [brand] if brand in MARCAS else list(MARCAS)
    params = {"marcas": marcas, "ini": ini, "fim": fim}
    try:
        linhas = consultar(SQL_COM_ADS, params)
    except Exception:  # noqa: BLE001 — raw.shopee_ads_items ausente (antes da migration 66): Ads "sem dado"
        logger.warning("produtos/shopee: Ads por produto indisponivel; segue so' com vendas", exc_info=True)
        linhas = consultar(SQL_SO_VENDAS, params)
    com_ads = next((r["marcas_com_ads"] for r in linhas if r.get("marcas_com_ads")), None) or ""
    sem_ads = frozenset(marcas) - set(com_ads.split(","))
    itens, meta = montar(linhas, ini, fim, ref_month, sem_ads)
    meta["marcas_sem_ads"] = sorted(sem_ads)
    meta["ads_sem_coleta"] = sem_ads == frozenset(marcas)  # nenhuma loja do escopo com Ads
    return itens, meta


def get_tabela(consultar: Consultar, ini: date, fim: date, brand: Optional[str],
               pareto_bucket: Optional[str], limit: int, offset: int,
               sort_by: Optional[str], sort_dir: Optional[str],
               action_signal: Optional[str] = None, ref_month: Optional[str] = None) -> dict:
    itens, meta = _ler(consultar, ini, fim, brand, ref_month)
    return tabela(itens, meta, pareto_bucket, limit, offset, sort_by, sort_dir, action_signal)


def get_resumo(consultar: Consultar, ini: date, fim: date, brand: Optional[str],
               action_signal: Optional[str] = None, ref_month: Optional[str] = None) -> dict:
    itens, meta = _ler(consultar, ini, fim, brand, ref_month)
    return resumo(itens, meta, brand, action_signal)
