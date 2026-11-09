"""CURVA-ABC-1 -- contrato da curva ABC do /full (rota /full-curva-abc)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class CurvaAbcResponse(BaseModel):
    #: `unavailable`: sem credencial, leitura falhou ou formato mudou. O /full
    #: segue sem curva; nunca vira "C".
    status: Literal["ok", "unavailable"]
    motivo: Optional[str] = None
    fonte: str
    lida_em: Optional[datetime] = None
    itens_planilha: Optional[int] = None
    pela_ponte_gtin: Optional[int] = None
    #: "marca|SKU Unico" repetidos na fonte (vale a linha de maior faturamento).
    duplicadas: list[str] = Field(default_factory=list)
    #: "marca|SKU do canal" -> AA | A | B | C. Fora daqui = sem curva.
    curva_por_sku: dict[str, Literal["AA", "A", "B", "C"]] = Field(default_factory=dict)
    #: Leitura nova falhou, mas a anterior (dentro do cache) segue valendo.
    aviso: Optional[str] = None
