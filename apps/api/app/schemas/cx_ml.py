"""CX do Mercado Livre — schema de `GET /api/v1/cx/mercadolivre`.

Mesmas regras da Shopee (`cx_atendimento`): so' `dado` carrega numero, ausencia
nunca vira zero, `*_anterior` e' a mesma conta na janela anterior e
`sem_anterior` diz por que falta. Fonte: `raw.vw_ml_cx_diario` (dia x marca) e
`raw.ml_cx_reclamacoes` (fila e motivo). Contrato: `docs/cx_atendimento_contrato.md` §3.1 e §7.3.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

from app.schemas.account_performance import Cobertura
from app.schemas.cx_atendimento import BlocoMotivos, Janela, Pendencia, SemComparacao
from app.schemas.performance_oficial import ContaOficial, ContaSemFoto, EstadoCanal

#: Fonte: `dado` ou `erro` (a fonte falhou nesta carga; os campos dela ficam None).
EstadoFonte = Literal["dado", "erro"]
IndicadorMl = Literal["resposta", "reclamacao", "cancelamento", "mediacao", "reembolso", "devolucao"]


class LinhaMl(BaseModel):
    """Uma marca no ML. Campo None = nao medido, nunca 0."""
    marca: str
    pedidos: Optional[int] = None
    #: Reclamacoes (tipo mediations, sem cancelamento) abertas na janela, por data de abertura.
    reclamacoes: Optional[int] = None
    #: Pedidos cancelados na janela (`pedidos_cancelados` da view); taxa = cancelamentos / pedidos.
    cancelamentos: Optional[int] = None
    #: Reembolsos na janela (`reembolsos` da view) e o valor reembolsado (R$).
    reembolsos: Optional[int] = None
    valor_reembolsado: Optional[float] = None
    #: Reclamacoes que chegaram a mediacao (etapa `dispute`).
    mediacoes: Optional[int] = None
    #: Devolucoes na janela (`devolucoes` da view). None = algum dia sem leitura, nunca 0.
    devolucoes: Optional[int] = None
    perguntas: Optional[int] = None
    #: Perguntas da janela que ja' tem resposta (taxa de resposta = respondidas / perguntas).
    perguntas_respondidas: Optional[int] = None
    perguntas_anterior: Optional[int] = None
    perguntas_respondidas_anterior: Optional[int] = None
    #: A mesma conta na `janela_anterior`. None = sem base comparavel (ver `sem_anterior`).
    pedidos_anterior: Optional[int] = None
    reclamacoes_anterior: Optional[int] = None
    cancelamentos_anterior: Optional[int] = None
    reembolsos_anterior: Optional[int] = None
    mediacoes_anterior: Optional[int] = None
    devolucoes_anterior: Optional[int] = None
    #: AGORA (nao segue a janela): reclamacoes abertas com acao pendente do vendedor.
    aguardando_nos: Optional[int] = None
    #: Das que aguardam, as com prazo ja' vencido e as que vencem nas proximas 24 h.
    vencidas: Optional[int] = None
    vencem_24h: Optional[int] = None
    #: Prazo mais antigo entre as que aguardam (vencido = ha' quanto tempo).
    prazo_mais_antigo: Optional[datetime] = None
    #: AGORA: perguntas sem resposta (todas as que a coleta guarda), as com mais de 24 h (soma de
    #: `perguntas_sem_resposta_24h` da view em todos os dias) e a criacao da mais antiga.
    perguntas_sem_resposta: Optional[int] = None
    perguntas_sem_resposta_24h: Optional[int] = None
    pergunta_mais_antiga: Optional[datetime] = None
    #: Tempo de resposta a perguntas, valor OFICIAL do ML (media de 14 dias, 1 foto/dia).
    tempo_resposta_min: Optional[float] = None
    #: Mensagens pos-venda nao lidas (so' contagem), mesma foto.
    mensagens_pendentes: Optional[int] = None
    conta_dia: Optional[date] = None
    #: 1a acao do vendedor numa reclamacao da janela (mediana, horas). PARCIAL: o
    #: historico de acoes so' cobre as ~300 reclamacoes mais recentes de cada conta.
    resposta_mediana_h: Optional[float] = None
    #: Reclamacoes da janela com historico lido / com acao do vendedor nele.
    reclamacoes_com_historico: Optional[int] = None
    reclamacoes_respondidas: Optional[int] = None


class PontoDiaMl(BaseModel):
    """Um dia de uma marca; o front soma as marcas do recorte (marca None no dia anula o ponto)."""
    dia: date
    marca: str
    pedidos: Optional[int] = None
    reclamacoes: Optional[int] = None
    cancelamentos: Optional[int] = None
    reembolsos: Optional[int] = None
    mediacoes: Optional[int] = None
    devolucoes: Optional[int] = None


class ReputacaoMl(BaseModel):
    """Saude da conta no ML: reputacao OFICIAL (termometro, MercadoLider, metricas com limite)."""
    estado: EstadoCanal
    motivo: Optional[str] = None
    fonte: str
    contas: list[ContaOficial] = []
    sem_foto: list[ContaSemFoto] = []


class CxMercadoLivreResponse(BaseModel):
    gerado_em: datetime
    janela: Janela
    janela_anterior: Optional[Janela] = None
    cobertura: Cobertura
    #: `raw.vw_ml_cx_diario` (pedidos, contagens por dia, perguntas, foto da conta).
    diario_estado: EstadoFonte = "dado"
    #: `raw.ml_cx_reclamacoes` (fila, motivos, 1a resposta).
    reclamacoes_estado: EstadoFonte = "dado"
    motivo_indisponivel: Optional[str] = None
    reputacao: Optional[ReputacaoMl] = None
    marcas: list[LinhaMl] = []
    reclamacoes_motivos: Optional[BlocoMotivos] = None
    cancelamentos_motivos: Optional[BlocoMotivos] = None
    serie_diaria: list[PontoDiaMl] = []
    sem_anterior: dict[IndicadorMl, SemComparacao] = {}
    pendencias: list[Pendencia] = []
    #: Coleta mais recente (`captured_at`) entre as marcas; base do aviso de dado velho.
    atualizado_em: Optional[datetime] = None
    aviso_frescor: Optional[str] = None
    #: Primeiro dia coberto pela coleta de reclamacoes (carga inicial de 90 dias).
    coleta_desde: date
