"""Contrato de `GET /api/v1/performance/marcas-menores` (fonte: API do Avoe)."""
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
    #: `None` = nenhuma linha no periodo (sem dado), nunca 0.
    total: Optional[float] = None
    por_plataforma: list[PlataformaValor] = []
    #: So' os dias com linha; dia ausente e' sem dado.
    serie: list[DiaMarca] = []


class PeriodoAvoe(BaseModel):
    inicio: date
    fim: date


class MarcasMenoresResponse(BaseModel):
    disponivel: bool
    motivo: Optional[str] = None
    periodo: Optional[PeriodoAvoe] = None
    #: Ultimo dia que a fonte entrega (D-1).
    dado_ate: Optional[date] = None
    #: O periodo pedido passava de `dado_ate` e foi recortado (ex.: filtro Hoje).
    ajustado: bool = False
    marcas: list[MarcaMenor] = []
