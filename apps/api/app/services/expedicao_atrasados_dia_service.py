"""Pedidos atrasados de UM dia de vencimento — Mercado Livre e Shopee.

`GET /api/v1/expedicao/{ml|shopee}/ldr/pedidos?vencimento=AAAA-MM-DD&brands=&page=`

E' o clique na barra da "Evolução por dia de vencimento" (o mesmo do TikTok,
`/tiktok/coleta-perdida?escopo=todos`): a lista dos pedidos que entraram no
numerador da LDR daquele dia. A regra e' a MESMA da taxa — o SQL reaproveita o
CTE e a condicao de atraso de `ml_ldr_service` e `shopee_ldr_dm_service`.

So' as colunas que a lista mostra: marca, numero do pedido (ML: a venda;
Shopee: `order_sn`), status atual, prazo e coleta. Nada do comprador. O numero
do pedido segue a chave `expedicao_numero_pedido_publico` (desligada = nulo).

Dia fora da janela = 422. Falha da fonte = `unavailable`, nunca lista vazia:
ausencia nao vira "nenhum pedido".
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from app.config import settings
from app.services import ml_ldr_service as ml
from app.services import shopee_ldr_dm_service as shopee
from app.services.gold_service import ML_BRANDS, TZ_OPERACIONAL

logger = logging.getLogger(__name__)

Consultar = Callable[[str, dict], list[dict]]

TAMANHO_PAGINA = 200
PAGINA_MAX = 1000

#: Por canal: marcas com fonte, SQL, parametros extras, primeiro dia e janela.
CANAIS: dict[str, dict[str, Any]] = {
    "mercadolivre": {
        "marcas": ML_BRANDS, "sql": ml.SQL_ATRASADOS_DIA_ML, "consultar": ml.consultar_datamart,
        "extra": {"logisticas": list(ml.LOGISTICAS_COM_COLETA), "coletado": list(ml.SUBSTATUS_COLETADO)},
        "inicio": ml.INICIO_SERIE, "janela": ml.JANELA_MAX_DIAS,
    },
    "shopee": {
        "marcas": shopee.SHOPEE_MARCAS, "sql": shopee.SQL_ATRASADOS_DIA_SHOPEE,
        "consultar": shopee.consultar_datamart, "extra": {},
        "inicio": None, "janela": 35,
    },
}


class DiaInvalido(ValueError):
    """Vencimento fora da janela com dia fechado."""


def validar_dia(canal: str, vencimento: date, agora: Optional[datetime] = None) -> None:
    """So' dias FECHADOS (ate' ontem) dentro da janela do canal."""
    hoje = (agora or datetime.now(timezone.utc)).astimezone(TZ_OPERACIONAL).date()
    cfg = CANAIS[canal]
    if vencimento >= hoje or vencimento < hoje - timedelta(days=cfg["janela"]):
        raise DiaInvalido
    if cfg["inicio"] and vencimento < cfg["inicio"]:
        raise DiaInvalido


def _lista_json(v: Any) -> list[dict]:
    if v is None:
        return []
    if isinstance(v, str):
        v = json.loads(v)
    return [dict(x) for x in v] if isinstance(v, list) else []


def obter_atrasados_dia(
    canal: str,
    *,
    vencimento: date,
    brands: Optional[list[str]] = None,
    pagina: int = 1,
    consultar: Optional[Consultar] = None,
    agora: Optional[datetime] = None,
) -> dict:
    cfg = CANAIS[canal]
    consultar = consultar or cfg["consultar"]
    filtro = [m for m in (brands or []) if m in cfg["marcas"]]
    base: dict[str, Any] = {
        "channel": canal, "deadline": vencimento.isoformat(),
        "brands": [], "all_brands": [], "list_total": 0, "still_waiting": 0, "orders": [],
        "page": pagina, "page_size": TAMANHO_PAGINA, "has_more": False,
    }
    # Marca sem fonte neste canal (ex.: Kokeshi na Shopee): nao ha' lista, e
    # dizer "nenhum pedido" afirmaria uma medicao que nao foi feita.
    if brands and not filtro:
        return {**base, "availability": "unavailable", "unavailable_reason": "brand_without_source"}
    params = {"marcas": list(cfg["marcas"]), "inicio": vencimento, "fim": vencimento, **cfg["extra"]}
    try:
        linhas = consultar(cfg["sql"], params)
        todos = _lista_json(linhas[0].get("pedidos")) if linhas else []
    except Exception as exc:  # noqa: BLE001 — motivo fixo, texto nunca sai
        logger.warning("atrasados_dia %s: consulta falhou (%s)", canal, type(exc).__name__)
        return {**base, "availability": "unavailable", "unavailable_reason": "source_error"}

    # A consulta traz o dia inteiro (cache do `datamart_leitura`); marca e
    # pagina saem da memoria, como no TikTok.
    filtrados = [p for p in todos if not filtro or p.get("brand") in filtro]
    por_marca: dict[str, dict] = {}
    for p in filtrados:
        b = por_marca.setdefault(str(p.get("brand")), {"brand": str(p.get("brand")), "missed": 0, "still_waiting": 0})
        b["missed"] += 1
        if not p.get("coletado_em"):
            b["still_waiting"] += 1
    marcas_out = sorted(por_marca.values(), key=lambda x: (-x["missed"], x["brand"]))
    numero_publico = bool(getattr(settings, "expedicao_numero_pedido_publico", False))
    ini = (pagina - 1) * TAMANHO_PAGINA
    pedidos = [
        {"brand": str(p.get("brand")),
         "order_id": str(p.get("order_id")) if numero_publico and p.get("order_id") is not None else None,
         "status": p.get("status"), "deadline_at": p.get("prazo"), "collected_at": p.get("coletado_em")}
        for p in filtrados[ini:ini + TAMANHO_PAGINA]
    ]
    return {
        **base, "availability": "available", "brands": marcas_out,
        "all_brands": sorted({str(p.get("brand")) for p in todos}),
        "list_total": len(filtrados),
        "still_waiting": sum(b["still_waiting"] for b in marcas_out),
        "orders": pedidos, "has_more": ini + TAMANHO_PAGINA < len(filtrados),
    }
