"""Marcas menores (Denavita, Yenzah, Aua, By Samia) pela API do Avoe.

A fonte NAO e' o Data Mart. O Avoe so' tem ate' ontem (D-1). Sem chave ou com
erro da fonte: `disponivel=False` com motivo curto (o texto da fonte e a chave
nunca saem). Ausencia nunca vira 0: marca sem linha tem `total=None` e dia sem
linha nao entra na serie.
"""
from __future__ import annotations

import logging
import time
import unicodedata
from datetime import date, timedelta
from typing import Callable, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

CACHE_TTL_S = 3600.0
TIMEOUT_S = 30.0
MARCAS = {"denavita": ("denavita", "Denavita"), "yenzah": ("yenzah", "Yenzah"), "aua": ("aua", "Auá"), "bysamia": ("by-samia", "By Samia")}
ORDEM_PLATAFORMAS = ["MELI", "SHOPEE", "TIKTOK", "AMAZON", "KWAI", "SHEIN"]

_cache: dict[tuple[date, date], tuple[float, list[dict]]] = {}


class AvoeIndisponivel(Exception):
    """Motivo ja' sanitizado em `args[0]`."""


def limpar_cache() -> None:
    _cache.clear()


def _chave_marca(nome: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return "".join(sem_acento.split()).casefold()


def consultar_avoe(inicio: date, fim: date) -> list[dict]:
    """Linhas {data, marca, plataforma, faturamento} do periodo, todas as marcas."""
    chave = settings.avoe_api_key.get_secret_value()
    if not chave:
        raise AvoeIndisponivel("Fonte do Avoe não configurada.")
    body = {"tool": "consultar_faturamento", "args": {"data_inicio": inicio.isoformat(), "data_fim": fim.isoformat()}}
    try:
        with httpx.Client(timeout=TIMEOUT_S) as c:
            r = c.post(settings.avoe_api_url, headers={"x-api-key": chave}, json=body)
        r.raise_for_status()
        linhas = r.json()["result"]["linhas"]
        if not isinstance(linhas, list):
            raise ValueError("linhas")
    except Exception as exc:  # noqa: BLE001 — texto da fonte e chave nunca saem
        logger.warning("avoe indisponivel: %s", type(exc).__name__)
        raise AvoeIndisponivel("Fonte do Avoe indisponível agora.") from exc
    return linhas


def _linhas_com_cache(
    inicio: date, fim: date, fonte: Callable[[date, date], list[dict]], agora: Callable[[], float]
) -> list[dict]:
    hit = _cache.get((inicio, fim))
    if hit and agora() - hit[0] < CACHE_TTL_S:
        return hit[1]
    linhas = fonte(inicio, fim)
    _cache[(inicio, fim)] = (agora(), linhas)
    return linhas


def get_marcas_menores(
    date_from: date,
    date_to: date,
    hoje: date,
    fonte: Optional[Callable[[date, date], list[dict]]] = None,
    agora: Callable[[], float] = time.monotonic,
) -> dict:
    fonte = fonte or consultar_avoe  # resolvido na chamada (testes trocam o modulo)
    dado_ate = hoje - timedelta(days=1)
    fim = min(date_to, dado_ate)
    inicio = min(date_from, fim)
    ajustado = date_to > dado_ate
    try:
        linhas = _linhas_com_cache(inicio, fim, fonte, agora)
    except AvoeIndisponivel as exc:
        return {"disponivel": False, "motivo": str(exc), "marcas": []}

    acum: dict[str, dict] = {id_: {"plat": {}, "dias": {}} for id_, _ in MARCAS.values()}
    for l in linhas:
        m = MARCAS.get(_chave_marca(str(l.get("marca", ""))))
        try:
            dia, valor = date.fromisoformat(str(l["data"])[:10]), float(l["faturamento"])
        except (KeyError, TypeError, ValueError):
            continue  # linha sem data ou sem valor = sem dado
        if not m or not (inicio <= dia <= fim):
            continue
        plat = str(l.get("plataforma", "")).upper() or "OUTRA"
        a = acum[m[0]]
        a["plat"][plat] = a["plat"].get(plat, 0.0) + valor
        d = a["dias"].setdefault(dia, {})
        d[plat] = d.get(plat, 0.0) + valor

    def ordem(p: str) -> tuple[int, str]:
        return (ORDEM_PLATAFORMAS.index(p) if p in ORDEM_PLATAFORMAS else len(ORDEM_PLATAFORMAS), p)

    marcas = []
    for id_, label in MARCAS.values():
        a = acum[id_]
        marcas.append({
            "id": id_,
            "label": label,
            "total": sum(a["plat"].values()) if a["plat"] else None,
            "por_plataforma": [{"plataforma": p, "faturamento": a["plat"][p]} for p in sorted(a["plat"], key=ordem)],
            "serie": [
                {"data": dia, "faturamento": sum(v.values()), "por_plataforma": v}
                for dia, v in sorted(a["dias"].items())
            ],
        })
    return {
        "disponivel": True,
        "periodo": {"inicio": inicio, "fim": fim},
        "dado_ate": dado_ate,
        "ajustado": ajustado,
        "marcas": marcas,
    }
