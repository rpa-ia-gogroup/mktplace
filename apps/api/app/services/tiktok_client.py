"""Cliente minimo da Open API do TikTok Shop (versao 202309) para o app da Torre.

Assinatura (doc oficial): HMAC-SHA256(secret, secret + path + params ordenados (chave+valor, sem
`sign` e `access_token`) + corpo JSON + secret), em hex. O token vai no header `x-tts-access-token`.
O token de cada marca vem de `tiktok_token.obter_access_token` (renova sozinho).
Nada aqui loga token nem devolve texto cru da fonte em erro.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from typing import Any, Callable, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BASE = "https://open-api.tiktokglobalshop.com"


class TikTokErro(Exception):
    """Motivo sanitizado em `args[0]`; `codigo` = code do TikTok (ex.: 105005 = sem permissao)."""

    def __init__(self, motivo: str, codigo: Optional[int] = None):
        super().__init__(motivo)
        self.codigo = codigo


def assinar(path: str, params: dict[str, Any], corpo: str, secret: str) -> str:
    base = path + "".join(f"{k}{params[k]}" for k in sorted(params) if k not in ("sign", "access_token"))
    msg = f"{secret}{base}{corpo}{secret}"
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()


class Cliente:
    def __init__(self, access_token: str, shop_cipher: Optional[str] = None,
                 http: Callable[..., httpx.Response] = httpx.request, agora: Callable[[], float] = time.time):
        self.token, self.cipher, self.http, self.agora = access_token, shop_cipher, http, agora

    def chamar(self, metodo: str, path: str, params: Optional[dict] = None, corpo: Optional[dict] = None) -> dict:
        p = {"app_key": settings.tiktok_app_key, "timestamp": str(int(self.agora())), **(params or {})}
        if self.cipher:
            p["shop_cipher"] = self.cipher
        texto = json.dumps(corpo, separators=(",", ":")) if corpo is not None else ""
        p["sign"] = assinar(path, p, texto, settings.tiktok_app_secret.get_secret_value())
        try:
            r = self.http(metodo, BASE + path, params=p, content=texto or None, timeout=30.0,
                          headers={"x-tts-access-token": self.token, "content-type": "application/json"})
            j = r.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("tiktok %s falhou: %s", path, type(exc).__name__)
            raise TikTokErro("TikTok Shop indisponível agora.") from exc
        if j.get("code") != 0:
            logger.warning("tiktok %s code=%s", path, j.get("code"))
            raise TikTokErro("O TikTok Shop recusou a consulta.", j.get("code"))
        return j.get("data") or {}

    def lojas(self) -> list[dict]:
        """Lojas autorizadas para o token (traz o `cipher` exigido nas demais rotas)."""
        return self.chamar("GET", "/authorization/202309/shops").get("shops") or []

    def paginar(self, path: str, corpo: dict, chave: str, page_size: int = 50, max_paginas: int = 40) -> tuple[list[dict], bool]:
        """POST paginado por `page_token`. Devolve (itens, truncado)."""
        itens: list[dict] = []
        token = None
        for _ in range(max_paginas):
            q = {"page_size": str(page_size), **({"page_token": token} if token else {})}
            d = self.chamar("POST", path, q, corpo)
            itens += d.get(chave) or []
            token = d.get("next_page_token")
            if not token:
                return itens, False
        return itens, True
