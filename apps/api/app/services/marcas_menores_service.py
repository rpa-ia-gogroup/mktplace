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
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable, Optional

from app.config import settings
from app.services.bling_cache import CacheBling
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
#: O cache do banco serve a leitura enquanto a rotina de aquecimento o renova em menos que isto.
IDADE_MAXIMA_CACHE_S = 45 * 60
#: A rotina guarda a lista dos ultimos N dias (cobre mes atual, mes anterior e o "periodo anterior" dos filtros comuns).
JANELA_HISTORICO_DIAS = 90


def _agora_dt() -> datetime:
    return datetime.now(timezone.utc)

_lista_cache: dict[tuple, tuple[float, list[dict]]] = {}
_detalhe_cache: dict[int, list[dict]] = {}
_cancelado: list[Optional[int]] = [None]


def limpar_cache() -> None:
    _lista_cache.clear()
    _detalhe_cache.clear()
    _cancelado[0] = None


def id_cancelado(cli: BlingCliente, cache: Optional[CacheBling] = None) -> int:
    """Id da situacao 'Cancelado' (modulo de vendas). Sem achar, falha: nunca chuta."""
    if settings.bling_situacao_cancelado_id:
        return settings.bling_situacao_cancelado_id
    if _cancelado[0] is not None:
        return _cancelado[0]
    guardado = cache.ler_sync("cancelado_id") if cache else None
    if guardado and guardado[0]:
        _cancelado[0] = int(guardado[0])
        return _cancelado[0]
    modulos = cli.get("/situacoes/modulos").get("data") or []
    mod = next((m for m in modulos if "venda" in str(m.get("nome", "")).casefold()), None)
    if mod:
        situacoes = cli.get(f"/situacoes/modulos/{mod['id']}").get("data") or []
        sit = next((s for s in situacoes if str(s.get("nome", "")).strip().casefold() == "cancelado"), None)
        if sit:
            _cancelado[0] = int(sit["id"])
            if cache:
                cache.marcar_sync("cancelado_id", str(_cancelado[0]))
            return _cancelado[0]
    raise BlingIndisponivel("Situação 'Cancelado' não encontrada no Bling.")


def listar_bruto(cli: BlingCliente, loja: int, inicio: date, fim: date, extra: Optional[dict] = None) -> list[dict]:
    """Todas as paginas da lista de uma loja na janela: {id, data, total, situacao_id}, cancelados incluidos.
    `extra` acrescenta filtros (ex.: `dataAlteracaoInicial`)."""
    saida: list[dict] = []
    for pagina in range(1, MAX_PAGINAS + 1):
        data = cli.get(
            "/pedidos/vendas",
            {"dataInicial": inicio.isoformat(), "dataFinal": fim.isoformat(), "idLoja": loja, "limite": LIMITE, "pagina": pagina, **(extra or {})},
        ).get("data") or []
        for p in data:
            try:
                saida.append({
                    "id": int(p["id"]),
                    "data": date.fromisoformat(str(p["data"])[:10]),
                    "total": float(p["total"]),
                    "situacao_id": int((p.get("situacao") or {}).get("id", -1)),
                })
            except (KeyError, TypeError, ValueError):
                continue  # pedido sem data ou sem total = sem dado
        if len(data) < LIMITE:
            break
    return saida


def _pedidos_da_loja(cli: BlingCliente, loja: int, inicio: date, fim: date, cancelado: int, agora: Callable[[], float]) -> list[dict]:
    chave = (loja, inicio, fim)
    hit = _lista_cache.get(chave)
    if hit and agora() - hit[0] < LISTA_TTL_S:
        return hit[1]
    saida = [
        {"id": p["id"], "data": p["data"], "total": p["total"]}
        for p in listar_bruto(cli, loja, inicio, fim)
        if p["situacao_id"] != cancelado
    ]
    _lista_cache[chave] = (agora(), saida)
    return saida


