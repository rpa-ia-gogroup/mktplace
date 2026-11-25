"""OAuth do Bling para contas novas (hoje: Denavita), sem mexer no token da Rituaria.

GET /api/v1/bling/oauth/link?conta=denavita   admin: link de autorizacao com `state` assinado
GET /api/v1/bling/oauth/callback?code&state   o Bling chama sem cookie (rota publica no gate);
                                              a protecao e' o `state` (HMAC com AUTH_SECRET, 15 min)

Nada de token na resposta nem no log: o callback so' diz "autorizada" ou um erro curto.
"""
from __future__ import annotations

import html
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.routers.chaves_pessoais import exigir_admin
from app.services import bling_token
from app.services.bling_token import BlingIndisponivel
from app.sessao import SEGREDO_MINIMO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/bling/oauth", tags=["bling-oauth"])

CAMINHO_CALLBACK = "/api/v1/bling/oauth/callback"


class _SemQueryNoCallback(logging.Filter):
    """O log de acesso do uvicorn grava a URL inteira: no callback, a query (code e state) sai."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and args[2].startswith(CAMINHO_CALLBACK):
            record.args = (*args[:2], CAMINHO_CALLBACK, *args[3:])
        return True


logging.getLogger("uvicorn.access").addFilter(_SemQueryNoCallback())

AUTORIZAR_URL = "https://www.bling.com.br/Api/v3/oauth/authorize"
NOMES = {"denavita": "Denavita"}


def _agora() -> datetime:
    return datetime.now(timezone.utc)


def _segredo() -> str:
    s = settings.auth_secret.get_secret_value().strip()
    return s if len(s) >= SEGREDO_MINIMO else ""


def _pagina(titulo: str, texto: str, status: int) -> HTMLResponse:
    corpo = (
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Torre de Controle</title></head>'
        f'<body style="font-family:sans-serif;max-width:32rem;margin:4rem auto"><h1>{html.escape(titulo)}</h1>'
        f"<p>{html.escape(texto)}</p></body></html>"
    )
    return HTMLResponse(corpo, status_code=status)


@router.get("/link")
def link(conta: str = Query(...), admin: str = Depends(exigir_admin)) -> dict:
    if conta not in bling_token.CONTAS_OAUTH:
        raise HTTPException(400, "Conta não autorizável por aqui.")
    client_id, _ = bling_token.credenciais(conta)
    segredo = _segredo()
    if not client_id or not segredo:
        raise HTTPException(503, "Bling da conta não configurado.")
    state = bling_token.assinar_state(conta, segredo, _agora())
    logger.info("bling oauth: link gerado conta=%s por=%s", conta, admin)
    return {"url": f"{AUTORIZAR_URL}?{urlencode({'response_type': 'code', 'client_id': client_id, 'state': state})}"}


@router.get("/callback", response_class=HTMLResponse)
def callback(
    code: Optional[str] = Query(None, max_length=512),
    state: Optional[str] = Query(None, max_length=1024),
    db: Optional[Session] = Depends(get_db),
) -> HTMLResponse:
    segredo = _segredo()
    conta = bling_token.ler_state(state or "", segredo, _agora()) if segredo else None
    if conta is None or not code:
        logger.warning("bling oauth: callback recusado (state invalido, expirado ou sem code)")
        return _pagina("Link inválido ou expirado", "Gere um novo link de autorização na Torre e tente de novo.", 400)
    if db is None:
        return _pagina("Banco indisponível", "Não deu para gravar a autorização agora. Tente de novo em instantes.", 503)
    try:
        linha = bling_token.trocar_code(code, conta)
        bling_token.ArmazemPg(db).gravar(conta, linha)
    except BlingIndisponivel:
        return _pagina("Não deu para autorizar", "O Bling não aceitou a autorização. Gere um novo link e tente de novo.", 502)
    except Exception as exc:  # noqa: BLE001 - texto da excecao (pode ter DSN) nunca sai
        logger.error("bling oauth: gravar token falhou conta=%s (%s)", conta, type(exc).__name__)
        return _pagina("Não deu para autorizar", "Falha ao gravar a autorização. Tente de novo em instantes.", 503)
    logger.info("bling oauth: conta %s autorizada", conta)
    nome = NOMES.get(conta, conta)
    return _pagina(f"{nome} autorizada", f"A Torre já pode ler os pedidos do Bling da {nome}. Pode fechar esta página.", 200)
