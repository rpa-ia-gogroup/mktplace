"""Produtos > Mercado Livre por periodo (mes, atalho ou intervalo livre), direto das silver do Data Mart.

O ranking do Airflow (`gold.vw_ml_produto_pnl_ranking` -> marts.fact_ml_produto_ranking)
e' lifetime, sem data (UNIT_ECONOMICS_ATTRIBUTION_AUDIT F26). Aqui o periodo sai de:
  vendas  silver.stg_ml_order_items x stg_ml_orders (status 'paid' = GMV da Torre)
  ads     silver.stg_ml_ads_items (item x ref_date)

Dia do pedido em BRT: `date_created` vem em -04:00 (#480) e `date_created_brt`
ainda nao tem backfill, entao a janela comeca 1h antes no relogio do ML.

Uma consulta so' por (periodo, marcas): tabela, paginas, ordenacao e resumo saem da
mesma resposta, que o cache de `datamart_leitura` reaproveita (em prod cada
consulta e' uma vaga na fila do Metabase).

Sinal de acao: as regras do ranking do Airflow, recalculadas no periodo (SINAIS).
Velocidade, status, eficiencia e margem ficam nulos (ausencia, nunca zero).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from typing import Callable, Optional

from app.services.performance_service import (
    _ML_BRANDS, _PARETO_ORDER, _pareto_buckets_from_rows, _weighted_avg_price,
)

Consultar = Callable[[str, dict], list[dict]]

SQL_MES = """
WITH vendas AS (
    SELECT o.brand, i.item_id, MAX(NULLIF(i.seller_sku, '')) AS seller_sku, MAX(i.title) AS title,
           SUM(i.quantity) FILTER (WHERE o.status = 'paid') AS units_sold,
           SUM(i.quantity * i.unit_price) FILTER (WHERE o.status = 'paid') AS gross_revenue,
           COUNT(DISTINCT o.buyer_id) FILTER (WHERE o.status = 'paid') AS unique_buyers,
           COUNT(DISTINCT o.order_id) FILTER (WHERE o.status = 'paid') AS pedidos,
           COUNT(DISTINCT o.order_id) FILTER (WHERE o.status = 'cancelled') AS cancelados,
           MIN(i.unit_price) FILTER (WHERE o.status = 'paid') AS min_price,
           MAX(i.unit_price) FILTER (WHERE o.status = 'paid') AS max_price
      FROM silver.stg_ml_order_items i
      JOIN silver.stg_ml_orders o ON o.order_id = i.order_id AND o.brand = i.brand
     WHERE o.brand = ANY(:marcas) AND o.date_created >= :ini_ml AND o.date_created < :fim_ml
     GROUP BY 1, 2
), ads AS (
    -- Grao item-dia (D-1, sem dia repetido); somado por (brand, item_id) ANTES do
    -- join com vendas: o gasto nunca se replica entre SKUs do mesmo anuncio
    -- (a gold replica em 127 itens, auditoria do ROAS).
    SELECT brand, item_id, MAX(title) AS title, SUM(cost) AS ad_spend,
           SUM(COALESCE(direct_amount, 0) + COALESCE(indirect_amount, 0)) AS ad_revenue,
           SUM(COALESCE(direct_amount, 0)) AS ad_revenue_direta
      FROM silver.stg_ml_ads_items
     WHERE brand = ANY(:marcas) AND ref_date BETWEEN :ini AND :fim
     GROUP BY 1, 2
    HAVING SUM(cost) > 0  -- anuncio parado (custo 0) sem venda e' ruido, nao produto
)
SELECT COALESCE(v.brand, a.brand) AS brand, COALESCE(v.item_id, a.item_id) AS item_id,
       v.seller_sku, COALESCE(v.title, a.title) AS title, v.units_sold, v.gross_revenue,
       v.unique_buyers, v.pedidos, v.cancelados, v.min_price, v.max_price, a.ad_spend, a.ad_revenue, a.ad_revenue_direta,
       (SELECT MAX(ref_date) FROM silver.stg_ml_ads_items
         WHERE cost > 0 AND brand = ANY(:marcas) AND ref_date BETWEEN :ini AND :fim) AS ads_ate_date,
       (SELECT MAX(updated_at) FROM silver.stg_ml_orders
         WHERE brand = ANY(:marcas) AND date_created >= :ini_ml) AS refreshed_at
  FROM vendas v FULL JOIN ads a ON a.brand = v.brand AND a.item_id = v.item_id
