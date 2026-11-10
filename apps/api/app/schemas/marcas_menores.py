"""Contrato de `GET /api/v1/performance/marcas-menores` (fonte: API do Bling v3)."""
from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel


class PlataformaValor(BaseModel):
    plataforma: str
    faturamento: float


class DiaMarca(BaseModel):
    data: date
    faturamento: float
    por_plataforma: dict[str, float]


class MarcaMenor(BaseModel):
    id: str
    label: str
    #: "aguardando_autorizacao" = conta do Bling ainda nao autorizada (nao e' zero).
    status: str = "ok"
    #: `None` = nenhum pedido no periodo (sem dado), nunca 0.
    total: Optional[float] = None
    #: Mesma duracao, colado antes do inicio; `None` = sem base (nunca 0).
    total_anterior: Optional[float] = None
    por_plataforma: list[PlataformaValor] = []
    #: So' os dias com pedido; dia ausente e' sem dado.
    serie: list[DiaMarca] = []


class PeriodoBling(BaseModel):
    inicio: date
    fim: date


class Consolidado(BaseModel):
    total: Optional[float] = None
    total_anterior: Optional[float] = None
    por_plataforma: list[PlataformaValor] = []


class MarcasMenoresResponse(BaseModel):
    disponivel: bool
    motivo: Optional[str] = None
    consolidado: Optional[Consolidado] = None
    periodo: Optional[PeriodoBling] = None
    marcas: list[MarcaMenor] = []


class ProdutoLinha(BaseModel):
    sku: str
    produto: str
    quantidade: Optional[float] = None
    receita: Optional[float] = None


class ProdutosDaMarca(BaseModel):
    id: str
    label: str
    status: str = "ok"
    produtos: list[ProdutoLinha] = []


class ProdutosResponse(BaseModel):
    disponivel: bool
    motivo: Optional[str] = None
    #: False enquanto faltam itens de pedido (1 chamada cada, ~3/s): o front consulta de novo.
    completo: bool = True
    pedidos_total: int = 0
    pedidos_lidos: int = 0
    marcas: list[ProdutosDaMarca] = []
