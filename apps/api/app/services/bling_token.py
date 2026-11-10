"""Token OAuth2 do Bling v3 (conta da Rituaria), com refresh_token ROTATIVO.

Cada troca devolve um refresh_token novo e invalida o anterior, entao:
 - o token vivo fica na tabela `audit.bling_oauth_token` (migration 042);
 - a troca roda sob `SELECT ... FOR UPDATE` (e um lock no processo): duas trocas
   simultaneas nunca acontecem, e o worker que espera ja' acha o token novo;
 - `BLING_REFRESH_TOKEN_INICIAL` so' semeia a tabela vazia.
Nada aqui loga, imprime ou devolve token em mensagem de erro.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Protocol

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

CONTA_PADRAO = "rituaria"
FOLGA = timedelta(seconds=60)
_trava_local = threading.Lock()


class BlingIndisponivel(Exception):
    """Motivo ja' sanitizado em `args[0]` (nunca token nem texto da fonte)."""


class Armazem(Protocol):
    def ler(self, conta: str) -> Optional[dict]: ...

    def trocar(self, conta: str, semente: str, fn: Callable[[Optional[dict]], dict]) -> dict:
        """Sob lock da linha (criada com `semente` se faltar): `fn(linha)` devolve a linha nova, que e' gravada."""


class ArmazemPg:
    """Implementacao em Postgres (SQLAlchemy Session)."""

    def __init__(self, db):
        self.db = db

    def ler(self, conta: str) -> Optional[dict]:
        from sqlalchemy import text

        r = self.db.execute(
            text("SELECT refresh_token, access_token, access_expires_at FROM audit.bling_oauth_token WHERE conta = :c"),
            {"c": conta},
        ).mappings().first()
        self.db.rollback()  # fim da leitura: nao deixa transacao aberta
        return dict(r) if r else None

    def trocar(self, conta: str, semente: str, fn: Callable[[Optional[dict]], dict]) -> dict:
        from sqlalchemy import text

        try:
            if semente:
                self.db.execute(
                    text("INSERT INTO audit.bling_oauth_token (conta, refresh_token) VALUES (:c, :s) ON CONFLICT (conta) DO NOTHING"),
                    {"c": conta, "s": semente},
                )
            r = self.db.execute(
                text("SELECT refresh_token, access_token, access_expires_at FROM audit.bling_oauth_token WHERE conta = :c FOR UPDATE"),
                {"c": conta},
            ).mappings().first()
            novo = fn(dict(r) if r else None)
            if r is not None:
                self.db.execute(
                    text(
                        "UPDATE audit.bling_oauth_token SET refresh_token = :r, access_token = :a, "
                        "access_expires_at = :e, updated_at = now() WHERE conta = :c"
                    ),
                    {"r": novo["refresh_token"], "a": novo["access_token"], "e": novo["access_expires_at"], "c": conta},
                )
            self.db.commit()
            return novo
        except Exception:
            self.db.rollback()
            raise


def _valido(estado: Optional[dict], agora: datetime) -> bool:
    return bool(
        estado and estado.get("access_token") and estado.get("access_expires_at") and estado["access_expires_at"] - FOLGA > agora
    )


def _trocar_no_bling(refresh: str, post: Callable[..., httpx.Response], agora: datetime) -> dict:
    try:
        r = post(
            settings.bling_token_url,
            auth=(settings.bling_client_id, settings.bling_client_secret.get_secret_value()),
            data={"grant_type": "refresh_token", "refresh_token": refresh},
            headers={"Accept": "1.0"},
            timeout=20.0,
        )
        r.raise_for_status()
        j = r.json()
        return {
            "refresh_token": j["refresh_token"],
            "access_token": j["access_token"],
            "access_expires_at": agora + timedelta(seconds=int(j.get("expires_in", 21600))),
        }
    except Exception as exc:  # noqa: BLE001 — texto da fonte e token nunca saem
        logger.warning("troca de token do bling falhou: %s", type(exc).__name__)
        raise BlingIndisponivel("Não foi possível renovar o acesso ao Bling.") from exc


def obter_access_token(
    armazem: Armazem,
    conta: str = CONTA_PADRAO,
    post: Callable[..., httpx.Response] = httpx.post,
    agora: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> str:
    if not settings.bling_client_id or not settings.bling_client_secret.get_secret_value():
        raise BlingIndisponivel("Bling não configurado.")
    vivo = armazem.ler(conta)
    if _valido(vivo, agora()):
        return vivo["access_token"]
    semente = settings.bling_refresh_token_inicial.get_secret_value()

    def renova(linha: Optional[dict]) -> dict:
        if _valido(linha, agora()):  # outro worker ja' renovou enquanto esperavamos o lock
            return linha
        refresh = (linha or {}).get("refresh_token") or semente
        if not refresh:
            raise BlingIndisponivel("Bling aguardando autorização.")
        return _trocar_no_bling(refresh, post, agora())

    with _trava_local:
        return armazem.trocar(conta, semente, renova)["access_token"]


def invalidar(armazem: Armazem, conta: str = CONTA_PADRAO) -> None:
    """Depois de um 401: a proxima chamada troca o token (mantem o refresh_token vivo)."""
    if armazem.ler(conta):
        armazem.trocar(conta, "", lambda l: {**l, "access_token": None, "access_expires_at": None})
