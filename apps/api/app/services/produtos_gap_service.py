"""PRODUTOS-GAP — quais SKUs de uma marca estao abaixo (ou acima) do dia de comparacao, no MESMO corte de hora.

Pergunta que isto responde: "por que a Kokeshi esta mais baixa que ontem?" -> quais SKUs.

FONTE (1): venda por hora POR SKU, lida pedido a pedido no Data Mart (a mesma base
da fato `marts.fact_marketplace_hourly_sales`, so' que com o item):
  ML      silver.stg_ml_order_items x stg_ml_orders   (status 'paid'; hora BRT = date_created + 1h)
  Shopee  silver.stg_shopee_order_items x stg_shopee_orders (sem cancelado/nao pago/brinde; item_total)
  TikTok  raw.tiktok_shop_orders (ultima versao do pedido, status comerciais) x api.vw_tiktok_shop_line_items
          (a tabela de itens tem UMA linha por SKU por pedido, sem quantidade: pecas e receita
          do TikTok saem ~3% abaixo da gold diaria; medido 23/11/2026, kokeshi. O vies e' igual
          nos dois dias, entao o gap continua comparavel)
O corte e' o do `hoje_por_hora_service`: cada canal na sua ultima hora fechada, hoje e o dia
comparado somados ate' a MESMA hora. Nao ha' escalonamento por curva: tem hora por SKU.

No MAXIMO duas consultas ao Data Mart, ja' agregadas por SKU/janela (em prod cada uma e' uma
vaga na fila do Metabase): ML+Shopee juntos (UNION ALL) e o TikTok a' parte. Medido no Data Mart
(kokeshi, hoje x ontem, `clock_timestamp` dentro da SQL): ML 0,6 s, Shopee 0,08 s, TikTok 0,1 s.
MAS a mesma SQL do TikTok ja' levou 17,0 s numa execucao e 0,12 s na seguinte (a forma antiga
tambem): variacao do Data Mart, nao da forma da consulta. Por isso o TikTok e' separado e tem
orcamento de tempo (`TIMEOUT_TIKTOK_S`): se estourar ou falhar, ML e Shopee saem normalmente e
o TikTok sai `sem_dado` ("demorou demais"), sem cache, em vez de derrubar a rota inteira.

CACHE: a resposta pronta fica 5 min por (marca, canais, comparar, limite, dia, corte de cada canal);
o corte muda de hora em hora, entao a chave troca sozinha. A consulta ao Data Mart tem ainda o
cache de 10 min do `datamart_leitura`.

Numeros calculados AQUI. Ausencia nunca vira zero: canal sem corte/sem pedido nos dois dias
e canal que a marca nao tem saem como `sem_dado`; so' canal COM dado tem SKU "zero medido".
"""
from __future__ import annotations

import copy
import logging
from datetime import date, datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.deps.period import APP_TIMEZONE
from app.services import datamart_leitura
from app.services import hoje_por_hora_service as hph
from app.services import ml_full_stock_service as ml_stock
from app.services import shopee_fbs_stock_service as fbs_stock
from app.services.gold_service import BRANDS_IN_SCOPE, ML_BRANDS

logger = logging.getLogger(__name__)

Consultar = Callable[..., list[dict]]

MKT_ID = {"tiktok": 1, "ml": 2, "shopee": 3}
CANAIS = ("ml", "shopee", "tiktok")
COMPARAR_DIAS = {"ontem": 1, "semana_passada": 7}
TOP_ALTAS = 5
CACHE_TTL_S = 300.0
_CACHE_MAX = 64
_cache: dict[tuple, tuple[float, dict]] = {}


def limpar_cache() -> None:
    _cache.clear()
#: Espelha pipelines.connectors.tiktok.connector.COMMERCIAL_ORDER_STATUSES (a API nao importa de pipelines).
TIKTOK_STATUS_COMERCIAIS = ("COMPLETED", "DELIVERED", "IN_TRANSIT", "AWAITING_COLLECTION", "AWAITING_SHIPMENT")
#: Mais arriscada primeiro; a classificacao de um SKU com varias linhas e' a pior delas.
_RISCO = ["RUPTURA_CANDIDATA", "BAIXO_CANDIDATO", "EXCESSO_CANDIDATO", "SEM_GIRO_CANDIDATO",
          "KIT_NAO_CONCILIADO", "SEM_DEMANDA_MEDIDA", "SUFICIENTE", "SEM_LEITURA"]

