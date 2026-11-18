"""SLOW-MOVING-1 -- SKUs parados no Marketplace, pela regra do Supply.

Fonte unica: `staging.si_disponibilidade` (Supply Intelligence, refeita todo
dia), a mesma do Painel S&OE. A regra (curva B/C, descontinuado ou brinde com
cobertura no Marketplace acima de 120 dias) e' do Supply: a Torre so' le' o
`slowmoving_marketplace_sn`, nao recalcula -- assim o numero bate com o painel.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
import unicodedata
from datetime import date, timedelta
from typing import Callable, Optional

from app.schemas.full_slow_moving import SkuSlowMoving, SlowMovingResponse
from app.services import slow_moving_vendas as vendas
from app.services.gold_service import BRANDS_IN_SCOPE

logger = logging.getLogger(__name__)

META_DIAS = 120
FONTE = "Supply Intelligence (Painel S&OE) · canal Marketplace"

SQL_SLOW = """
SELECT marca, chave, sku_unico, descricao, categoria, curva, status, custo_und,
       consumo_marketplace, cobertura_marketplace, slow_moving_marketplace_rs
  FROM staging.si_disponibilidade
 WHERE slowmoving_marketplace_sn = 'S'
"""
SQL_DIA = "SELECT MAX(date_created)::date AS dia FROM staging.si_historical_stock"
#: Capital de TODO o estoque do Marketplace por marca (base da % do capital parado): no slow moving,
#: o R$ que o Supply guarda; nos demais, custo x venda/dia x cobertura (= pecas x custo).
SQL_CAPITAL_TOTAL = """
SELECT marca,
       SUM(CASE WHEN slowmoving_marketplace_sn = 'S' THEN COALESCE(slow_moving_marketplace_rs, 0)
                ELSE COALESCE(custo_und, 0) * COALESCE(consumo_marketplace, 0) * COALESCE(cobertura_marketplace, 0)
           END) AS capital
  FROM staging.si_disponibilidade
 GROUP BY marca
"""


def _marca(nome: Optional[str]) -> str:
    s = unicodedata.normalize("NFD", str(nome or "")).encode("ascii", "ignore").decode().lower()
    return "".join(c for c in s if c.isalpha())


def _num(v) -> Optional[float]:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _sku(r: dict) -> str:
    # `chave` vem "BB-BB02084"; `sku_unico` as vezes vazio.
    sku = str(r.get("sku_unico") or "").strip()
    return sku or str(r.get("chave") or "").split("-", 1)[-1].strip()


def _anotar_vendas(skus: list[SkuSlowMoving], consultar, hoje: date, lookups) -> list[date]:
    """Serie diaria por canal (60 dias ate' ontem) e R$ dos ultimos 15 dias em cada SKU. Falha = [] (tela sem a serie)."""
    lk = lookups() if skus else None
    if not lk:
        return []
    dias = vendas.janela(hoje - timedelta(days=1))
    try:
        # As 3 em paralelo: cada uma pode ir ao Metabase, e em serie a 1a carga passava de 25 s.
        with ThreadPoolExecutor(max_workers=3) as ex:
            futuros = {c: ex.submit(consultar, vendas.sql_canal(c), {"ini": dias[0], "fim": dias[-1]}) for c in ("ML", "SP", "TT")}
            linhas = {c: f.result() for c, f in futuros.items()}
    except Exception:  # noqa: BLE001 -- vendas sao extra: a lista do Supply segue
        logger.exception("slow moving: vendas nao lidas")
        return []
    series = vendas.series_por_sku(linhas, len(dias), lk[0], lk[1])
    for s in skus:
        e = series.get((s.marca, vendas.ncode(s.sku)))
        if e:
            s.serie = {ch: [round(v, 2) for v in serie] for ch, serie in e["q"].items()}
            s.receita_15d = {ch: round(sum(serie[-15:]), 2) for ch, serie in e["r"].items()}
    return dias


def get_slow_moving(consultar: Callable[[str, dict], list[dict]], hoje: Optional[date] = None,
                    lookups: Callable = vendas.obter_lookups) -> SlowMovingResponse:
    skus = []
    for r in consultar(SQL_SLOW, {}):
        marca = _marca(r.get("marca"))
        if marca not in BRANDS_IN_SCOPE:
            continue
        valor = _num(r.get("slow_moving_marketplace_rs")) or 0.0
        custo = _num(r.get("custo_und"))
        venda = _num(r.get("consumo_marketplace")) or 0.0
        cob = _num(r.get("cobertura_marketplace"))
        # Pecas: o Supply guarda o R$ parado; sem custo, cobertura x venda/dia.
        estoque = valor / custo if custo else (cob * venda if cob is not None and venda else None)
        skus.append(SkuSlowMoving(
            marca=marca, sku=_sku(r), descricao=str(r.get("descricao") or "").strip(),
            categoria=r.get("categoria") or None, curva=r.get("curva") or None, status=r.get("status") or None,
            estoque=round(estoque) if estoque is not None else None, custo_unitario=custo,
            valor_parado=valor, venda_dia=venda, cobertura_dias=cob if venda > 0 else None,
        ))
    dia = consultar(SQL_DIA, {})
    capital: dict[str, float] = {}
    try:
        for r in consultar(SQL_CAPITAL_TOTAL, {}):
            m = _marca(r.get("marca"))
            if m in BRANDS_IN_SCOPE:
                capital[m] = round(capital.get(m, 0.0) + (_num(r.get("capital")) or 0.0), 2)
    except Exception:  # noqa: BLE001 -- sem a base, a tela so' nao mostra a %
        capital = {}
    skus.sort(key=lambda s: s.valor_parado, reverse=True)
    dias = _anotar_vendas(skus, consultar, hoje or date.today(), lookups)
    return SlowMovingResponse(fonte=FONTE, atualizado_em=dia[0]["dia"] if dia else None,
                              meta_dias=META_DIAS, dias=dias, vendas_disponivel=bool(dias), skus=skus,
                              capital_marketplace=capital)
