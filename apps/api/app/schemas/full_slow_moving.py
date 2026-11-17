"""SLOW-MOVING-1 -- contrato da aba Slow Moving do /full (rota /full-slow-moving)."""
from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel


class SkuSlowMoving(BaseModel):
    marca: str
    sku: str
    descricao: str
    categoria: Optional[str] = None
    curva: Optional[str] = None
    status: Optional[str] = None
    #: Pecas no estoque destinado ao Marketplace (valor parado / custo unitario).
    estoque: Optional[float] = None
    custo_unitario: Optional[float] = None
    #: R$ parado (a custo) no Marketplace, como o Supply calcula.
    valor_parado: float
    #: Venda media por dia nos ultimos 15 dias, no Marketplace.
    venda_dia: float
    #: Dias de estoque no ritmo atual (None = sem venda).
    cobertura_dias: Optional[float] = None


class SlowMovingResponse(BaseModel):
    status: str = "ok"
    fonte: str
    #: Dia da fotografia do Supply Intelligence (None = nao lido).
    atualizado_em: Optional[date] = None
    meta_dias: int
    skus: list[SkuSlowMoving]
