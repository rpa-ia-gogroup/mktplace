from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.period import resolve_period, today_brt
from app.schemas.marcas_menores import MarcasMenoresResponse, ProdutosResponse
from app.services import bling_token
from app.services import marcas_menores_service as svc
from app.services.bling_client import BlingCliente

router = APIRouter(prefix="/api/v1/performance", tags=["marcas-menores"])

_PLATAFORMA = {"shopee": "SHOPEE", "tiktok": "TIKTOK", "ml": "MELI"}


def cliente_bling(db: Session) -> BlingCliente:
    armazem = bling_token.ArmazemPg(db)
    atual: list[Optional[str]] = [None]  # 1 leitura do banco por requisicao, nao uma por chamada ao Bling

    def token() -> str:
        if atual[0] is None:
            atual[0] = bling_token.obter_access_token(armazem)
        return atual[0]

    def invalidar() -> None:
        atual[0] = None
        bling_token.invalidar(armazem)

    return BlingCliente(token=token, invalidar=invalidar)


@router.get("/marcas-menores", response_model=MarcasMenoresResponse)
def marcas_menores(date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None), db: Session = Depends(get_db)):
    """Yenzah, Auá e By Samia pelo Bling (Denavita: aguardando autorização).
    Fora do GMV total, da meta e da rosca da Gerencial."""
    hoje = today_brt()
    p = resolve_period(date_from=date_from, date_to=date_to, default_days=30, today=hoje)
    return svc.get_marcas_menores(cliente_bling(db), p.start, p.end, hoje)


@router.get("/marcas-menores/produtos", response_model=ProdutosResponse)
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
    return svc.get_produtos(cliente_bling(db), p.start, p.end, hoje, plataformas=plataformas, marcas=ids)
