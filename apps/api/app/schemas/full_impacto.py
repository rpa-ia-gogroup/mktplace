"""Contrato do impacto POTENCIAL da ruptura no Full — FULL-IMPACTO-1.

`None` e' "nao sabemos" (sem preco, GMV incompleto, canal fora), nunca zero.
Valores em R$/dia; percentuais como fracao 0..1. R$ nao e' somado entre canais.
"""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional, Union

from pydantic import BaseModel


class ItemImpacto(BaseModel):
    brand: str
    sku: Optional[str] = None
    titulo: Optional[str] = None
    media_diaria_28d: float
    preco_medio: Optional[float] = None
    #: "vendas_30d" (ML), "anuncio" (ML, fallback) ou "mes" (Shopee).
    fonte_preco: Optional[Literal["vendas_30d", "anuncio", "mes"]] = None
    mes_preco: Optional[date] = None
    #: So' Shopee. `None` no ML (nao se aplica) ou quando a API nao informa.
    estoque_vendedor: Optional[int] = None
    perda_dia: Optional[float] = None


class MarcaImpacto(BaseModel):
    brand: str
    rupturas: int
    sem_preco: int
    perda_dia: Optional[float] = None
    perda_dia_sem_vendedor: Optional[float] = None
    gmv_full_dia: Optional[float] = None
    pct_gmv_full: Optional[float] = None
    pct_gmv_full_sem_vendedor: Optional[float] = None


class CanalImpactoOk(BaseModel):
    canal: Literal["ml", "shopee"]
    status: Literal["ok"] = "ok"
    ref_date: date
    rupturas: int
    sem_preco: int
    preco_fallback: int
    sem_estoque_vendedor: Optional[int] = None
    perda_dia: Optional[float] = None
    perda_dia_sem_vendedor: Optional[float] = None
    gmv_full_dia: Optional[float] = None
    dias_gmv: int
    #: Janela do %: os 28 dias que terminam no ultimo dia com faturamento Full
    #: carregado, ate' a vespera da foto. `None` = sem faturamento na janela.
    janela_gmv_inicio: Optional[date] = None
    janela_gmv_fim: Optional[date] = None
    pct_gmv_full: Optional[float] = None
    pct_gmv_full_sem_vendedor: Optional[float] = None
    motivo_pct: Optional[str] = None
    marcas: list[MarcaImpacto]
    itens: list[ItemImpacto]


class CanalImpactoIndisponivel(BaseModel):
    canal: Literal["ml", "shopee"]
    status: Literal["unavailable"] = "unavailable"
    motivo: str


CanalImpacto = Union[CanalImpactoOk, CanalImpactoIndisponivel]


class ImpactoRupturaResponse(BaseModel):
    ml: CanalImpacto
    shopee: CanalImpacto
    janela_gmv_dias: int
    limitacoes: list[str]
