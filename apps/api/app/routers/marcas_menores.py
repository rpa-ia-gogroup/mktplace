import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.period import resolve_period, today_brt
from app.schemas.marcas_menores import (
    Consolidado,
    MarcaMenor,
    MarcasMenoresResponse,
    ProdutosDaMarca,
    ProdutosResponse,
)
from app.services import bling_token, bling_warm
from app.services import marcas_menores_service as svc
from app.services.bling_cache import ArmazemCachePg
from app.services.bling_client import BlingCliente, cliente_com_sessao

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/performance", tags=["marcas-menores"])

_PLATAFORMA = {"shopee": "SHOPEE", "tiktok": "TIKTOK", "ml": "MELI"}


# T-0119: campos novos do contrato (fonte provisoria da Denavita). Ficam aqui porque o arquivo de
# schemas esta' fora do escopo desta tarefa; sem eles o `response_model` descartaria aviso/motivo/parcial.
class MarcaMenorComFonte(MarcaMenor):
    #: Fonte provisoria (ex.: Denavita pelo TikTok do Data Mart): de onde vem o numero e o que falta.
    aviso: Optional[str] = None
    #: Por que `total` e' None quando a fonte falhou (ex.: "Data Mart indisponivel"); nunca 0.
    motivo: Optional[str] = None


class ConsolidadoComParcial(Consolidado):
    #: True = o total nao cobre todas as marcas/canais (ex.: Shopee da Denavita pendente).
    parcial: bool = False
    aviso: Optional[str] = None


class MarcasMenoresComFonte(MarcasMenoresResponse):
    consolidado: Optional[ConsolidadoComParcial] = None
    marcas: list[MarcaMenorComFonte] = []


class ProdutosDaMarcaComMotivo(ProdutosDaMarca):
    #: Por que a marca nao tem itens (Denavita: itens so' pelo Bling, conta sem autorizacao).
    motivo: Optional[str] = None


class ProdutosComMotivo(ProdutosResponse):
    marcas: list[ProdutosDaMarcaComMotivo] = []


def cliente_bling(db: Session) -> BlingCliente:
    return cliente_com_sessao(db)


def bling_denavita(db: Optional[Session]) -> tuple[Optional[BlingCliente], Optional[str]]:
    """(cliente, motivo): cliente do Bling da Denavita so' com app configurado e token gravado (callback OAuth).
    Sem isso, (None, motivo): a Denavita segue pelo caminho provisorio e a resposta diz por que."""
    if db is None:
        return None, "Bling da Denavita: banco indisponível."
    if not all(bling_token.credenciais(bling_token.CONTA_DENAVITA)):
        return None, "Bling da Denavita: app sem credencial na API (BLING_DENAVITA_CLIENT_ID/SECRET)."
    try:
        if bling_token.ArmazemPg(db).ler(bling_token.CONTA_DENAVITA) is None:
            return None, "Bling da Denavita: conta ainda sem autorização (sem token gravado)."
    except Exception as exc:  # noqa: BLE001 - banco fora: segue sem o Bling dela
        logger.warning("marcas_menores: token da Denavita ilegivel (%s)", type(exc).__name__)
        return None, "Bling da Denavita: token ilegível no banco."
    return cliente_com_sessao(db, bling_token.CONTA_DENAVITA), None


def cliente_bling_denavita(db: Optional[Session]) -> Optional[BlingCliente]:
    return bling_denavita(db)[0]


def cache_bling(db: Session):
    """Cache persistente (lista e itens), aquecido pela rotina; None sem banco."""
    return ArmazemCachePg(db) if db is not None else None


@router.get("/marcas-menores", response_model=MarcasMenoresComFonte)
def marcas_menores(date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None), db: Session = Depends(get_db)):
    """Yenzah, Auá e By Samia pelo Bling da Rituária. Denavita: ML e Shopee pelo Bling dela (quando a
    conta tem token) e TikTok via Data Mart (gold.tiktok_brand_daily); sem token, só o TikTok (fonte
    provisória) e o consolidado vem `parcial`.
    Fora do GMV total, da meta e da rosca da Gerencial."""
    hoje = today_brt()
    p = resolve_period(date_from=date_from, date_to=date_to, default_days=30, today=hoje)
    cli_den, motivo_den = bling_denavita(db)
    return svc.get_marcas_menores(
        cliente_bling(db), p.start, p.end, hoje, cache=cache_bling(db), ao_faltar_cache=bling_warm.disparar_em_segundo_plano,
        consultar_dm=svc.consultar_datamart, cli_denavita=cli_den, motivo_sem_bling_denavita=motivo_den,
    )


@router.get("/marcas-menores/produtos", response_model=ProdutosComMotivo)
def marcas_menores_produtos(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    canais: Optional[str] = Query(None, description="shopee,tiktok,ml; vazio = todos"),
    marcas: Optional[str] = Query(None, description="ids das marcas; vazio = todas"),
    db: Session = Depends(get_db),
):
    """Produto x quantidade x receita por marca (itens dos pedidos do Bling). Bloco próprio:
    falha sozinho e pode vir parcial (`completo=false`) enquanto os itens são lidos."""
    hoje = today_brt()
    p = resolve_period(date_from=date_from, date_to=date_to, default_days=30, today=hoje)
    plataformas = [_PLATAFORMA[c] for c in canais.split(",") if c in _PLATAFORMA] if canais else None
    ids = [m for m in marcas.split(",") if m] if marcas else None
    return svc.get_produtos(
        cliente_bling(db), p.start, p.end, hoje, plataformas=plataformas, marcas=ids,
        cache=cache_bling(db), ao_faltar_cache=bling_warm.disparar_em_segundo_plano,
    )