_JANELA = "CASE WHEN {dia} = CAST(:hoje AS date) THEN 'hoje' ELSE 'comp' END"

_ARMS = {
    "ml": f"""
SELECT 'ml' AS canal, COALESCE(NULLIF(i.seller_sku, ''), i.item_id) AS sku, MAX(i.title) AS nome,
       {_JANELA.format(dia="(o.date_created + INTERVAL '1 hour')::date")} AS janela,
       SUM(i.quantity) AS pecas, SUM(i.quantity * i.unit_price) AS receita
  FROM silver.stg_ml_order_items i
  JOIN silver.stg_ml_orders o ON o.order_id = i.order_id AND o.brand = i.brand
 WHERE o.status = 'paid' AND o.brand = :marca
   AND o.date_created >= CAST(:comp AS timestamp) - INTERVAL '1 hour'
   AND o.date_created <  CAST(:hoje AS timestamp) + INTERVAL '23 hours'
   AND (o.date_created + INTERVAL '1 hour')::date IN (CAST(:hoje AS date), CAST(:comp AS date))
   AND EXTRACT(HOUR FROM o.date_created + INTERVAL '1 hour') < :corte_ml
 GROUP BY 1, 2, 4""",
    "shopee": f"""
SELECT 'shopee' AS canal, COALESCE(NULLIF(i.sku, ''), i.item_id) AS sku, MAX(i.item_name) AS nome,
       {_JANELA.format(dia="o.created_date_brt")} AS janela,
       SUM(i.quantity) AS pecas, SUM(i.item_total) AS receita
  FROM silver.stg_shopee_order_items i
  JOIN silver.stg_shopee_orders o ON o.shop_account = i.shop_account AND o.order_sn = i.order_sn
 WHERE o.brand = :marca AND lower(o.order_status) NOT IN ('cancelled', 'unpaid')
   AND COALESCE(i.is_freebie, false) = false
   AND o.created_date_brt IN (CAST(:hoje AS date), CAST(:comp AS date))
   AND EXTRACT(HOUR FROM o.create_time AT TIME ZONE 'America/Sao_Paulo') < :corte_shopee
 GROUP BY 1, 2, 4""",
    "tiktok": f"""
SELECT 'tiktok' AS canal, COALESCE(NULLIF(li.seller_sku, ''), li.product_id) AS sku, MAX(li.product_name) AS nome,
       {_JANELA.format(dia="f.created_at::date")} AS janela,
       COUNT(*) AS pecas, SUM(li.sale_price) AS receita
  FROM tk_f f
  JOIN tk_i li ON li.order_id = f.order_id
 GROUP BY 1, 2, 4""",
}

#: TikTok, a' parte. Pedidos filtrados em CTEs MATERIALIZED e os itens lidos por `ANY(ARRAY(...))`
#: de order_id: so' o indice de order_id e' plausivel (~7 mil sondagens); o planner nao tem como
#: escolher varrer os ~4 milhoes de itens se as estatisticas estiverem velhas.
_TIKTOK_CTES = """
tk_o AS MATERIALIZED (
  SELECT DISTINCT ON (order_id) order_id, order_status, created_at
    FROM raw.tiktok_shop_orders
   WHERE brand = :marca
     AND created_at >= CAST(:comp AS timestamp) AND created_at < CAST(:hoje AS timestamp) + INTERVAL '1 day'
   ORDER BY order_id, updated_at DESC NULLS LAST, id DESC),
tk_f AS MATERIALIZED (
  SELECT order_id, created_at FROM tk_o
   WHERE order_status = ANY(:status_tiktok)
     AND created_at::date IN (CAST(:hoje AS date), CAST(:comp AS date))
     AND EXTRACT(HOUR FROM created_at) < :corte_tiktok),
tk_i AS MATERIALIZED (
  SELECT order_id, seller_sku, product_id, product_name, sale_price
    FROM api.vw_tiktok_shop_line_items
   WHERE order_id = ANY(ARRAY(SELECT order_id FROM tk_f)))"""
