"""CX do site (DTC) — `GET /api/v1/cx/site?brands=&dias=30|90`.

Mesma flag (`cx_api_enabled`) e mesmo filtro de marcas da aba CX. SOMENTE GET;
entrada fora da allowlist vira 422 com mensagem fixa.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.routers.cx_atendimento import brands_query, exigir_flag
from app.schemas.cx_site import JANELAS_SITE, CxSiteResponse
from app.services import cx_site_service as svc

router = APIRouter(prefix="/api/v1/cx", tags=["cx"], dependencies=[Depends(exigir_flag)])

_MSG_DIAS = "Janela invalida. Valores aceitos: " + ", ".join(str(d) for d in JANELAS_SITE)


def dias_site(dias: Optional[str] = Query(None, description="Dias fechados ate' ontem: 30 ou 90.")) -> int:
    if dias is None:
        return svc.JANELA_PADRAO_DIAS
    if not dias.isdigit() or int(dias) not in JANELAS_SITE:
        raise HTTPException(422, _MSG_DIAS)
    return int(dias)


@router.get("/site", response_model=CxSiteResponse)
def cx_site(
    brands: Optional[list[str]] = Depends(brands_query),
    dias: int = Depends(dias_site),
):
    """NPS, reenvio/reembolso e reviews por produto do site, cada bloco com estado explicito."""
    return svc.montar_cx_site(brands=brands, dias=dias)
