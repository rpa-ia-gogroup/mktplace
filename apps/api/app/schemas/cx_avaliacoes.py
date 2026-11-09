"""Avaliacoes de produto da Shopee — schema de `GET /api/v1/cx/shopee/avaliacoes`.

Contrato: `docs/cx_atendimento_contrato.md` §3.3 e goca-se/airflow PR #2424.
Nota ACUMULADA (todas as avaliacoes ja' lidas), nao segue a janela da aba.
Sem texto de avaliacao (sem PII). Ausencia nunca vira zero; `truncado` = a
contagem e' um piso.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

from app.schemas.cx_atendimento import EstadoBloco


class AvaliacoesMarca(BaseModel):
    """Uma marca (ou o total, `marca="total"`). `sem_fonte` = nunca varrida: tudo None."""

    marca: str
    estado: Literal["dado", "sem_fonte"]
    motivo: Optional[str] = None
    itens: Optional[int] = None
    avaliacoes: Optional[int] = None
    com_nota: Optional[int] = None
    #: Media ponderada por `com_nota` (2 casas).
    nota_media: Optional[float] = None
    #: Avaliacoes de 1 a 3 estrelas / avaliacoes com nota, em % (1 casa).
    pct_1a3: Optional[float] = None
    #: Respondidas pela loja / avaliacoes, em % (1 casa).
    pct_respondidas: Optional[float] = None
    truncado: bool = False
    varrido_em: Optional[datetime] = None


class AvaliacoesProduto(BaseModel):
    marca: str
    item_id: str
    #: Nome do catalogo (`raw.shopee_products`); None = item fora do catalogo.
    nome: Optional[str] = None
    avaliacoes: int
    com_nota: int
    nota_media: Optional[float] = None
    avaliacoes_1a3: int
    pct_1a3: Optional[float] = None
    truncado: bool = False


class CxAvaliacoesResponse(BaseModel):
    gerado_em: datetime
    estado: EstadoBloco
    motivo_indisponivel: Optional[str] = None
    fonte: str
    #: Varredura mais recente e leitura completa mais recente entre as marcas com dado.
    varrido_em: Optional[datetime] = None
    completa_em: Optional[datetime] = None
    #: Marca com varredura mais velha que o limite; None = em dia.
    aviso_frescor: Optional[str] = None
    #: So' produtos com ao menos esta quantidade de avaliacoes com nota entram na lista.
    minimo_avaliacoes: int
    marcas: list[AvaliacoesMarca] = []
    total: Optional[AvaliacoesMarca] = None
    #: Produtos com `com_nota >= minimo_avaliacoes`, da pior nota para a melhor.
    produtos: list[AvaliacoesProduto] = []