SQL_TIKTOK = "WITH" + _TIKTOK_CTES + "\n" + _ARMS["tiktok"]
#: Espera maxima pelo Metabase na consulta do TikTok. Passou disso, o canal sai sem_dado.
TIMEOUT_TIKTOK_S = 8.0


def _f(v) -> float:
    return float(v) if v is not None else 0.0


def _pct(parte: float, base: float) -> Optional[float]:
    return round(100.0 * parte / base, 1) if base > 0 else None


def _preco(receita: float, pecas: float) -> Optional[float]:
    return round(receita / pecas, 2) if pecas > 0 else None


def _agrega(linhas: list[dict], canais_com_dado: list[str]) -> dict[str, dict]:
    """sku -> {nome, hoje/comp (pecas, receita) somados, por_canal}. Somente canais com dado."""
    skus: dict[str, dict] = {}
    for r in linhas:
        if r["canal"] not in canais_com_dado or r["sku"] is None:
            continue
        s = skus.setdefault(str(r["sku"]), {"nome": None, "canais": {}})
        s["nome"] = s["nome"] or r["nome"]
        c = s["canais"].setdefault(r["canal"], {"hoje": [0.0, 0.0], "comp": [0.0, 0.0]})
        c[r["janela"]][0] += _f(r["pecas"])
        c[r["janela"]][1] += _f(r["receita"])
    return skus


def _item(sku: str, s: dict) -> dict:
    ph = sum(c["hoje"][0] for c in s["canais"].values())
    rh = sum(c["hoje"][1] for c in s["canais"].values())
    pc = sum(c["comp"][0] for c in s["canais"].values())
    rc = sum(c["comp"][1] for c in s["canais"].values())
    preco_h, preco_c = _preco(rh, ph), _preco(rc, pc)
    return {
        "sku": sku, "nome": s["nome"],
        "receita_hoje": round(rh, 2), "pecas_hoje": int(ph),
        "receita_comparado": round(rc, 2), "pecas_comparado": int(pc),
        "diferenca_rs": round(rh - rc, 2), "diferenca_pct": _pct(rh - rc, rc),
        "preco_medio_hoje": preco_h, "preco_medio_comparado": preco_c,
        "variacao_preco_pct": _pct(preco_h - preco_c, preco_c) if preco_h is not None and preco_c is not None else None,
        "por_canal": [
            {"canal": k, "receita_hoje": round(c["hoje"][1], 2), "pecas_hoje": int(c["hoje"][0]),
             "receita_comparado": round(c["comp"][1], 2), "pecas_comparado": int(c["comp"][0]),
             "diferenca_rs": round(c["hoje"][1] - c["comp"][1], 2)}
            for k, c in sorted(s["canais"].items())],
        "estoque": [],
    }


def _estoque_ml(db: Session, hoje: date, marca: str) -> tuple[dict[str, dict], Optional[str]]:
    if not settings.ml_full_stock_api_enabled:
        return {}, "Estoque Full do ML desligado nesta API."
    try:
        p = ml_stock.get_ml_full_estoque_block(db, hoje=hoje, brands=[marca], limite=ml_stock.MAX_INVENTARIOS)
    except ml_stock.MLFullEstoqueIndisponivel:
        return {}, "Estoque Full do ML sem fotografia publicada."
    except Exception:  # noqa: BLE001 — texto do banco nunca sai
        logger.exception("produtos-gap: estoque ML falhou")
        return {}, "Estoque Full do ML indisponivel."
    out: dict[str, dict] = {}
    for i in p.inventarios:
        if not i.sku:
            continue
        # null = inventario sem leitura (ausencia), nunca 0.
        out[str(i.sku)] = {"canal": "ml", "estado": "medido" if i.disponivel is not None else "sem_dado",
                           "full_vendavel": i.disponivel, "estoque_vendedor_fora_do_full": None,
                           "classificacao": i.classificacao_torre}
    return out, None


