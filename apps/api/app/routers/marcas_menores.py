from datetime import date
from typing import Optional

from fastapi import APIRouter, Query

from app.deps.period import resolve_period, today_brt
from app.schemas.marcas_menores import MarcasMenoresResponse, ProdutosDenavitaTiktok
from app.services import datamart_leitura, marcas_menores_service as svc

router = APIRouter(prefix="/api/v1/performance", tags=["marcas-menores"])


@router.get("/marcas-menores", response_model=MarcasMenoresResponse)
def marcas_menores(date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None)):
    """Denavita, Yenzah, Auá e By Samia pela API do Avoe (so' ate' D-1).
    Fora do GMV total, da meta e da rosca da Gerencial."""
    hoje = today_brt()
    p = resolve_period(date_from=date_from, date_to=date_to, default_days=30, today=hoje)
    return svc.get_marcas_menores(p.start, p.end, hoje)


@router.get("/marcas-menores/produtos", response_model=ProdutosDenavitaTiktok)
def marcas_menores_produtos(date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None)):
    """Produto x quantidade x receita: so' Denavita no TikTok (Data Mart). As demais
    marcas e canais nao tem item em fonte nenhuma. Bloco proprio: falha sozinho."""
    p = resolve_period(date_from=date_from, date_to=date_to, default_days=30, today=today_brt())
    return svc.get_produtos_denavita_tiktok(datamart_leitura.consultar, p.start, p.end)
