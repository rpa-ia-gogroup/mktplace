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
#: So' estes tres canais (pedido do usuario); qualquer outra plataforma do Avoe fica fora.
ORDEM_PLATAFORMAS = ["MELI", "SHOPEE", "TIKTOK"]

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
        plat = str(l.get("plataforma", "")).upper()
        if plat not in ORDEM_PLATAFORMAS:
            continue
        a = acum[m[0]]
        a["plat"][plat] = a["plat"].get(plat, 0.0) + valor
        d = a["dias"].setdefault(dia, {})
        d[plat] = d.get(plat, 0.0) + valor

    def ordem(p: str) -> int:
        return ORDEM_PLATAFORMAS.index(p)

    # Periodo anterior (mesma duracao, colado no inicio). Falhou ou sem linha: sem base, nunca 0.
    dias = (fim - inicio).days + 1
    ant_fim = inicio - timedelta(days=1)
    ant_ini = ant_fim - timedelta(days=dias - 1)
    try:
        linhas_ant = _linhas_com_cache(ant_ini, ant_fim, fonte, agora)
    except AvoeIndisponivel:
        linhas_ant = []
    ant: dict[str, float] = {}
    for l in linhas_ant:
        m = MARCAS.get(_chave_marca(str(l.get("marca", ""))))
        try:
            dia, valor = date.fromisoformat(str(l["data"])[:10]), float(l["faturamento"])
        except (KeyError, TypeError, ValueError):
            continue
        if m and ant_ini <= dia <= ant_fim and str(l.get("plataforma", "")).upper() in ORDEM_PLATAFORMAS:
            ant[m[0]] = ant.get(m[0], 0.0) + valor

    marcas = []
    for id_, label in MARCAS.values():
        a = acum[id_]
        marcas.append({
            "id": id_,
            "label": label,
            "total": sum(a["plat"].values()) if a["plat"] else None,
            "total_anterior": ant.get(id_),
            "por_plataforma": [{"plataforma": p, "faturamento": a["plat"][p]} for p in sorted(a["plat"], key=ordem)],
            "serie": [
                {"data": dia, "faturamento": sum(v.values()), "por_plataforma": v}
                for dia, v in sorted(a["dias"].items())
            ],
        })
    por_plat: dict[str, float] = {}
    for a in acum.values():
        for p, v in a["plat"].items():
            por_plat[p] = por_plat.get(p, 0.0) + v
    consolidado = {
        "total": sum(por_plat.values()) if por_plat else None,
        "total_anterior": sum(ant.values()) if ant else None,
        "por_plataforma": [{"plataforma": p, "faturamento": por_plat[p]} for p in sorted(por_plat, key=ordem)],
    }
    return {
        "disponivel": True,
        "consolidado": consolidado,
        "periodo": {"inicio": inicio, "fim": fim},
        "dado_ate": dado_ate,
        "ajustado": ajustado,
        "marcas": marcas,
    }


# ---------------------------------------------------------------------------
# Produtos: so' Denavita no TikTok tem item (Data Mart). O Avoe nao tem produto nem quantidade.

SQL_PRODUTOS = """
    SELECT product_id AS sku, MAX(product_name) AS produto, SUM(items_sold) AS quantidade, SUM(gmv) AS receita
      FROM gold.fct_tiktok_product_daily
     WHERE brand = 'denavita' AND date BETWEEN :de AND :ate
     GROUP BY product_id
     ORDER BY SUM(gmv) DESC NULLS LAST
     LIMIT 30"""


def get_produtos_denavita_tiktok(consultar, inicio: date, fim: date) -> dict:
    """Produto, quantidade e receita da Denavita no TikTok. Falha da base: indisponivel.
    Quantidade ausente fica `None`; nunca se deriva de receita."""
    try:
        linhas = consultar(SQL_PRODUTOS, {"de": inicio, "ate": fim})
    except Exception:  # noqa: BLE001 — texto do banco nunca sai
        logger.exception("marcas-menores/produtos falhou")
        return {"disponivel": False, "motivo": "Base de produtos indisponível agora.", "produtos": []}
    num = lambda v: None if v is None else float(v)  # noqa: E731
    return {
        "disponivel": True,
        "periodo": {"inicio": inicio, "fim": fim},
        "produtos": [
            {"sku": str(l["sku"]), "produto": l.get("produto") or str(l["sku"]), "quantidade": num(l.get("quantidade")), "receita": num(l.get("receita"))}
            for l in linhas
        ],
    }
