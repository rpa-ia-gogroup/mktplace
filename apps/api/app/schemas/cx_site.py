"""CX do site (DTC) — schema de `GET /api/v1/cx/site`.

Tres blocos independentes, cada um com estado explicito (ausencia nunca vira
zero): NPS, reenvio/reembolso e reviews por produto. Sem PII: nada de nome,
e-mail, pedido nem texto de comentario; reviews so' em agregados por produto.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

from app.schemas.account_performance import MarcaFora
from app.schemas.cx_atendimento import EstadoBloco, Janela, SemComparacao

#: Janelas aceitas (dias fechados ate' D-1).
JANELAS_SITE: tuple[int, ...] = (30, 90)


class Bloco(BaseModel):
    estado: EstadoBloco
    fonte: str
    #: Ultima carga da tabela (`_loaded_at`), independente da janela.
    atualizado_em: Optional[datetime] = None
    aviso_frescor: Optional[str] = None
    motivo_indisponivel: Optional[str] = None
    fora: list[MarcaFora] = []
    #: API-3: por que o bloco nao tem periodo anterior e quando passa a ter. None = tem.
    sem_anterior: Optional[SemComparacao] = None


class NpsMarca(BaseModel):
    marca: str
    respostas: int
    nps: float
    promotores_pct: float
    detratores_pct: float


class PontoNps(BaseModel):
    """Um dia. Contagens para o front somar por semana e recalcular o NPS
    (media de NPS nao vale). Dia sem medida = tudo None; 0 respostas = nps None."""
    dia: date
    respostas: Optional[int] = None
    promotores: Optional[int] = None
    detratores: Optional[int] = None
    nps: Optional[float] = None


class BlocoNps(Bloco):
    respostas: Optional[int] = None
    nps: Optional[float] = None
    promotores_pct: Optional[float] = None
    neutros_pct: Optional[float] = None
    detratores_pct: Optional[float] = None
    marcas: list[NpsMarca] = []
    #: API-3: o mesmo na `janela_anterior`; None = sem medida (motivo em `sem_anterior`).
    respostas_anterior: Optional[int] = None
    nps_anterior: Optional[float] = None
    promotores_pct_anterior: Optional[float] = None
    detratores_pct_anterior: Optional[float] = None
    serie: list[PontoNps] = []


class ReenvioMarca(BaseModel):
    marca: str
    reenvios: int
    reembolsos: int
    valor_reenvio: float
    valor_reembolso: float
    #: Linhas sem `valor_nf_tratado` (contam na quantidade, nao no valor).
    sem_valor: int
    #: Receita do e-commerce da marca nas safras. None = sem faturamento.
    faturamento: Optional[float] = None
    taxa_reenvio_pct: Optional[float] = None
    taxa_reembolso_pct: Optional[float] = None


class PontoSafra(BaseModel):
    """Uma safra (mes do pedido original). Taxa None = sem faturamento do mes."""
    safra: date
    taxa_reenvio_pct: Optional[float] = None
    taxa_reembolso_pct: Optional[float] = None


class BlocoReenvio(Bloco):
    #: Meses de safra (mes do pedido original) cobertos: so' meses fechados.
    safra_inicio: date
    safra_fim: date
    reenvios: Optional[int] = None
    reembolsos: Optional[int] = None
    valor_reenvio: Optional[float] = None
    valor_reembolso: Optional[float] = None
    sem_valor: Optional[int] = None
    taxa_reenvio_pct: Optional[float] = None
    taxa_reembolso_pct: Optional[float] = None
    #: Preenchido quando a taxa nao sai (ex.: faturamento ausente).
    motivo_sem_taxa: Optional[str] = None
    marcas: list[ReenvioMarca] = []
    #: API-3: safras anteriores do mesmo tamanho e a taxa nelas (mesma regra).
    safra_anterior_inicio: Optional[date] = None
    safra_anterior_fim: Optional[date] = None
    taxa_reenvio_pct_anterior: Optional[float] = None
    taxa_reembolso_pct_anterior: Optional[float] = None
    #: Uma por safra, das anteriores ate' as atuais (2 em 30 dias, 6 em 90).
    serie: list[PontoSafra] = []


class NotaAgregada(BaseModel):
    reviews: int
    media: float
    #: % de reviews com 1 a 3 estrelas.
    baixas_pct: float


class ReviewsMarca(NotaAgregada):
    marca: str


class ReviewsProduto(NotaAgregada):
    marca: str
    produto: str


class PontoReviews(BaseModel):
    """Um dia. `baixas` (1-3 estrelas) em contagem, para o front somar por semana."""
    dia: date
    reviews: Optional[int] = None
    baixas: Optional[int] = None
    baixas_pct: Optional[float] = None


class BlocoReviews(Bloco):
    #: Ultima review que chegou ao Data Mart (mostra ate' onde a carga foi).
    ultima_review_em: Optional[datetime] = None
    reviews: Optional[int] = None
    media: Optional[float] = None
    baixas_pct: Optional[float] = None
    marcas: list[ReviewsMarca] = []
    minimo_reviews: int
    piores: list[ReviewsProduto] = []
    melhores: list[ReviewsProduto] = []
    #: API-3: o mesmo na `janela_anterior`.
    reviews_anterior: Optional[int] = None
    baixas_pct_anterior: Optional[float] = None
    serie: list[PontoReviews] = []


class CxSiteResponse(BaseModel):
    gerado_em: datetime
    janela: Janela
    #: API-3: os mesmos `dias` antes de `janela` (base de `*_anterior` de NPS e reviews).
    janela_anterior: Optional[Janela] = None
    nps: BlocoNps
    reenvio_reembolso: BlocoReenvio
    reviews: BlocoReviews
