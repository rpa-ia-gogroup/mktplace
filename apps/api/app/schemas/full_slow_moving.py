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
    #: Pecas por dia em `dias`, por canal+envio ("ML-F", "SP-N"...), kit aberto em pecas. Vazio = sem venda.
    serie: dict[str, list[float]] = {}
    #: R$ vendido nos ultimos 15 dias, por canal+envio.
    receita_15d: dict[str, float] = {}


class SlowMovingResponse(BaseModel):
    status: str = "ok"
    fonte: str
    #: Dia da fotografia do Supply Intelligence (None = nao lido).
    atualizado_em: Optional[date] = None
    meta_dias: int
    #: Dias da `serie` de cada SKU (60, ate' ontem). Vazio = venda diaria indisponivel.
    dias: list[date] = []
    #: False = de-para/kits ou vendas nao lidos: a tela mostra so' os numeros do Supply.
    vendas_disponivel: bool = False
    skus: list[SkuSlowMoving]
    #: Capital de todo o estoque do Marketplace por marca (R$, a custo); vazio = nao lido.
    capital_marketplace: dict[str, float] = {}
    #: Capital no Full do Mercado Livre por marca (pecas no armazem x custo do Supply); vazio = nao lido.
    capital_full: dict[str, float] = {}
    #: Desse capital do Full, quanto e' de SKU em slow moving, por marca.
    parado_full: dict[str, float] = {}
