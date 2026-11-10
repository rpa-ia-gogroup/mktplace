"""Marcas menores (Yenzah, Aua, By Samia) pela API do Bling v3 (conta da Rituaria).

A marca sai do CANAL do pedido (`loja.id`). So' Shopee e TikTok; nenhuma das tres
tem ML. A Denavita esta' em outra conta Bling, ainda nao autorizada: aparece como
"aguardando autorizacao", nunca como 0. Ausencia nunca vira 0: marca sem pedido
tem `total=None` e dia sem pedido nao entra na serie.

Receita do pedido = campo `total` do Bling (produtos - descontos + frete).
Pedidos na situacao "Cancelado" ficam de fora. Quantidade e receita por produto
vem dos itens (valor x quantidade - desconto do item).
"""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Callable, Optional

from app.config import settings
from app.services.bling_client import BlingCliente
from app.services.bling_token import BlingIndisponivel

logger = logging.getLogger(__name__)

LISTA_TTL_S = 900.0  # lista de pedidos: 15 min
LIMITE = 100
MAX_PAGINAS = 50
#: Itens lidos por chamada de /produtos (~3 req/s): o resto fica para a proxima, o cache aquece.
DETALHES_POR_CHAMADA = 36
ORDEM_PLATAFORMAS = ["MELI", "SHOPEE", "TIKTOK"]

#: id da loja (canal) no Bling -> (marca, plataforma)
LOJAS: dict[int, tuple[str, str]] = {
    206340048: ("yenzah", "SHOPEE"),
    206282652: ("yenzah", "TIKTOK"),
    206338388: ("aua", "SHOPEE"),
    206293073: ("aua", "TIKTOK"),
    206339958: ("by-samia", "SHOPEE"),
    206285652: ("by-samia", "TIKTOK"),
}
#: Em ordem de exibicao; `None` = conta Bling ainda nao autorizada.
MARCAS: list[tuple[str, str, bool]] = [
    ("denavita", "Denavita", False),
    ("yenzah", "Yenzah", True),
    ("aua", "Auá", True),
    ("by-samia", "By Samia", True),
]
AGUARDANDO = "Aguardando autorização da conta do Bling."

_lista_cache: dict[tuple, tuple[float, list[dict]]] = {}
_detalhe_cache: dict[int, list[dict]] = {}
_cancelado: list[Optional[int]] = [None]


def limpar_cache() -> None:
    _lista_cache.clear()
    _detalhe_cache.clear()
    _cancelado[0] = None


def id_cancelado(cli: BlingCliente) -> int:
    """Id da situacao 'Cancelado' (modulo de vendas). Sem achar, falha: nunca chuta."""
    if settings.bling_situacao_cancelado_id:
        return settings.bling_situacao_cancelado_id
    if _cancelado[0] is not None:
        return _cancelado[0]
    modulos = cli.get("/situacoes/modulos").get("data") or []
    mod = next((m for m in modulos if "venda" in str(m.get("nome", "")).casefold()), None)
    if mod:
        situacoes = cli.get(f"/situacoes/modulos/{mod['id']}").get("data") or []
        sit = next((s for s in situacoes if str(s.get("nome", "")).strip().casefold() == "cancelado"), None)
        if sit:
            _cancelado[0] = int(sit["id"])
            return _cancelado[0]
    raise BlingIndisponivel("Situação 'Cancelado' não encontrada no Bling.")


def _pedidos_da_loja(cli: BlingCliente, loja: int, inicio: date, fim: date, cancelado: int, agora: Callable[[], float]) -> list[dict]:
    chave = (loja, inicio, fim)
    hit = _lista_cache.get(chave)
    if hit and agora() - hit[0] < LISTA_TTL_S:
        return hit[1]
    saida: list[dict] = []
    for pagina in range(1, MAX_PAGINAS + 1):
        data = cli.get(
            "/pedidos/vendas",
            {"dataInicial": inicio.isoformat(), "dataFinal": fim.isoformat(), "idLoja": loja, "limite": LIMITE, "pagina": pagina},
        ).get("data") or []
        for p in data:
            if int((p.get("situacao") or {}).get("id", -1)) == cancelado:
                continue
            try:
                saida.append({"id": int(p["id"]), "data": date.fromisoformat(str(p["data"])[:10]), "total": float(p["total"])})
            except (KeyError, TypeError, ValueError):
                continue  # pedido sem data ou sem total = sem dado
        if len(data) < LIMITE:
            break
    _lista_cache[chave] = (agora(), saida)
    return saida


def pedidos(cli: BlingCliente, inicio: date, fim: date, agora: Callable[[], float] = time.monotonic) -> list[dict]:
    """Pedidos nao cancelados das 6 lojas: {id, data, marca, plataforma, total}."""
    cancelado = id_cancelado(cli)
    saida = []
    for loja, (marca, plat) in LOJAS.items():
        for p in _pedidos_da_loja(cli, loja, inicio, fim, cancelado, agora):
            saida.append({**p, "marca": marca, "plataforma": plat})
    return saida