def cache_cobre(cache: Optional[CacheBling], inicio: date, agora_dt: Callable[[], datetime] = _agora_dt) -> bool:
    """O cache do banco serve a janela quando TODAS as lojas foram sincronizadas desde antes de `inicio`
    e a ultima sincronizacao e' recente. Senao, a leitura vai ao Bling (e a rotina e' acionada)."""
    if cache is None:
        return False
    agora = agora_dt()
    marcas = cache.ler_sync_prefixo("lista:")  # uma consulta so', nao uma por loja
    for loja in LOJAS:
        s = marcas.get(f"lista:{loja}")
        if not s or not s[0] or s[0] > inicio.isoformat():
            return False
        ult = s[1] if s[1].tzinfo else s[1].replace(tzinfo=timezone.utc)
        if (agora - ult).total_seconds() > IDADE_MAXIMA_CACHE_S:
            return False
    return True


def pedidos(
    cli: BlingCliente,
    inicio: date,
    fim: date,
    agora: Callable[[], float] = time.monotonic,
    cache: Optional[CacheBling] = None,
    ao_faltar_cache: Optional[Callable[[], None]] = None,
    agora_dt: Callable[[], datetime] = _agora_dt,
) -> list[dict]:
    """Pedidos nao cancelados das 6 lojas: {id, data, marca, plataforma, total}.
    Com o cache do banco quente, le so' dele (sem chamar o Bling); senao, vai ao Bling e aciona a rotina."""
    cancelado = id_cancelado(cli, cache)
    saida = []
    if cache_cobre(cache, inicio, agora_dt):
        for r in cache.pedidos(LOJAS.keys(), inicio, fim):
            if r["situacao_id"] == cancelado:
                continue
            marca, plat = LOJAS[int(r["loja_id"])]
            saida.append({"id": int(r["id"]), "data": r["data"], "total": r["total"], "marca": marca, "plataforma": plat})
        return saida
    if cache is not None and ao_faltar_cache is not None:
        ao_faltar_cache()
    for loja, (marca, plat) in LOJAS.items():
        for p in _pedidos_da_loja(cli, loja, inicio, fim, cancelado, agora):
            saida.append({**p, "marca": marca, "plataforma": plat})
    return saida


