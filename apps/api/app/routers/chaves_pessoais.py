"""CHAVES-PESSOAIS — rotas das chaves `torre_pat_...` (servico em `app/services/chaves_pessoais.py`).

POST /api/v1/chaves/validar        so' com `x-torre-service-key` (o MCP da Vercel)
GET  /api/v1/chaves                admin: lista (sem chave, sem hash)
POST /api/v1/chaves                admin: cria; a chave volta UMA vez
POST /api/v1/chaves/{id}/revogar   admin

Admin = sessao do login Google (cookie) com e-mail em TORRE_ADMIN_EMAILS. As
rotas checam isso sozinhas, sem depender do modo do gate; chave pessoal nao
administra chave. Mensagens fixas: nada da excecao volta na resposta.
"""
from __future__ import annotations

import hmac
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.services import chaves_pessoais as svc
from app.sessao import SEGREDO_MINIMO, SESSION_COOKIE, dominios_permitidos, email_permitido, validar_sessao

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chaves", tags=["chaves"])


class ValidarRequest(BaseModel):
    chave: str = Field(max_length=200)


class CriarRequest(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    dono_email: str = Field(min_length=3, max_length=254)
    dias: int = Field(default=svc.DIAS_PADRAO, ge=1, le=svc.DIAS_MAXIMO)


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _banco(db: Optional[Session]) -> Session:
    if db is None:
        raise HTTPException(503, "Banco de dados indisponivel.")
    return db


def admins() -> set[str]:
    return {e.strip().lower() for e in settings.torre_admin_emails.split(",") if e.strip()}


def exigir_admin(request: Request) -> str:
    sessao = validar_sessao(
        request.cookies.get(SESSION_COOKIE),
        settings.auth_secret.get_secret_value().strip(),
        dominios_permitidos(settings.allowed_email_domains),
    )
    if sessao is None:
        raise HTTPException(401, "Autenticação obrigatória.")
    if sessao.email not in admins():
        raise HTTPException(403, "Acesso restrito.")
    return sessao.email


@router.post("/validar")
def validar_chave(
    corpo: ValidarRequest,
    x_torre_service_key: Optional[str] = Header(None, alias="x-torre-service-key"),
    db: Optional[Session] = Depends(get_db),
) -> dict:
    esperada = settings.torre_service_key.get_secret_value().strip()
    if not (
        x_torre_service_key
        and len(esperada) >= SEGREDO_MINIMO
        and hmac.compare_digest(x_torre_service_key.encode("utf-8"), esperada.encode("utf-8"))
    ):
        raise HTTPException(401, "Nao autorizado.")
    try:
        dono = svc.validar(_banco(db), corpo.chave, _agora())
    except SQLAlchemyError as exc:
        logger.error("chave_pessoal validar falhou (%s)", type(exc).__name__)
        raise HTTPException(503, "Banco de dados indisponivel.") from None
    if dono is None:
        raise HTTPException(401, "Chave invalida.")
    logger.info("chave_pessoal uso via=mcp id=%s nome=%s dono=%s", dono.id, dono.nome, dono.dono_email)
    return {"nome": dono.nome, "dono_email": dono.dono_email, "expira_em": int(dono.expira_em.timestamp())}


@router.get("")
def listar_chaves(admin: str = Depends(exigir_admin), db: Optional[Session] = Depends(get_db)) -> dict:
    try:
        return {"chaves": svc.listar(_banco(db))}
    except SQLAlchemyError as exc:
        logger.error("chave_pessoal listar falhou (%s)", type(exc).__name__)
        raise HTTPException(503, "Banco de dados indisponivel.") from None


@router.post("", status_code=201)
def criar_chave(corpo: CriarRequest, admin: str = Depends(exigir_admin), db: Optional[Session] = Depends(get_db)) -> dict:
    dono = corpo.dono_email.strip().lower()
    if not email_permitido(dono, dominios_permitidos(settings.allowed_email_domains)):
        raise HTTPException(422, "E-mail do dono fora dos dominios da empresa.")
    try:
        chave, linha = svc.criar(
            _banco(db), nome=corpo.nome.strip(), dono_email=dono, criada_por=admin, dias=corpo.dias, agora=_agora()
        )
    except SQLAlchemyError as exc:
        logger.error("chave_pessoal criar falhou (%s)", type(exc).__name__)
        raise HTTPException(503, "Banco de dados indisponivel.") from None
    logger.info("chave_pessoal criada id=%s nome=%s dono=%s por=%s", linha["id"], linha["nome"], dono, admin)
    return {**linha, "chave": chave}


@router.post("/{chave_id}/revogar")
def revogar_chave(chave_id: int, admin: str = Depends(exigir_admin), db: Optional[Session] = Depends(get_db)) -> dict:
    try:
        ok = svc.revogar(_banco(db), chave_id, _agora())
    except SQLAlchemyError as exc:
        logger.error("chave_pessoal revogar falhou (%s)", type(exc).__name__)
        raise HTTPException(503, "Banco de dados indisponivel.") from None
    if not ok:
        raise HTTPException(404, "Chave nao encontrada ou ja revogada.")
    logger.info("chave_pessoal revogada id=%s por=%s", chave_id, admin)
    return {"id": chave_id, "revogada": True}
