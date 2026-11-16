"""GET /auth/permitido?email=... — o login do Next pergunta aqui se o e-mail entra.

A lista (ALLOWED_EMAIL_DOMAINS: dominios e e-mails avulsos) vive so' no Render.
So' com `x-torre-service-key`; a resposta nunca lista dominios nem e-mails.
"""
from __future__ import annotations

import hmac
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from app.config import settings
from app.sessao import SEGREDO_MINIMO, dominios_permitidos, email_permitido

router = APIRouter(tags=["auth"])


@router.get("/auth/permitido")
def permitido(
    email: str = Query(..., max_length=254),
    x_torre_service_key: Optional[str] = Header(None, alias="x-torre-service-key"),
) -> dict:
    esperada = settings.torre_service_key.get_secret_value().strip()
    if not (
        x_torre_service_key
        and len(esperada) >= SEGREDO_MINIMO
        and hmac.compare_digest(x_torre_service_key.encode("utf-8"), esperada.encode("utf-8"))
    ):
        raise HTTPException(401, "Nao autorizado.")
    return {"permitido": email_permitido(email, dominios_permitidos(settings.allowed_email_domains))}
