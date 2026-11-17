"""SLOW-MOVING-1 -- SKUs parados no Marketplace, pela regra do Supply.

Fonte unica: `staging.si_disponibilidade` (Supply Intelligence, refeita todo
dia), a mesma do Painel S&OE. A regra (curva B/C, descontinuado ou brinde com
cobertura no Marketplace acima de 120 dias) e' do Supply: a Torre so' le' o
`slowmoving_marketplace_sn`, nao recalcula -- assim o numero bate com o painel.
"""
from __future__ import annotations

import logging
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


def _anotar_vendas(skus: list[SkuSlowMoving], consultar, hoje: date) -> list[date]:
    """Serie diaria (60 dias ate' ontem) e R$ dos ultimos 15 dias em cada SKU. Falha = [] (tela sem a serie)."""
    if not skus:
        return []
    dias = vendas.janela(hoje - timedelta(days=1))
    try:
        linhas = consultar(vendas.SQL_VENDAS, {"ini": dias[0], "fim": dias[-1], "skus": sorted({s.sku for s in skus})})
    except Exception:  # noqa: BLE001 -- vendas sao extra: a lista do Supply segue
        logger.exception("slow moving: vendas nao lidas")
        return []
    series = vendas.series_por_sku(linhas, len(dias), _marca)
    for s in skus:
        e = series.get((s.marca, s.sku))
        if e:
            s.serie = {ch: [round(v, 2) for v in serie] for ch, serie in e["q"].items()}
            s.receita_15d = {ch: round(sum(serie[-15:]), 2) for ch, serie in e["r"].items()}
    return dias


def get_slow_moving(consultar: Callable[[str, dict], list[dict]], hoje: Optional[date] = None) -> SlowMovingResponse:
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
    skus.sort(key=lambda s: s.valor_parado, reverse=True)
    dias = _anotar_vendas(skus, consultar, hoje or date.today())
    return SlowMovingResponse(fonte=FONTE, atualizado_em=dia[0]["dia"] if dia else None,
                              meta_dias=META_DIAS, dias=dias, vendas_disponivel=bool(dias), skus=skus)
