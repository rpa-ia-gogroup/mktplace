"""SLOW-MOVING-2 -- venda diaria por SKU Unico no Marketplace, pela base do Supply.

`staging.si_rawsales` (Supply Intelligence): notas do Bling por dia e SKU Unico,
kit ja' aberto em pecas. E' a venda que da' o `consumo_marketplace` da lista
(KS03042: 548/dia nos dois lados), entao a tendencia e a serie batem com a
cobertura. Canal "Marketplace" do Supply inclui o TikTok; a serie separa os
dois pela origem da nota ("[BLING] TikTok ...") para o filtro de canal da tela.
"""
from __future__ import annotations

from datetime import date, timedelta

DIAS = 60
CANAIS = ("MKT", "TT")  # MKT = ML, Shopee e demais lojas; TT = TikTok Shop

#: Uma linha por (marca, SKU, canal) com os dias numa lista: o Metabase corta em 2.000 linhas,
#: e 81 SKUs x 60 dias x 2 canais passariam disso.
SQL_VENDAS = """
WITH v AS (
  SELECT data::date AS dia, empresa, sku_unico,
         CASE WHEN origem ILIKE '%tiktok%' THEN 'TT' ELSE 'MKT' END AS canal,
         SUM(quantidade) AS q, SUM(faturamento) AS r
    FROM staging.si_rawsales
   WHERE canal = 'Marketplace' AND data >= :ini AND data <= :fim AND sku_unico = ANY(:skus)
   GROUP BY 1, 2, 3, 4
), d AS (
  SELECT generate_series(:ini, :fim, INTERVAL '1 day')::date AS dia
), k AS (
  SELECT DISTINCT empresa, sku_unico, canal FROM v
)
SELECT k.empresa, k.sku_unico, k.canal,
       array_to_string(array_agg(COALESCE(v.q, 0) ORDER BY d.dia), ',') AS q,
       array_to_string(array_agg(COALESCE(v.r, 0) ORDER BY d.dia), ',') AS r
  FROM k CROSS JOIN d
  LEFT JOIN v ON v.empresa = k.empresa AND v.sku_unico = k.sku_unico AND v.canal = k.canal AND v.dia = d.dia
 GROUP BY 1, 2, 3
"""


def janela(ate: date, n: int = DIAS) -> list[date]:
    return [ate - timedelta(days=n - 1 - i) for i in range(n)]


def series_por_sku(linhas: list[dict], n_dias: int, marca_de) -> dict:
    """{(marca, SKU Unico): {"q": {canal: [pecas/dia]}, "r": {canal: [R$/dia]}}}; lista fora do tamanho e' descartada."""
    out: dict = {}
    for x in linhas:
        q = [float(v) for v in str(x["q"]).split(",")]
        r = [float(v) for v in str(x["r"]).split(",")]
        if x["canal"] not in CANAIS or len(q) != n_dias or len(r) != n_dias:
            continue
        e = out.setdefault((marca_de(x["empresa"]), str(x["sku_unico"]).strip()), {"q": {}, "r": {}})
        e["q"][x["canal"]], e["r"][x["canal"]] = q, r
    return out
