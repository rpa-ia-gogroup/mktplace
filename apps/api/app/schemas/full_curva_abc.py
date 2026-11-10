"""CURVA-ABC-1 -- contrato da curva ABC do /full (rota /full-curva-abc)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


Curva = Literal["AA", "A", "B", "C"]
#: Por que o item ficou sem curva (com a planilha lida): kit nao tem curva
#: propria; `sem_ponte` = o codigo do canal nao liga a nenhum SKU da planilha;
#: `marca_fora` = a marca nao aparece na planilha.
CurvaMotivo = Literal["kit", "sem_ponte", "marca_fora"]


#: Tira o item da fila e dos numeros do topo (brinde nao e' perda de venda; descontinuado nao se repoe).
#: None = conta normal (inclui SKU fora da BD e BD nao lida).
Situacao = Literal["brinde", "descontinuado"]


class CurvaMeta(BaseModel):
    """PR3: curva ABC nas listas de estoque do Full (Shopee e ML)."""
    #: False = planilha nao lida (sem credencial, falha, formato): todo item
    #: vem com `curva` None e `curva_motivo` None; o motivo fica aqui. Nunca "C".
    disponivel: bool
    motivo: Optional[str] = None
    lida_em: Optional[datetime] = None
    itens_com_curva: int = 0
    itens_total: int = 0
    #: A aba BD (Status) foi lida? False = ninguem sai da fila por situacao.
    bd_lida: bool = False
    brindes: int = 0
    descontinuados: int = 0


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
    #: "marca|SKU do canal" -> brinde | descontinuado (aba BD). Fora daqui = conta normal.
    situacao_por_sku: dict[str, Situacao] = Field(default_factory=dict)
    bd_lida: bool = False
    #: Marcas que a BD traz e SKUs com status conflitante (conferencia da chave marca+SKU).
    bd_marcas: list[str] = Field(default_factory=list)
    bd_conflitos: list[str] = Field(default_factory=list)
    #: Leitura nova falhou, mas a anterior (dentro do cache) segue valendo.
    aviso: Optional[str] = None
