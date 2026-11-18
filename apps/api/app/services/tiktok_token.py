"""Token OAuth do app da Torre no TikTok Shop, por marca (tabela `audit.tiktok_oauth_token`, migration 050).

- access_token vale ~7 dias; renovamos quando falta menos de `FOLGA` para vencer.
- A renovacao devolve um refresh_token novo: roda sob `SELECT ... FOR UPDATE` (e um lock no
  processo), entao duas renovacoes simultaneas nunca acontecem e quem espera ja' acha o token novo.
- Os tokens iniciais entram uma vez pela carga (`tools/tiktok_tokens_carregar.py`).
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

URL_REFRESH = "https://auth.tiktok-shops.com/api/v2/token/refresh"
FOLGA = timedelta(days=1)
_trava_local = threading.Lock()


class TikTokIndisponivel(Exception):
    """Motivo ja' sanitizado em `args[0]` (nunca token nem texto da fonte)."""


class Armazem(Protocol):
    def ler(self, conta: str) -> Optional[dict]: ...

    def trocar(self, conta: str, fn: Callable[[Optional[dict]], Optional[dict]]) -> Optional[dict]:
        """Sob lock da linha: `fn(linha)` devolve a linha nova (gravada) ou a mesma."""


_COLS = "access_token, access_expires_at, refresh_token, refresh_expires_at, open_id, seller_name"


class ArmazemPg:
    """Implementacao em Postgres (SQLAlchemy Session)."""

    def __init__(self, db):
        self.db = db

    def ler(self, conta: str) -> Optional[dict]:
        from sqlalchemy import text

        r = self.db.execute(text(f"SELECT {_COLS} FROM audit.tiktok_oauth_token WHERE conta = :c"), {"c": conta}).mappings().first()
        self.db.rollback()  # fim da leitura: nao deixa transacao aberta
        return dict(r) if r else None

    def trocar(self, conta: str, fn: Callable[[Optional[dict]], Optional[dict]]) -> Optional[dict]:
        from sqlalchemy import text

        try:
            r = self.db.execute(
                text(f"SELECT {_COLS} FROM audit.tiktok_oauth_token WHERE conta = :c FOR UPDATE"), {"c": conta}
            ).mappings().first()
            antes = dict(r) if r else None
            novo = fn(antes)
            if novo is not None and novo is not antes:
                gravar(self.db, conta, novo)
            self.db.commit()
            return novo
        except Exception:
            self.db.rollback()
            raise


def gravar(db, conta: str, t: dict) -> None:
    """Upsert da linha da marca (usado na renovacao e na carga inicial). Nao faz commit."""
    from sqlalchemy import text

    db.execute(
        text(
            f"INSERT INTO audit.tiktok_oauth_token (conta, {_COLS}, updated_at) "
            "VALUES (:conta, :access_token, :access_expires_at, :refresh_token, :refresh_expires_at, :open_id, :seller_name, now()) "
            "ON CONFLICT (conta) DO UPDATE SET access_token = EXCLUDED.access_token, "
            "access_expires_at = EXCLUDED.access_expires_at, refresh_token = EXCLUDED.refresh_token, "
            "refresh_expires_at = EXCLUDED.refresh_expires_at, "
            "open_id = COALESCE(EXCLUDED.open_id, audit.tiktok_oauth_token.open_id), "
            "seller_name = COALESCE(EXCLUDED.seller_name, audit.tiktok_oauth_token.seller_name), updated_at = now()"
        ),
        {"conta": conta, **{k: t.get(k) for k in ("access_token", "access_expires_at", "refresh_token",
                                                  "refresh_expires_at", "open_id", "seller_name")}},
    )


def _ts(v) -> Optional[datetime]:
    """Instante unix (s) do TikTok -> datetime UTC."""
    try:
        return datetime.fromtimestamp(int(v), tz=timezone.utc) if v else None
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def de_resposta(data: dict) -> dict:
    """`data` da resposta do TikTok (token/get ou token/refresh) -> linha da tabela."""
    return {
        "access_token": data["access_token"],
        "access_expires_at": _ts(data.get("access_token_expire_in")),
        "refresh_token": data["refresh_token"],
        "refresh_expires_at": _ts(data.get("refresh_token_expire_in")),
        "open_id": data.get("open_id"),
        "seller_name": data.get("seller_name"),
    }


def _valido(estado: Optional[dict], agora: datetime) -> bool:
    return bool(estado and estado.get("access_token") and estado.get("access_expires_at")
                and estado["access_expires_at"] - FOLGA > agora)


def _renovar_no_tiktok(refresh: str, get: Callable[..., httpx.Response]) -> dict:
    try:
        r = get(URL_REFRESH, params={
            "app_key": settings.tiktok_app_key,
            "app_secret": settings.tiktok_app_secret.get_secret_value(),
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }, timeout=20.0)
        r.raise_for_status()
        j = r.json()
        if j.get("code") != 0 or not (j.get("data") or {}).get("access_token"):
            raise ValueError(f"tiktok code {j.get('code')}")
        return de_resposta(j["data"])
    except Exception as exc:  # noqa: BLE001 — texto da fonte e token nunca saem
        logger.warning("renovacao do token do tiktok falhou: %s", type(exc).__name__)
        raise TikTokIndisponivel("Não foi possível renovar o acesso ao TikTok Shop.") from exc


def obter_access_token(
    armazem: Armazem,
    conta: str,
    get: Callable[..., httpx.Response] = httpx.get,
    agora: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> str:
    """Access token vivo da marca; renova (e grava) quando falta menos de 1 dia para vencer."""
    if not settings.tiktok_app_key or not settings.tiktok_app_secret.get_secret_value():
        raise TikTokIndisponivel("TikTok Shop não configurado.")
    vivo = armazem.ler(conta)
    if _valido(vivo, agora()):
        return vivo["access_token"]

    def renova(linha: Optional[dict]) -> Optional[dict]:
        if linha is None:
            raise TikTokIndisponivel("Loja do TikTok Shop ainda não autorizada.")
        if _valido(linha, agora()):  # outro worker ja' renovou enquanto esperavamos o lock
            return linha
        return _renovar_no_tiktok(linha["refresh_token"], get)

    with _trava_local:
        novo = armazem.trocar(conta, renova)
    return novo["access_token"]
