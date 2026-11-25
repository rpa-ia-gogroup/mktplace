"""TIKTOK-TOKEN-ACESSO — o access_token vivo do TikTok Shop para automacoes de outras pessoas.

GET  /api/v1/tiktok/token/{marca}           Authorization: Bearer torre_pat_...
POST /api/v1/tiktok/token/{marca}/assinar   a chamada assinada pela Torre (o app_secret nunca sai)

So' o access_token sai daqui (renovado pela Torre quando falta < 1 dia); o refresh_token nunca
sai, entao so' a Torre renova e nao ha' disputa de renovacao. Quem pode e quais marcas: Variable
de ambiente TIKTOK_TOKEN_ACESSO ("email:marca|marca;email2:*"; "*:*" = qualquer chave valida).
Vazia = ninguem (fail-closed).
A rota confere a chave sozinha (nao depende do modo do gate). Nada de token em log ou erro.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.rate_limit import JanelaDeslizante
from app.services import chaves_pessoais, tiktok_client, tiktok_token
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
    """'*' no lugar do e-mail = qualquer dono de chave pessoal valida (dominio da empresa)."""
    regras = acessos(config)
    marcas = regras.get(email.lower(), set()) | regras.get("*", set())
    return "*" in marcas or marca in marcas


def _chave(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip()


def _token_liberado(marca: str, authorization: Optional[str], db: Optional[Session]) -> tuple:
    """Confere chave, limite e permissao; devolve (token vivo, linha do token, dono)."""
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
    return token, linha, dono


def _expira(linha: dict):
    e = linha.get("access_expires_at")
    return e.isoformat() if hasattr(e, "isoformat") else e


@router.get("/{marca}")
def token_da_marca(
    marca: str,
    response: Response,
    authorization: Optional[str] = Header(None),
    db: Optional[Session] = Depends(get_db),
) -> dict:
    marca = marca.strip().lower()
    token, linha, dono = _token_liberado(marca, authorization, db)
    logger.info("tiktok_token entregue dono=%s chave=%s marca=%s", dono.dono_email, dono.id, marca)
    response.headers["Cache-Control"] = "no-store"
    return {"marca": marca, "access_token": token, "expira_em": _expira(linha)}


class PedidoAssinatura(BaseModel):
    """A chamada que a automacao quer fazer no TikTok Shop (sem app_key/timestamp/sign)."""
    metodo: str = Field(default="GET", pattern="^(GET|POST|PUT|DELETE)$")
    path: str = Field(min_length=2, max_length=200, pattern=r"^/[A-Za-z0-9_/\-]+$")
    params: dict[str, Any] = Field(default_factory=dict)
    corpo: Optional[dict[str, Any]] = None


@router.post("/{marca}/assinar")
def assinar_chamada(
    marca: str,
    pedido: PedidoAssinatura,
    response: Response,
    authorization: Optional[str] = Header(None),
    db: Optional[Session] = Depends(get_db),
) -> dict:
    """Devolve a chamada pronta para o TikTok, assinada pela Torre: o app_secret nunca sai daqui.

    A automacao manda EXATAMENTE `corpo_texto` como body (a assinatura cobre esse texto).
    """
    from app.services.cx_tiktok_service import _cliente_da_marca

    marca = marca.strip().lower()
    token, linha, dono = _token_liberado(marca, authorization, db)
    try:
        cli = _cliente_da_marca(marca, token, tiktok_client.Cliente)
    except Exception:  # noqa: BLE001 -- motivo fixo, nada da fonte
        raise HTTPException(503, "TikTok indisponível para achar a loja da marca.") from None
    params = {k: str(v) for k, v in pedido.params.items() if k not in ("app_key", "timestamp", "sign", "access_token")}
    params.update({"app_key": settings.tiktok_app_key, "timestamp": str(int(time.time()))})
    if cli.cipher:
        params.setdefault("shop_cipher", cli.cipher)
    corpo_texto = json.dumps(pedido.corpo, separators=(",", ":"), ensure_ascii=False) if pedido.corpo is not None else ""
    params["sign"] = tiktok_client.assinar(pedido.path, params, corpo_texto, settings.tiktok_app_secret.get_secret_value())
    logger.info("tiktok_assinatura dono=%s chave=%s marca=%s %s %s", dono.dono_email, dono.id, marca, pedido.metodo, pedido.path)
    response.headers["Cache-Control"] = "no-store"
    return {"marca": marca, "metodo": pedido.metodo, "url": tiktok_client.BASE + pedido.path, "params": params,
            "headers": {"x-tts-access-token": token, "content-type": "application/json"},
            "corpo_texto": corpo_texto, "valido_por_s": 300, "token_expira_em": _expira(linha)}
