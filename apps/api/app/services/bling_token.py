"""Token OAuth2 do Bling v3 por conta (Rituaria e Denavita), com refresh_token ROTATIVO.

Cada troca devolve um refresh_token novo e invalida o anterior, entao:
 - o token vivo fica na tabela `audit.bling_oauth_token` (migration 042);
 - a troca roda sob `SELECT ... FOR UPDATE` (e um lock no processo): duas trocas
   simultaneas nunca acontecem, e o worker que espera ja' acha o token novo;
 - `BLING_REFRESH_TOKEN_INICIAL` so' semeia a tabela vazia, e so' da conta da Rituaria;
 - cada conta usa o client_id/secret do app dela (`credenciais`); a Denavita nasce pelo
   OAuth (`trocar_code`), com `state` assinado (`assinar_state` / `ler_state`).
Nada aqui loga, imprime ou devolve token em mensagem de erro.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Protocol

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

CONTA_PADRAO = "rituaria"
CONTA_DENAVITA = "denavita"
#: Contas que podem ser autorizadas pelo callback OAuth (a da Rituaria nunca: o token dela nao se mexe por la').
CONTAS_OAUTH = (CONTA_DENAVITA,)
STATE_VALIDADE_S = 15 * 60
FOLGA = timedelta(seconds=60)
_trava_local = threading.Lock()


class BlingIndisponivel(Exception):
    """Motivo ja' sanitizado em `args[0]` (nunca token nem texto da fonte)."""


def credenciais(conta: str) -> tuple[str, str]:
    """client_id/secret do app Bling da conta: Denavita tem app proprio; o resto usa o da Rituaria."""
    if conta == CONTA_DENAVITA:
        return settings.bling_denavita_client_id, settings.bling_denavita_client_secret.get_secret_value()
    return settings.bling_client_id, settings.bling_client_secret.get_secret_value()


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

    def gravar(self, conta: str, linha: dict) -> None:
        """Grava (ou substitui) o token da conta: usado so' pelo callback OAuth."""
        from sqlalchemy import text

        try:
            self.db.execute(
                text(
                    "INSERT INTO audit.bling_oauth_token (conta, refresh_token, access_token, access_expires_at) "
                    "VALUES (:c, :r, :a, :e) ON CONFLICT (conta) DO UPDATE SET refresh_token = excluded.refresh_token, "
                    "access_token = excluded.access_token, access_expires_at = excluded.access_expires_at, updated_at = now()"
                ),
                {"c": conta, "r": linha["refresh_token"], "a": linha["access_token"], "e": linha["access_expires_at"]},
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

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


def _trocar_no_bling(
    refresh: str, post: Callable[..., httpx.Response], agora: datetime, conta: str = CONTA_PADRAO, dados: Optional[dict] = None
) -> dict:
    try:
        r = post(
            settings.bling_token_url,
            auth=credenciais(conta),
            data=dados or {"grant_type": "refresh_token", "refresh_token": refresh},
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
    if not all(credenciais(conta)):
        raise BlingIndisponivel("Bling não configurado.")
    vivo = armazem.ler(conta)
    if _valido(vivo, agora()):
        return vivo["access_token"]
    # A semente e' da conta da Rituaria: nunca semeia outra conta com o refresh_token dela.
    semente = settings.bling_refresh_token_inicial.get_secret_value() if conta == CONTA_PADRAO else ""

    def renova(linha: Optional[dict]) -> dict:
        if _valido(linha, agora()):  # outro worker ja' renovou enquanto esperavamos o lock
            return linha
        refresh = (linha or {}).get("refresh_token") or semente
        if not refresh:
            raise BlingIndisponivel("Bling aguardando autorização.")
        return _trocar_no_bling(refresh, post, agora(), conta)

    with _trava_local:
        return armazem.trocar(conta, semente, renova)["access_token"]


def invalidar(armazem: Armazem, conta: str = CONTA_PADRAO) -> None:
    """Depois de um 401: a proxima chamada troca o token (mantem o refresh_token vivo)."""
    if armazem.ler(conta):
        armazem.trocar(conta, "", lambda l: {**l, "access_token": None, "access_expires_at": None})


# ---------------------------------------------------------------------------
# OAuth (authorization_code) para contas novas: link com state assinado -> callback troca o code.

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _assinatura(corpo: str, segredo: str) -> str:
    return _b64(hmac.new(segredo.encode(), corpo.encode(), hashlib.sha256).digest())


def assinar_state(conta: str, segredo: str, agora: datetime) -> str:
    """`<json base64url>.<HMAC-SHA256>` com a conta e a expiracao (15 min)."""
    corpo = _b64(json.dumps({"conta": conta, "exp": int(agora.timestamp()) + STATE_VALIDADE_S}).encode())
    return f"{corpo}.{_assinatura(corpo, segredo)}"


def ler_state(state: str, segredo: str, agora: datetime) -> Optional[str]:
    """Conta do state, ou None (assinatura errada, expirado, malformado ou conta nao autorizavel)."""
    try:
        corpo, assinatura = state.split(".", 1)
        if not hmac.compare_digest(assinatura, _assinatura(corpo, segredo)):
            return None
        d = json.loads(base64.urlsafe_b64decode(corpo + "=" * (-len(corpo) % 4)))
        if int(d["exp"]) < agora.timestamp():
            return None
        return d["conta"] if d.get("conta") in CONTAS_OAUTH else None
    except Exception:  # noqa: BLE001 - state de fora: qualquer defeito = invalido
        return None


def trocar_code(
    code: str,
    conta: str,
    post: Callable[..., httpx.Response] = httpx.post,
    agora: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> dict:
    """Troca o `code` do callback por token (Basic com o app da conta). Erro sanitizado, sem token."""
    if not all(credenciais(conta)):
        raise BlingIndisponivel("Bling não configurado.")
    return _trocar_no_bling("", post, agora(), conta, {"grant_type": "authorization_code", "code": code})