"""

SCOPE = "mes"

# Regras do ranking do Airflow (gold.ml_produto_ranking), na mesma ordem de
# prioridade: o primeiro que bate vence. A Operacao audita o ROAS: mudou a
# regra, muda aqui (e o teste test_sinais_*).
SINAIS = [
    ("REVIEW: spend sem vendas no período de orders",
     lambda p: (p["ad_spend"] or 0) > 50 and p["units_sold"] == 0),
    ("ACAO: considerar pausar ads (ROAS < 3x)",
     lambda p: p["ad_roas"] is not None and p["ad_roas"] < 3 and (p["ad_spend"] or 0) > 100),
    ("ACAO: aumentar investimento (ROAS > 15x)",
     lambda p: p["ad_roas"] is not None and p["ad_roas"] >= 15 and (p["ad_spend"] or 0) < 50),
    ("OPORTUNIDADE: produto vende organico, considerar ads",
     # Loja sem coleta de Ads (ads_sem_dado): nao se sabe se anuncia, entao nao e' "organico".
     lambda p: p["units_sold"] >= 10 and not p["ad_spend"] and not p.get("ads_sem_dado")),
    ("ALERTA: taxa cancelamento alta (> 10%)",
     lambda p: (p["cancel_rate_pct"] or 0) > 10),
    ("ATENCAO: grande variacao de preco",
     lambda p: (p["price_spread_pct"] or 0) > 50),
]


def sinal(p: dict) -> Optional[str]:
    return next((nome for nome, regra in SINAIS if regra(p)), None)


def _n(v) -> Optional[float]:
    return float(v) if v is not None else None


def _iso(v) -> Optional[str]:
    return v.isoformat() if hasattr(v, "isoformat") else v


def _ler(consultar: Consultar, ini: date, fim: date, brand: Optional[str],
         ref_month: Optional[str] = None) -> tuple[list[dict], dict]:
    prox = fim + timedelta(days=1)
    marcas = [brand] if brand in _ML_BRANDS else sorted(_ML_BRANDS)
    # Meia-noite BRT = 23h do dia anterior no relogio do ML (-04:00).
    um_h = timedelta(hours=1)
    linhas = consultar(SQL_MES, {
        "marcas": marcas, "ini": ini, "fim": fim,
        "ini_ml": datetime.combine(ini, time()) - um_h, "fim_ml": datetime.combine(prox, time()) - um_h,
    })
    return montar(linhas, ini, fim, ref_month)


def montar(linhas: list[dict], ini: date, fim: date, ref_month: Optional[str],
           marcas_sem_ads: frozenset = frozenset()) -> tuple[list[dict], dict]:
    """Linhas da consulta (uma por brand+item_id) -> itens com ROAS, sinal e Pareto.
    `marcas_sem_ads`: lojas sem coleta de Ads no periodo; os campos de Ads ficam nulos ("sem dado")."""
    meta = {
        "ref_month": ref_month, "data_inicio": ini.isoformat(), "data_fim": fim.isoformat(),
        # Pelo Metabase a data volta com hora e fuso; so' o dia interessa.
        "ads_ate": str(linhas[0]["ads_ate_date"])[:10] if linhas and linhas[0]["ads_ate_date"] else None,
        "refreshed_at": _iso(linhas[0]["refreshed_at"]) if linhas else None,
    }
    itens = []
    for r in linhas:
        gmv = _n(r["gross_revenue"]) or 0.0
        units = int(r["units_sold"] or 0)
        pedidos, cancel = int(r["pedidos"] or 0), int(r["cancelados"] or 0)
        spend, ad_rev, ad_dir = _n(r["ad_spend"]), _n(r["ad_revenue"]), _n(r["ad_revenue_direta"])
        pmin, pmax = _n(r["min_price"]), _n(r["max_price"])
        itens.append({
            "brand": r["brand"], "item_id": r["item_id"], "seller_sku": r["seller_sku"], "title": r["title"],
            "gross_revenue": gmv, "units_sold": units,
            "unique_buyers": int(r["unique_buyers"]) if r["unique_buyers"] is not None else None,
            "avg_price": round(gmv / units, 2) if units else None,
            "cancel_rate_pct": round(cancel / (pedidos + cancel) * 100, 2) if pedidos + cancel else None,
            "ad_spend": spend,
            # ROAS como no ML: (direta + indireta) / gasto. O direto vai no tooltip.
            "ad_roas": round(ad_rev / spend, 2) if spend and ad_rev is not None else None,
            "ad_roas_direto": round(ad_dir / spend, 2) if spend and ad_dir is not None else None,
            "ad_acos_pct": round(spend / ad_rev * 100, 2) if spend is not None and ad_rev else None,
            "pareto_bucket": None, "revenue_share_pct": None,
            "price_spread_pct": round((pmax - pmin) / pmin * 100, 1) if pmin and pmax is not None else None,
            "revenue_velocity": None, "ad_efficiency": None,
            "estimated_margin": None, "product_status": None,
            "ads_sem_dado": r["brand"] in marcas_sem_ads,
        })
        itens[-1]["action_signal"] = sinal(itens[-1])
    # Pareto e % do total sobre o conjunto filtrado, so' GMV > 0 (mesma regra do SQL das outras abas).
    elegiveis = sorted((p for p in itens if p["gross_revenue"] > 0),
                       key=lambda p: (-p["gross_revenue"], p["brand"], p["item_id"]))
    total = sum(p["gross_revenue"] for p in elegiveis)
    acum = 0.0
    for p in elegiveis:
        antes = acum / total * 100
        p["pareto_bucket"] = _PARETO_ORDER[0 if antes < 50 else 1 if antes < 80 else 2 if antes < 95 else 3]
        p["revenue_share_pct"] = round(p["gross_revenue"] / total * 100, 3)
        acum += p["gross_revenue"]
    return itens, meta


def get_tabela(consultar: Consultar, ini: date, fim: date, brand: Optional[str],
               pareto_bucket: Optional[str], limit: int, offset: int,
               sort_by: Optional[str], sort_dir: Optional[str],
               action_signal: Optional[str] = None, ref_month: Optional[str] = None) -> dict:
    itens, meta = _ler(consultar, ini, fim, brand, ref_month)
    return tabela(itens, meta, pareto_bucket, limit, offset, sort_by, sort_dir, action_signal)


def tabela(itens: list[dict], meta: dict, pareto_bucket: Optional[str], limit: int, offset: int,
           sort_by: Optional[str], sort_dir: Optional[str], action_signal: Optional[str] = None) -> dict:
    if action_signal:
        itens = [p for p in itens if p["action_signal"] == action_signal]
    if pareto_bucket:
        itens = [p for p in itens if p["pareto_bucket"] == pareto_bucket]
    col = sort_by or "gross_revenue"
    desc = (sort_dir or "desc").lower() != "asc"  # mesmo padrao de _build_order_by
    itens.sort(key=lambda p: (p["brand"], p["item_id"]))
    com = [p for p in itens if p.get(col) is not None]
    com.sort(key=lambda p: p[col].lower() if isinstance(p[col], str) else p[col], reverse=desc)
    ordenados = com + [p for p in itens if p.get(col) is None]  # nulos sempre no fim
    return {"total": len(ordenados), "limit": limit, "offset": offset,
            "items": ordenados[offset:offset + limit], "scope": SCOPE, **meta}


def get_resumo(consultar: Consultar, ini: date, fim: date, brand: Optional[str],
               action_signal: Optional[str] = None, ref_month: Optional[str] = None) -> dict:
    itens, meta = _ler(consultar, ini, fim, brand, ref_month)
    return resumo(itens, meta, brand, action_signal)


def resumo(itens: list[dict], meta: dict, brand: Optional[str], action_signal: Optional[str] = None) -> dict:
    if action_signal:  # cards seguem os filtros da tabela, menos o bucket
        itens = [p for p in itens if p["action_signal"] == action_signal]
    elegiveis = [p for p in itens if p["gross_revenue"] > 0]
    por_bucket: dict[str, SimpleNamespace] = {}
    for p in elegiveis:
        b = por_bucket.setdefault(p["pareto_bucket"], SimpleNamespace(pareto_bucket=p["pareto_bucket"], gmv=0.0, count=0))
        b.gmv += p["gross_revenue"]
        b.count += 1
    buckets, total_gmv = _pareto_buckets_from_rows(list(por_bucket.values()))
    return {
        "total_gmv": total_gmv, "total_count": len(itens), "eligible_count": len(elegiveis),
        "excluded_zero_gmv_count": len(itens) - len(elegiveis), "brand": brand, "scope": SCOPE,
        "buckets": buckets,
        "avg_price_weighted": _weighted_avg_price(total_gmv, sum(p["units_sold"] for p in elegiveis)),
        **meta,
    }