def _montar(linhas: list[dict], ant: list[dict], inicio: date, fim: date) -> dict:
    por_marca: dict[str, dict] = {id_: {"plat": {}, "dias": {}} for id_, _, _ in MARCAS}
    for l in linhas:
        a = por_marca[l["marca"]]
        a["plat"][l["plataforma"]] = a["plat"].get(l["plataforma"], 0.0) + l["total"]
        d = a["dias"].setdefault(l["data"], {})
        d[l["plataforma"]] = d.get(l["plataforma"], 0.0) + l["total"]
    ant_marca: dict[str, float] = {}
    for l in ant:
        ant_marca[l["marca"]] = ant_marca.get(l["marca"], 0.0) + l["total"]

    ordem = ORDEM_PLATAFORMAS.index
    marcas, por_plat = [], {}
    for id_, label, conectada in MARCAS:
        a = por_marca[id_]
        for p, v in a["plat"].items():
            por_plat[p] = por_plat.get(p, 0.0) + v
        marcas.append({
            "id": id_,
            "label": label,
            "status": "ok" if conectada else "aguardando_autorizacao",
            "total": sum(a["plat"].values()) if a["plat"] else None,
            "total_anterior": ant_marca.get(id_),
            "por_plataforma": [{"plataforma": p, "faturamento": a["plat"][p]} for p in sorted(a["plat"], key=ordem)],
            "serie": [{"data": d, "faturamento": sum(v.values()), "por_plataforma": v} for d, v in sorted(a["dias"].items())],
        })
    return {
        "disponivel": True,
        "consolidado": {
            "total": sum(por_plat.values()) if por_plat else None,
            "total_anterior": sum(ant_marca.values()) if ant_marca else None,
            "por_plataforma": [{"plataforma": p, "faturamento": por_plat[p]} for p in sorted(por_plat, key=ordem)],
        },
        "periodo": {"inicio": inicio, "fim": fim},
        "marcas": marcas,
    }


def get_marcas_menores(cli: BlingCliente, date_from: date, date_to: date, hoje: date, agora: Callable[[], float] = time.monotonic) -> dict:
    fim = min(date_to, hoje)  # o Bling e' quase em tempo real: hoje conta
    inicio = min(date_from, fim)
    try:
        linhas = pedidos(cli, inicio, fim, agora)
    except BlingIndisponivel as exc:
        return {"disponivel": False, "motivo": str(exc), "marcas": []}
    dias = (fim - inicio).days + 1
    ant_fim = inicio - timedelta(days=1)
    try:
        ant = pedidos(cli, ant_fim - timedelta(days=dias - 1), ant_fim, agora)
    except BlingIndisponivel:
        ant = []  # sem base: a variacao some, nunca vira 0
    return _montar(linhas, ant, inicio, fim)


# ---------------------------------------------------------------------------
# Produtos: itens de cada pedido (valor x quantidade - desconto), com cache por id.

def receita_do_item(item: dict) -> Optional[float]:
    """valor x quantidade - desconto do item. Sem valor ou quantidade: sem dado."""
    try:
        return float(item["valor"]) * float(item["quantidade"]) - float(item.get("desconto") or 0)
    except (KeyError, TypeError, ValueError):
        return None


def _itens(cli: BlingCliente, pedido_id: int) -> list[dict]:
    if pedido_id not in _detalhe_cache:
        _detalhe_cache[pedido_id] = (cli.get(f"/pedidos/vendas/{pedido_id}").get("data") or {}).get("itens") or []
    return _detalhe_cache[pedido_id]


def get_produtos(
    cli: BlingCliente,
    date_from: date,
    date_to: date,
    hoje: date,
    limite_detalhes: int = DETALHES_POR_CHAMADA,
    agora: Callable[[], float] = time.monotonic,
) -> dict:
    """Produto x quantidade x receita por marca. O detalhe de cada pedido custa 1 chamada (~3/s):
    le ate' `limite_detalhes` por vez e devolve `completo=False` com o progresso; o cache aquece."""
    fim = min(date_to, hoje)
    inicio = min(date_from, fim)
    try:
        lista = pedidos(cli, inicio, fim, agora)
        novos = 0
        for p in lista:
            if p["id"] in _detalhe_cache:
                continue
            if novos >= limite_detalhes:
                break
            _itens(cli, p["id"])
            novos += 1
    except BlingIndisponivel as exc:
        return {"disponivel": False, "motivo": str(exc), "marcas": []}
    lidos = [p for p in lista if p["id"] in _detalhe_cache]
    acum: dict[str, dict[str, dict]] = {id_: {} for id_, _, _ in MARCAS}
    for p in lidos:
        for it in _detalhe_cache[p["id"]]:
            chave = str(it.get("codigo") or it.get("descricao") or "").strip()
            if not chave:
                continue
            linha = acum[p["marca"]].setdefault(chave, {"sku": chave, "produto": str(it.get("descricao") or chave), "quantidade": None, "receita": None})
            try:
                q = float(it["quantidade"])
                linha["quantidade"] = (linha["quantidade"] or 0.0) + q
            except (KeyError, TypeError, ValueError):
                pass  # sem quantidade: continua sem dado, nunca 0
            r = receita_do_item(it)
            if r is not None:
                linha["receita"] = (linha["receita"] or 0.0) + r
    return {
        "disponivel": True,
        "completo": len(lidos) == len(lista),
        "pedidos_total": len(lista),
        "pedidos_lidos": len(lidos),
        "marcas": [
            {
                "id": id_,
                "label": label,
                "status": "ok" if conectada else "aguardando_autorizacao",
                "produtos": sorted(acum[id_].values(), key=lambda l: l["receita"] or 0.0, reverse=True)[:30],
            }
            for id_, label, conectada in MARCAS
        ],
    }
