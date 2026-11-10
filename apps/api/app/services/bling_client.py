"""Cliente HTTP do Bling v3: Bearer, ~3 req/s e retry no 429. Nunca loga o token."""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Optional

import httpx

from app.config import settings
from app.services.bling_token import BlingIndisponivel

logger = logging.getLogger(__name__)

INTERVALO_S = 0.34  # ~3 req/s
TENTATIVAS = 4
_trava = threading.Lock()
_ultimo = [0.0]


class BlingCliente:
    def __init__(
        self,
        token: Callable[[], str],
        invalidar: Callable[[], None] = lambda: None,
        get: Callable[..., httpx.Response] = httpx.get,
        dormir: Callable[[float], None] = time.sleep,
        relogio: Callable[[], float] = time.monotonic,
    ):
        self._token, self._invalidar, self._get, self._dormir, self._relogio = token, invalidar, get, dormir, relogio

    def _esperar_vez(self) -> None:
        with _trava:
            falta = _ultimo[0] + INTERVALO_S - self._relogio()
            if falta > 0:
                self._dormir(falta)
            _ultimo[0] = self._relogio()

    def get(self, caminho: str, params: Optional[dict] = None) -> dict:
        renovou = False
        for tentativa in range(TENTATIVAS):
            self._esperar_vez()
            try:
                r = self._get(
                    f"{settings.bling_api_url}{caminho}",
                    params=params,
                    headers={"Authorization": f"Bearer {self._token()}", "Accept": "application/json"},
                    timeout=30.0,
                )
            except BlingIndisponivel:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("bling get falhou: %s", type(exc).__name__)
                raise BlingIndisponivel("Bling indisponível agora.") from exc
            if r.status_code == 429:
                espera = float(r.headers.get("Retry-After", 0) or 0) or 1.0 * (2**tentativa)
                self._dormir(min(espera, 10.0))
                continue
            if r.status_code == 401 and not renovou:
                renovou = True
                self._invalidar()
                continue
            if r.status_code >= 400:
                logger.warning("bling respondeu %s", r.status_code)
                raise BlingIndisponivel("Bling indisponível agora.")
            try:
                return r.json()
            except Exception as exc:  # noqa: BLE001
                raise BlingIndisponivel("Bling indisponível agora.") from exc
        raise BlingIndisponivel("Bling limitou as consultas; tente de novo em instantes.")


def cliente_com_sessao(db) -> BlingCliente:
    """Cliente do Bling com o token da conta (tabela do banco), lido UMA vez por uso: nao uma por chamada."""
    from app.services import bling_token

    armazem = bling_token.ArmazemPg(db)
    atual: list[Optional[str]] = [None]

    def token() -> str:
        if atual[0] is None:
            atual[0] = bling_token.obter_access_token(armazem)
        return atual[0]

    def invalidar() -> None:
        atual[0] = None
        bling_token.invalidar(armazem)

    return BlingCliente(token=token, invalidar=invalidar)