def _montar(linhas: list[dict], ant: list[dict], inicio: date, fim: date) -> dict:
    por_marca: dict[str, dict] = {id_: {"plat": {}, "dias": {}, "dias_ped": {}} for id_, _, _ in MARCAS}
    for l in linhas:
        a = por_marca[l["marca"]]
        a["plat"][l["plataforma"]] = a["plat"].get(l["plataforma"], 0.0) + l["total"]
        d = a["dias"].setdefault(l["data"], {})
        d[l["plataforma"]] = d.get(l["plataforma"], 0.0) + l["total"]
        dp = a["dias_ped"].setdefault(l["data"], {})
        dp[l["plataforma"]] = dp.get(l["plataforma"], 0) + 1
    ant_plat: dict[str, dict[str, float]] = {}  # marca -> plataforma -> total do periodo anterior
    for l in ant:
        d = ant_plat.setdefault(l["marca"], {})
        d[l["plataforma"]] = d.get(l["plataforma"], 0.0) + l["total"]
    ant_marca = {m: sum(d.values()) for m, d in ant_plat.items()}
    # Contagem de pedidos (cada linha da lista e um pedido nao cancelado): ticket = GMV / pedidos no front.
    qtd: dict[str, dict[str, int]] = {}
    for l in linhas:
        d = qtd.setdefault(l["marca"], {})
        d[l["plataforma"]] = d.get(l["plataforma"], 0) + 1
    qtd_ant: dict[str, dict[str, int]] = {}
    for l in ant:
        d = qtd_ant.setdefault(l["marca"], {})
        d[l["plataforma"]] = d.get(l["plataforma"], 0) + 1
    qtd_total: dict[str, int] = {}
    qtd_ant_total: dict[str, int] = {}
    for src, dst in ((qtd, qtd_total), (qtd_ant, qtd_ant_total)):
        for d in src.values():
            for p, n in d.items():
                dst[p] = dst.get(p, 0) + n
    ant_total_plat: dict[str, float] = {}
    for d in ant_plat.values():
        for p, v in d.items():
            ant_total_plat[p] = ant_total_plat.get(p, 0.0) + v

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
            "por_plataforma_anterior": ant_plat.get(id_, {}),
            "pedidos": sum(qtd[id_].values()) if qtd.get(id_) else None,
            "pedidos_por_plataforma": qtd.get(id_, {}),
            "pedidos_por_plataforma_anterior": qtd_ant.get(id_, {}),
            "por_plataforma": [{"plataforma": p, "faturamento": a["plat"][p]} for p in sorted(a["plat"], key=ordem)],
            "serie": [
                {"data": d, "faturamento": sum(v.values()), "por_plataforma": v, "pedidos_por_plataforma": a["dias_ped"].get(d, {})}
                for d, v in sorted(a["dias"].items())
            ],
        })
    return {
        "disponivel": True,
        "consolidado": {
            "total": sum(por_plat.values()) if por_plat else None,
            "total_anterior": sum(ant_marca.values()) if ant_marca else None,
            "por_plataforma_anterior": ant_total_plat,
            "pedidos": sum(qtd_total.values()) if qtd_total else None,
            "pedidos_por_plataforma": qtd_total,
            "pedidos_por_plataforma_anterior": qtd_ant_total,
            "por_plataforma": [{"plataforma": p, "faturamento": por_plat[p]} for p in sorted(por_plat, key=ordem)],
        },
        "periodo": {"inicio": inicio, "fim": fim},
        "marcas": marcas,
    }


def get_marcas_menores(
    cli: BlingCliente,
    date_from: date,
    date_to: date,
    hoje: date,
    agora: Callable[[], float] = time.monotonic,
    cache: Optional[CacheBling] = None,
    ao_faltar_cache: Optional[Callable[[], None]] = None,
) -> dict:
    fim = min(date_to, hoje)  # o Bling e' quase em tempo real: hoje conta
    inicio = min(date_from, fim)
    try:
        linhas = pedidos(cli, inicio, fim, agora, cache, ao_faltar_cache)
    except BlingIndisponivel as exc:
        return {"disponivel": False, "motivo": str(exc), "marcas": []}
    dias = (fim - inicio).days + 1
    ant_fim = inicio - timedelta(days=1)
    try:
        ant = pedidos(cli, ant_fim - timedelta(days=dias - 1), ant_fim, agora, cache, ao_faltar_cache)
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


def _itens(cli: BlingCliente, pedido_id: int, cache: Optional[CacheBling] = None) -> list[dict]:
    if pedido_id not in _detalhe_cache:
        itens = (cli.get(f"/pedidos/vendas/{pedido_id}").get("data") or {}).get("itens") or []
        _detalhe_cache[pedido_id] = itens
        if cache is not None:
            cache.salvar_itens(pedido_id, itens)  # pedido com detalhe lido nao muda: nunca mais e' relido
    return _detalhe_cache[pedido_id]


