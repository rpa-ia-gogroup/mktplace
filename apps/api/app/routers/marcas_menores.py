from datetime import date
from typing import Optional

from fastapi import APIRouter, Query

from app.deps.period import resolve_period, today_brt
from app.schemas.marcas_menores import MarcasMenoresResponse
from app.services import marcas_menores_service as svc

router = APIRouter(prefix="/api/v1/performance", tags=["marcas-menores"])


@router.get("/marcas-menores", response_model=MarcasMenoresResponse)
def marcas_menores(date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None)):
    """Denavita, Yenzah, Auá e By Samia pela API do Avoe (so' ate' D-1).
    Fora do GMV total, da meta e da rosca da Gerencial."""
    hoje = today_brt()
    p = resolve_period(date_from=date_from, date_to=date_to, default_days=30, today=hoje)
    return svc.get_marcas_menores(p.start, p.end, hoje)
