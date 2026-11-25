"""Diagnostico do Bling da Denavita (admin): canais, mapa de lojas e pedidos por loja e semana.

GET /api/v1/bling/diagnostico/denavita?de=2026-10-15&ate=2026-11-25

So' admin (sessao + TORRE_ADMIN_EMAILS). Sem token e sem dado pessoal na resposta.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.chaves_pessoais import exigir_admin
from app.services import bling_diagnostico_service as diag
from app.services.bling_client import cliente_denavita
from app.services.bling_token import BlingIndisponivel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/bling/diagnostico", tags=["bling-diagnostico"])


@router.get("/denavita")
def diagnostico_denavita(
    de: date = Query(...),
    ate: date = Query(...),
    admin: str = Depends(exigir_admin),
    db: Optional[Session] = Depends(get_db),
) -> dict:
    if de > ate:
        raise HTTPException(422, "`de` posterior a `ate`.")
    if (ate - de).days + 1 > diag.MAX_DIAS:
        raise HTTPException(422, f"Periodo maximo de {diag.MAX_DIAS} dias.")
    cli, motivo = cliente_denavita(db)
    if cli is None:
        raise HTTPException(503, motivo or "Bling da Denavita indisponível.")
    try:
        resposta = diag.diagnosticar(cli, de, ate)
    except BlingIndisponivel as exc:  # motivo ja' sanitizado
        raise HTTPException(502, str(exc)) from exc
    logger.info("bling diagnostico denavita por=%s periodo=%s..%s", admin, de, ate)
    return resposta
