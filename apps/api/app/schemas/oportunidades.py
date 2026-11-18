"""OPORTUNIDADES-1 -- contrato do top de oportunidades (rota /oportunidades)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class Oportunidade(BaseModel):
    #: ruptura_full = venda perdida no Full; capital_parado = slow moving no Marketplace.
    tipo: Literal["ruptura_full", "capital_parado"]
    #: "ml" | "shopee" na ruptura; None no capital parado (Marketplace inteiro).
    canal: Optional[str] = None
    marca: str
    sku: Optional[str] = None
    titulo: str
    #: R$ em `dias` dias: venda recuperada (ruptura) ou custo que sai do estoque (capital parado).
    valor_30d: float
    acao: str
    motivo: str


class OportunidadesResponse(BaseModel):
    dias: int
    geral: list[Oportunidade]
    por_marca: dict[str, list[Oportunidade]]
    #: Fonte que falhou nesta chamada (a outra segue): "ruptura_full" | "capital_parado".
    fontes_indisponiveis: list[str] = []
