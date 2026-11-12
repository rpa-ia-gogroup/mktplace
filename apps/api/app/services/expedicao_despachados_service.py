"""Pace de despacho: pedidos DESPACHADOS por dia nos 2 ultimos dias uteis fechados.

`GET /api/v1/expedicao/despachados?channel=&brands=`

Pedido (Planejamento de Vendas): "quantos dias nosso backlog dura, com base no
pace dos ultimos 2 dias uteis". A tela divide o `backlog_count` que ja' tem pela
`media_2du` daqui (`diasDeBacklog`, em `apps/web/src/lib/expedicao-pace.ts`).

SO' A OPERACAO DO VENDEDOR — o mesmo escopo do backlog da Expedicao:

  shopee        `pickup_done_time`, fora `fulfilled_by_shopee` (FBS);
  mercadolivre  `date_shipped`, so' modalidades do vendedor (fora Full);
  tiktok        `max(rts_time)` do pedido, so' com TODOS os itens carimbados
                (como `pipelines/expedicao/tiktok_daily.py`), fora amostra e gocase.

Dia util = seg-sex fora feriado nacional (`dia_util` da Expedicao do TikTok).
So' dias FECHADOS (ate' ontem): hoje esta pela metade.

DIA SEM DADO NAO E' ZERO: se NENHUMA conta do canal tem despacho num dia util
(ingestao atrasada; D-1 so' e' confiavel depois de ~06:00), o dia fica `null` e
sai da media. Conta sem linha num dia em que o canal tem dado = 0 de verdade.

KOKESHI (Shopee) vem do export do Seller Centre (Neon) ate' o PR #401 passar a
conta para o Data Mart. Conta que o Data Mart devolve NUNCA e' lida do export:
as duas fontes nao somam.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text

from app.services.expedicao_tiktok_abertos_service import MARCAS_FORA_DO_ESCOPO, dia_util
from app.services.gold_service import ML_BRANDS, TZ_OPERACIONAL

logger = logging.getLogger(__name__)

Consultar = Callable[[str, dict], list[dict]]

CANAIS = ("shopee", "mercadolivre", "tiktok")
DIAS_DA_MEDIA = 2
#: Contas Shopee lidas do Data Mart. `kokeshi` ainda nao tem linha la' (export).
SHOPEE_CONTAS = ("apice", "barbours", "kokeshi", "lescent", "rituaria")
TIKTOK_MARCAS = ("apice", "barbours", "kokeshi", "lescent", "rituaria")
#: Mesmas modalidades do backlog do vendedor (`ML_SELLER_MANAGED_LOGISTIC_TYPES`);
#: `fulfillment` (Full) fica de fora.
ML_LOGISTICAS_VENDEDOR = ("cross_docking", "xd_drop_off", "drop_off", "self_service")
#: shortcut: TikTok olha pedidos pagos nos ultimos 15 dias antes da janela, para
#: nao varrer `line_items` inteiro; despacho depois de 15 dias do pagamento e'
#: raro demais para pesar — subir se aparecer.
TIKTOK_RECUO_PAGAMENTO_DIAS = 15

# Uma consulta so' por chamada (UNION ALL dos canais pedidos): em prod cada
# consulta vira chamada ao Metabase em fila. So' o TikTok varre `line_items`,
# entao so' entra quando pedido.
_CTE_TIKTOK = f"""
WITH ped AS MATERIALIZED (
    SELECT o.brand, o.order_id
      FROM raw.tiktok_shop_orders o
     WHERE o.paid_at >= CAST(:inicio AS date) - {TIKTOK_RECUO_PAGAMENTO_DIAS}
       AND NOT (o.brand = ANY(CAST(:marcas_fora AS text[])))
       AND NOT COALESCE(o.is_sample_order, false)
       AND o.brand = ANY(CAST(:marcas_tiktok AS text[]))
), rts AS (
    SELECT p.brand, max(li.rts_time) AS t, count(*) AS itens, count(li.rts_time) AS com
      FROM raw.tiktok_shop_line_items li
      JOIN ped p ON p.order_id = li.order_id
     GROUP BY p.brand, li.order_id
)
"""
_BLOCOS = {
    "shopee": """