def _estoque_shopee(db: Session, hoje: date, marca: str) -> tuple[dict[str, dict], Optional[str]]:
    if not settings.shopee_fbs_stock_enabled:
        return {}, "Estoque Full da Shopee desligado nesta API."
    try:
        p = fbs_stock.get_estoque_full_block(db, hoje=hoje, brands=[marca], limite=fbs_stock.MAX_PRODUTOS)
    except fbs_stock.EstoqueFullIndisponivel:
        return {}, "Estoque Full da Shopee sem fotografia publicada."
    except Exception:  # noqa: BLE001
        logger.exception("produtos-gap: estoque Shopee falhou")
        return {}, "Estoque Full da Shopee indisponivel."
    por_sku: dict[str, list] = {}
    for r in p.produtos:
        if r.item_sku:
            por_sku.setdefault(str(r.item_sku), []).append(r)
    out: dict[str, dict] = {}
    for sku, rows in por_sku.items():
        vendedor = [r.seller_stock_total for r in rows if r.seller_stock_total is not None]
        pior = min((r.classificacao_torre for r in rows), key=lambda c: _RISCO.index(c) if c in _RISCO else len(_RISCO))
        out[sku] = {"canal": "shopee", "estado": "medido",
                    "full_vendavel": sum(r.full_stock_saleable for r in rows),
                    "estoque_vendedor_fora_do_full": sum(vendedor) if vendedor else None,
                    "classificacao": pior}
    return out, None