def get_produtos(
    cli: BlingCliente,
    date_from: date,
    date_to: date,
    hoje: date,
    limite_detalhes: int = DETALHES_POR_CHAMADA,
    agora: Callable[[], float] = time.monotonic,
    plataformas: Optional[Iterable[str]] = None,
    marcas: Optional[Iterable[str]] = None,
    cache: Optional[CacheBling] = None,
    ao_faltar_cache: Optional[Callable[[], None]] = None,
) -> dict:
    """Produto x quantidade x receita por marca. O detalhe de cada pedido custa 1 chamada (~3/s):
    le ate' `limite_detalhes` por vez e devolve `completo=False` com o progresso; o cache aquece.

    Os MESMOS filtros do GMV valem para os itens: periodo, canal (`plataformas`) e marca (`marcas`),
    com cancelados fora. Itens de um canal ou marca fora do recorte nunca entram (nem sao lidos)."""
    fim = min(date_to, hoje)
    inicio = min(date_from, fim)
    plat_ok = {p.upper() for p in plataformas} if plataformas is not None else None
    marca_ok = set(marcas) if marcas is not None else None
    try:
        lista = [
            p for p in pedidos(cli, inicio, fim, agora, cache, ao_faltar_cache)
            if (plat_ok is None or p["plataforma"] in plat_ok) and (marca_ok is None or p["marca"] in marca_ok)
        ]
        novos = 0
        if cache is not None:  # itens ja' lidos (pela rotina ou por pedidos anteriores): 1 consulta ao banco
            faltam = [p["id"] for p in lista if p["id"] not in _detalhe_cache]
            _detalhe_cache.update(cache.itens(faltam))
        # Com o cache persistente e a rotina ligados, a REQUISICAO nao le item no Bling (36 itens ~ 30 s): devolve o
        # que o banco tem, com o progresso, e aciona a rotina, que preenche o resto. Sem cache (ou rotina
        # desligada) continua lendo ao vivo, por partes.
        ao_vivo = cache is None or not settings.bling_warm_enabled
        if not ao_vivo:
            limite_detalhes = 0
            if ao_faltar_cache is not None and any(p["id"] not in _detalhe_cache for p in lista):
                ao_faltar_cache()
        for p in lista:
            if p["id"] in _detalhe_cache:
                continue
            if novos >= limite_detalhes:
                break
            _itens(cli, p["id"], cache)
            novos += 1
    except BlingIndisponivel as exc:
        return {"disponivel": False, "motivo": str(exc), "marcas": []}
    lidos = [p for p in lista if p["id"] in _detalhe_cache]
    acum: dict[str, dict[str, dict]] = {id_: {} for id_, _, _ in MARCAS}
    por_canal: dict[str, dict[tuple, dict]] = {id_: {} for id_, _, _ in MARCAS}
    gmv_pedidos: dict[str, float] = {}
    for p in lista:
        gmv_pedidos[p["marca"]] = gmv_pedidos.get(p["marca"], 0.0) + p["total"]
    for p in lidos:
        for it in _detalhe_cache[p["id"]]:
            chave = str(it.get("codigo") or it.get("descricao") or "").strip()
            if not chave:
                continue
            q, r = None, receita_do_item(it)
            try:
                q = float(it["quantidade"])
            except (KeyError, TypeError, ValueError):
                pass  # sem quantidade: continua sem dado, nunca 0
            for mapa, k in ((acum[p["marca"]], chave), (por_canal[p["marca"]], (p["plataforma"], chave))):
                linha = mapa.setdefault(k, {"sku": chave, "produto": str(it.get("descricao") or chave), "quantidade": None, "receita": None})
                if mapa is por_canal[p["marca"]]:
                    linha["plataforma"] = p["plataforma"]
                if q is not None:
                    linha["quantidade"] = (linha["quantidade"] or 0.0) + q
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
                #: Mesmo produto por canal (o Gerencial tem filtro de canal): so' o que o recorte tem.
                "itens_por_canal": sorted(por_canal[id_].values(), key=lambda l: l["receita"] or 0.0, reverse=True)[:100],
                #: Soma dos itens lidos x GMV (total dos pedidos) do mesmo recorte: a conferencia.
                "receita_itens": sum(l["receita"] or 0.0 for l in acum[id_].values()) if acum[id_] else None,
                "gmv_pedidos": gmv_pedidos.get(id_),
            }
            for id_, label, conectada in MARCAS
        ],
    }
