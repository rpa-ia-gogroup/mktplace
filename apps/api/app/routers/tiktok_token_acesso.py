"""TIKTOK-TOKEN-ACESSO — o access_token vivo do TikTok Shop para automacoes de outras pessoas.

GET /api/v1/tiktok/token/{marca}   Authorization: Bearer torre_pat_...

So' o access_token sai daqui (renovado pela Torre quando falta < 1 dia); o refresh_token nunca
sai, entao so' a Torre renova e nao ha' disputa de renovacao. Quem pode e quais marcas: Variable
de ambiente TIKTOK_TOKEN_ACESSO ("email:marca|marca;email2:*"). Vazia = ninguem (fail-closed).
A rota confere a chave sozinha (nao depende do modo do gate). Nada de token em log ou erro.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.rate_limit import JanelaDeslizante
from app.services import chaves_pessoais, tiktok_token
from app.sessao import dominios_permitidos, email_permitido

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/tiktok/token", tags=["tiktok"])

#: 30 pedidos por minuto por chave: a automacao pega o token antes de usar, nao em laco.
_limite = JanelaDeslizante(30, 60.0)


def acessos(config: str) -> dict[str, set[str]]:
    """'a@x.com:kokeshi|lescent;b@y.com:*' -> {'a@x.com': {'kokeshi','lescent'}, 'b@y.com': {'*'}}."""
    saida: dict[str, set[str]] = {}
    for parte in (config or "").split(";"):
        email, sep, marcas = parte.strip().partition(":")
        if sep and email.strip():
            saida[email.strip().lower()] = {m.strip().lower() for m in marcas.split("|") if m.strip()}
    return saida


def liberado(email: str, marca: str, config: str) -> bool:
    marcas = acessos(config).get(email.lower(), set())
    return "*" in marcas or marca in marcas


def _chave(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip()


@router.get("/{marca}")
def token_da_marca(
    marca: str,
    response: Response,
    authorization: Optional[str] = Header(None),
    db: Optional[Session] = Depends(get_db),
) -> dict:
    marca = marca.strip().lower()
    chave = _chave(authorization)
    if not chave or db is None:
        raise HTTPException(401, "Chave pessoal obrigatória.")
    if not _limite.verificar(chave[-12:]).permitido:
        raise HTTPException(429, "Muitos pedidos: pegue o token uma vez e use até perto de vencer.")
    agora = datetime.now(timezone.utc)
    try:
        dono = chaves_pessoais.validar(db, chave, agora)
    except SQLAlchemyError:
        raise HTTPException(503, "Banco de dados indisponível.") from None
    if dono is None or not email_permitido(dono.dono_email, dominios_permitidos(settings.allowed_email_domains)):
        raise HTTPException(401, "Chave inválida.")
    if not liberado(dono.dono_email, marca, settings.tiktok_token_acesso):
        logger.warning("tiktok_token recusado dono=%s marca=%s motivo=sem_permissao", dono.dono_email, marca)
        raise HTTPException(403, "Sem acesso ao token desta marca.")
    armazem = tiktok_token.ArmazemPg(db)
    try:
        token = tiktok_token.obter_access_token(armazem, marca)
        linha = armazem.ler(marca) or {}
    except tiktok_token.TikTokIndisponivel as exc:
        raise HTTPException(503, exc.args[0]) from None
    except SQLAlchemyError:
        raise HTTPException(503, "Banco de dados indisponível.") from None
    expira = linha.get("access_expires_at")
    logger.info("tiktok_token entregue dono=%s chave=%s marca=%s", dono.dono_email, dono.id, marca)
    response.headers["Cache-Control"] = "no-store"
    return {"marca": marca, "access_token": token,
            "expira_em": expira.isoformat() if hasattr(expira, "isoformat") else expira}