def get_produtos_gap(db: Session, consultar: Consultar, marca: str, canais: Optional[list[str]] = None,
                     comparar: str = "ontem", limite: int = 10, agora: Optional[datetime] = None) -> dict:
    agora = (agora or datetime.now(APP_TIMEZONE)).astimezone(APP_TIMEZONE)
    hoje = agora.date()
    comp = hoje - timedelta(days=COMPARAR_DIAS[comparar])
    pedidos = [c for c in CANAIS if canais is None or c in canais]
    limitacoes: list[str] = []

    # Corte: o MESMO de hoje_por_hora (ultima hora fechada de cada canal).
    existe = db.execute(text("SELECT to_regclass(:f) IS NOT NULL"), {"f": hph.FONTES}).scalar()
    fontes = ({r[0]: r[1] for r in db.execute(
        text(f"SELECT marketplace_id, fonte_ate FROM {hph.FONTES} WHERE marketplace_id = ANY(:m)"),
        {"m": [MKT_ID[c] for c in pedidos]})} if existe else {})
    cortes_id = hph.calcular_cortes(fontes, [MKT_ID[c] for c in pedidos], agora) if existe else {}

    estados: dict[str, dict] = {}
    consultaveis: list[str] = []
    for c in pedidos:
        corte = cortes_id.get(MKT_ID[c], 0)
        motivo = None
        if not existe:
            motivo = "As vendas por hora ainda nao estao publicadas: sem corte para este canal."
        elif c == "ml" and marca not in ML_BRANDS:
            motivo = "A marca nao tem loja no Mercado Livre."
        elif c == "tiktok" and marca not in BRANDS_IN_SCOPE:
            motivo = "A marca nao tem loja no TikTok Shop."
        elif corte <= 0:
            motivo = "Nenhuma hora de hoje fechada neste canal ainda."
        estados[c] = {"canal": c, "estado": "sem_dado" if motivo else "medido", "corte_hora": corte if not motivo else None,
                      "motivo": motivo}
        if not motivo:
            consultaveis.append(c)

    chave = (marca, tuple(pedidos), comparar, limite, hoje,
             tuple((c, estados[c]["corte_hora"]) for c in pedidos))
    guardado = _cache.get(chave)
    agora_s = datamart_leitura._agora()
    if guardado and agora_s - guardado[0] < CACHE_TTL_S:
        return copy.deepcopy(guardado[1])

    linhas: list[dict] = []
    falhou_tiktok = False
    if consultaveis:
        params: dict = {"marca": marca, "hoje": hoje, "comp": comp}
        for c in consultaveis:
            params[f"corte_{c}"] = estados[c]["corte_hora"]
        if "tiktok" in consultaveis:
            params["status_tiktok"] = list(TIKTOK_STATUS_COMERCIAIS)
        rapidos = [c for c in consultaveis if c != "tiktok"]
        if rapidos:
            linhas = consultar("\nUNION ALL\n".join(_ARMS[c] for c in rapidos), params)
        if "tiktok" in consultaveis:
            try:
                linhas = linhas + consultar(SQL_TIKTOK, params, timeout_metabase=TIMEOUT_TIKTOK_S)
            except Exception:  # noqa: BLE001 — texto do banco/Metabase nunca sai; o canal sai sem_dado
                logger.exception("produtos-gap: leitura do TikTok falhou ou estourou o orcamento")
                falhou_tiktok = True
                consultaveis.remove("tiktok")
                estados["tiktok"].update(estado="sem_dado", corte_hora=None,
                                         motivo="A leitura do TikTok demorou demais ou falhou; tente de novo em instantes.")
    # Canal sem nenhum pedido nos dois dias = ausencia (nao "tudo zero").
    com_dado = [c for c in consultaveis if any(r["canal"] == c for r in linhas)]
    for c in consultaveis:
        if c not in com_dado:
            estados[c].update(estado="sem_dado", corte_hora=None, motivo="Sem pedidos da marca neste canal nos dois dias.")

    skus = _agrega(linhas, com_dado)
    itens = [_item(k, v) for k, v in skus.items()]
    quedas = sorted((i for i in itens if i["diferenca_rs"] < 0), key=lambda i: (i["diferenca_rs"], i["sku"]))[:limite]
    altas = sorted((i for i in itens if i["diferenca_rs"] > 0), key=lambda i: (-i["diferenca_rs"], i["sku"]))[:TOP_ALTAS]

    # Estoque so' dos SKUs devolvidos, so' ML/Shopee (TikTok nao tem estoque Full).
    mostrados = quedas + altas
    estoque: dict[str, dict[str, dict]] = {}
    if mostrados:
        for canal, ler in (("ml", _estoque_ml), ("shopee", _estoque_shopee)):
            if canal not in com_dado:
                continue
            achados, aviso = ler(db, hoje, marca)
            if aviso:
                limitacoes.append(aviso)
            estoque[canal] = achados
        for i in mostrados:
            for canal in ("ml", "shopee"):
                if canal not in com_dado or not any(p["canal"] == canal for p in i["por_canal"]):
                    continue
                achado = estoque.get(canal, {}).get(i["sku"])
                i["estoque"].append(achado or {"canal": canal, "estado": "sem_dado", "full_vendavel": None,
                                               "estoque_vendedor_fora_do_full": None, "classificacao": None})

    tot = {k: round(sum(i[k] for i in itens), 2) for k in ("receita_hoje", "receita_comparado")}
    tot["diferenca_rs"] = round(tot["receita_hoje"] - tot["receita_comparado"], 2)
    tot["diferenca_pct"] = _pct(tot["diferenca_rs"], tot["receita_comparado"])
    if any(e["estado"] == "sem_dado" for e in estados.values()):
        limitacoes.append("Canal sem dado fica fora dos totais e da lista (ausencia, nao venda zero).")
    resultado = {
        "disponivel": bool(com_dado), "marca": marca, "dia": hoje.isoformat(), "dia_comparado": comp.isoformat(),
        "comparar": comparar,
        "fonte": "venda por hora por SKU (pedidos e itens do Data Mart), cada canal no seu corte; sem escalonamento por curva",
        "metodo": "mesmo_corte_de_hora", "canais": [estados[c] for c in pedidos],
        "total": tot if com_dado else None, "skus_considerados": len(itens) if com_dado else None,
        "maiores_quedas": quedas, "maiores_altas": altas, "limitacoes": limitacoes,
    }
    if falhou_tiktok:  # resposta degradada nao fica em cache: a proxima tentativa le de novo
        return resultado
    if len(_cache) >= _CACHE_MAX:
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]))
    _cache[chave] = (agora_s, copy.deepcopy(resultado))
    return resultado