SELECT 'shopee' AS canal, shop_account AS marca,
       (pickup_done_time AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       COUNT(*) AS despachados
  FROM silver.stg_shopee_orders
 WHERE shop_account = ANY(CAST(:contas_shopee AS text[]))
   AND COALESCE(fulfillment_flag, '') <> 'fulfilled_by_shopee'
   AND pickup_done_time >= (CAST(:inicio AS date))::timestamp AT TIME ZONE 'America/Sao_Paulo'
   AND pickup_done_time <  (CAST(:fim AS date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
 GROUP BY 1, 2, 3""",
    # date_shipped e' naive em -04:00: +1 h = relogio de Brasilia.
    "mercadolivre": """
SELECT 'mercadolivre' AS canal, brand AS marca, (date_shipped + interval '1 hour')::date AS dia,
       COUNT(*) AS despachados
  FROM (
    SELECT DISTINCT ON (shipment_id) brand, date_shipped
      FROM raw.ml_shipments
     WHERE brand = ANY(CAST(:marcas_ml AS text[]))
       AND logistic_type = ANY(CAST(:logisticas_ml AS text[]))
       AND date_shipped >= (CAST(:inicio AS date))::timestamp - interval '1 hour'
       AND date_shipped <  (CAST(:fim AS date) + 1)::timestamp - interval '1 hour'
     ORDER BY shipment_id, updated_at DESC NULLS LAST
  ) s
 GROUP BY 1, 2, 3""",
    "tiktok": """
SELECT 'tiktok' AS canal, brand AS marca, t::date AS dia, COUNT(*) AS despachados
  FROM rts
 WHERE com = itens
   AND t >= CAST(:inicio AS date) AND t < CAST(:fim AS date) + 1
 GROUP BY 1, 2, 3""",
}


def sql_despachados(canais: list[str]) -> str:
    return (_CTE_TIKTOK if "tiktok" in canais else "") + "\nUNION ALL".join(_BLOCOS[c] for c in canais)


# Kokeshi: export do Seller Centre no Neon (migration 034). Dia em Brasilia por
# offset fixo, como `expedicao_atraso_7d_export`.
SQL_EXPORT = """
SELECT shop_account AS marca,
       (pickup_done_time AT TIME ZONE INTERVAL '-03:00')::date AS dia,
       COUNT(*) AS despachados
  FROM marts.expedicao_shopee_export_pedido
 WHERE pickup_done_time >= :inicio AND pickup_done_time < :fim
   AND fulfillment_flag IS DISTINCT FROM 'fulfilled_by_shopee'
 GROUP BY 1, 2
"""


def consultar_datamart(sql: str, params: dict) -> list[dict]:
    from app.services import datamart_leitura  # import tardio: testes injetam `consultar`

    return datamart_leitura.consultar(sql, params)


def dias_uteis_fechados(agora: datetime, n: int = DIAS_DA_MEDIA) -> list[date]:
    """Os `n` ultimos dias uteis ANTES de hoje (Brasilia), do mais antigo ao mais novo."""
    d, saida = agora.astimezone(TZ_OPERACIONAL).date(), []
    while len(saida) < n:
        d -= timedelta(days=1)
        if dia_util(d):
            saida.append(d)
    return sorted(saida)


def _int(v: Any) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _data(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _ler_export(db, inicio: date, fim: date) -> list[dict]:
    if db is None:
        return []
    brt = timezone(timedelta(hours=-3))
    ini = datetime.combine(inicio, datetime.min.time(), tzinfo=brt)
    fim_ = datetime.combine(fim + timedelta(days=1), datetime.min.time(), tzinfo=brt)
    return [dict(r) for r in db.execute(text(SQL_EXPORT), {"inicio": ini, "fim": fim_}).mappings()]


def montar(linhas: list[dict], dias: list[date], canais: list[str], brands: Optional[list[str]]) -> dict:
    """Linhas `(canal, marca, dia, despachados)` -> contas e totais por canal."""
    cont: dict[tuple[str, str], dict[date, int]] = {}
    for r in linhas:
        dia = _data(r.get("dia"))
        if dia in dias and r.get("canal") in canais:
            c = cont.setdefault((r["canal"], str(r["marca"])), {})
            c[dia] = c.get(dia, 0) + _int(r.get("despachados"))

    def media(por_dia: list[Optional[int]]) -> Optional[float]:
        ok = [v for v in por_dia if v is not None]
        return round(sum(ok) / len(ok), 2) if ok else None

    contas, totais = [], []
    for canal in canais:
        # Dia publicado = alguma conta do canal despachou nele (sem filtro de marca).
        publicado = {d: any(v.get(d) for (c, _), v in cont.items() if c == canal) for d in dias}
        for (c, marca), v in sorted(cont.items()):
            if c != canal or (brands is not None and marca not in brands):
                continue
            serie = [(v.get(d, 0) if publicado[d] else None) for d in dias]
            contas.append({"channel": canal, "brand": marca, "shop_account": marca,
                           "dias": [{"dia": d.isoformat(), "despachados": n} for d, n in zip(dias, serie)],
                           "media_2du": media(serie)})
        sel = [v for (c, m), v in cont.items() if c == canal and (brands is None or m in brands)]
        serie = [(sum(v.get(d, 0) for v in sel) if publicado[d] else None) for d in dias]
        totais.append({"channel": canal,
                       "dias": [{"dia": d.isoformat(), "despachados": n} for d, n in zip(dias, serie)],
                       "media_2du": media(serie)})
    return {"business_days": [d.isoformat() for d in dias], "contas": contas, "totais": totais}


def obter_despachados(*, channel: Optional[str] = None, brands: Optional[list[str]] = None,
                      db=None, consultar: Optional[Consultar] = None,
                      agora: Optional[datetime] = None) -> dict:
    agora = agora or datetime.now(timezone.utc)
    consultar = consultar or consultar_datamart
    dias = dias_uteis_fechados(agora)
    canais = [channel] if channel else list(CANAIS)
    base = {"channel": channel, "business_days": [d.isoformat() for d in dias]}
    try:
        linhas = consultar(sql_despachados(canais), {
            "inicio": dias[0], "fim": dias[-1],
            "contas_shopee": list(SHOPEE_CONTAS), "marcas_ml": list(ML_BRANDS),
            "logisticas_ml": list(ML_LOGISTICAS_VENDEDOR), "marcas_tiktok": list(TIKTOK_MARCAS),
            "marcas_fora": list(MARCAS_FORA_DO_ESCOPO),
        })
    except Exception as exc:  # noqa: BLE001 — motivo fixo, texto nunca sai
        logger.warning("expedicao_despachados: consulta falhou (%s)", type(exc).__name__)
        return {**base, "availability": "unavailable", "unavailable_reason": "source_error",
                "contas": [], "totais": []}
    linhas = [dict(r) for r in linhas]
    if "shopee" in canais:
        no_dm = {str(r["marca"]) for r in linhas if r.get("canal") == "shopee"}
        try:
            extra = _ler_export(db, dias[0], dias[-1])
        except Exception as exc:  # noqa: BLE001 — Kokeshi some, o resto segue
            logger.warning("expedicao_despachados: export falhou (%s)", type(exc).__name__)
            extra = []
        linhas += [{**r, "canal": "shopee"} for r in extra if str(r["marca"]) not in no_dm]
    return {**base, "availability": "available", **montar(linhas, dias, canais, brands)}
