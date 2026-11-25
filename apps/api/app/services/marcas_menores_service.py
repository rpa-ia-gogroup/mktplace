"""Marcas menores (Yenzah, Aua, By Samia) pela API do Bling v3 (conta da Rituaria).

A marca sai do CANAL do pedido (`loja.id`). So' Shopee e TikTok; nenhuma das tres
tem ML. A Denavita esta' em OUTRA conta Bling (conta 'denavita', autorizada pelo OAuth
da Torre): com token, ML e Shopee dela vem desse Bling (lojas mapeadas por `/canais-venda`
ou por BLING_DENAVITA_LOJAS), lidos ao vivo com o cache em memoria de 15 min (a rotina de
aquecimento segue so' na conta da Rituaria). Sem token (ou Bling dela fora), segue a fonte
PROVISORIA (T-0119): o TikTok vem da gold do Data Mart (`gold.tiktok_brand_daily`,
`brand = 'denavita'`), com status `parcial_fonte_provisoria` e aviso; a Shopee dela segue
sem fonte (ausente, nunca 0) e o consolidado declara `parcial`. O `gmv` dessa gold tem
definicao propria (1,4% a 3,9% acima do mart da Torre): nao e' o mesmo numero do Bling
nem do GMV oficial. Data Mart fora (sem engine ou erro): a Denavita volta a `total=None`
com `motivo`, sem derrubar as outras. Ausencia nunca vira 0: marca sem pedido
tem `total=None` e dia sem pedido nao entra na serie. Canal sem pedido no periodo anterior
nao entra em `por_plataforma_anterior` (nem como 0): o front so' calcula a variacao quando todo
canal do periodo atual tem base no anterior (achado C1-03).

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
from app.services.bling_token import CONTA_DENAVITA, CONTA_PADRAO, BlingIndisponivel

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

# --- Denavita: TikTok pelo Data Mart (fonte provisoria, T-0119) ------------------------------
DENAVITA = "denavita"
STATUS_FONTE_PROVISORIA = "parcial_fonte_provisoria"
STATUS_FONTE_INDISPONIVEL = "fonte_indisponivel"
AVISO_DENAVITA = (
    "TikTok via Data Mart (gold.tiktok_brand_daily); Shopee pendente: conta do Bling sem autorização. "
    "O GMV dessa gold tem definição própria (1,4% a 3,9% acima do mart da Torre)."
)
MOTIVO_DM_INDISPONIVEL = "Data Mart indisponível: sem o TikTok da Denavita agora (Shopee pendente: conta do Bling sem autorização)."
#: Sem token da conta (a rota manda o motivo exato: sem credencial, sem token, banco fora). Este e' o padrao.
MOTIVO_ITENS_DENAVITA = "Bling da Denavita sem autorização."
#: Denavita no TikTok vem do Data Mart (so' o total do dia): nunca ha' itens nesse canal.
MOTIVO_TIKTOK_SEM_ITENS = "TikTok sem itens: o Data Mart só traz o total do dia."
#: Denavita com o Bling dela (ML e Shopee): com e sem o TikTok do Data Mart.
DENAVITA_BLING = "bling"
DENAVITA_BLING_SEM_DM = "bling_sem_data_mart"
AVISO_DENAVITA_BLING = (
    "ML e Shopee pelo Bling da Denavita; TikTok via Data Mart (gold.tiktok_brand_daily), "
    "com GMV de definição própria (1,4% a 3,9% acima do mart da Torre)."
)
AVISO_DENAVITA_BLING_SEM_DM = "ML e Shopee pelo Bling da Denavita; o TikTok dela está fora agora (Data Mart indisponível)."
AVISO_PARCIAL_DENAVITA_SEM_TIKTOK = "Parcial: sem o TikTok da Denavita (Data Mart indisponível)."
AVISO_PARCIAL_DENAVITA = "Parcial: a Denavita entra só pelo TikTok (Data Mart, fonte provisória); a Shopee dela está pendente."
AVISO_PARCIAL_DENAVITA_FORA = "Parcial: sem a Denavita (Data Mart indisponível; a Shopee dela também está pendente)."
#: Grao da gold: marca x dia. Soma por dia por seguranca; valores SEMPRE por parametro.
SQL_DENAVITA_TIKTOK = """
SELECT date AS dia, SUM(gmv) AS gmv, SUM(orders) AS pedidos
  FROM gold.tiktok_brand_daily
 WHERE brand = :brand
   AND date BETWEEN :inicio AND :fim
 GROUP BY date
 ORDER BY date
"""
#: O cache do banco serve a leitura enquanto a rotina de aquecimento o renova em menos que isto.
IDADE_MAXIMA_CACHE_S = 45 * 60
#: A rotina guarda a lista dos ultimos N dias (cobre mes atual, mes anterior e o "periodo anterior" dos filtros comuns).
JANELA_HISTORICO_DIAS = 90


def _agora_dt() -> datetime:
    return datetime.now(timezone.utc)

_lista_cache: dict[tuple, tuple[float, list[dict]]] = {}
#: Itens por (conta Bling, id do pedido): o id de um pedido so' vale dentro da conta que o emitiu.
_detalhe_cache: dict[tuple[str, int], list[dict]] = {}
#: conta Bling -> id da situacao "Cancelado" (cada conta tem os seus ids)
_cancelado: dict[str, int] = {}
_lojas_denavita: dict[int, str] = {}


def limpar_cache() -> None:
    _lista_cache.clear()
    _detalhe_cache.clear()
    _cancelado.clear()
    _lojas_denavita.clear()


def id_cancelado(cli: BlingCliente, cache: Optional[CacheBling] = None, conta: str = CONTA_PADRAO) -> int:
    """Id da situacao 'Cancelado' (modulo de vendas). Sem achar, falha: nunca chuta.
    O id fixo das settings e o cache do banco valem so' para a conta da Rituaria."""
    propria = conta == CONTA_PADRAO
    if propria and settings.bling_situacao_cancelado_id:
        return settings.bling_situacao_cancelado_id
    if conta == CONTA_DENAVITA and settings.bling_denavita_situacao_cancelado_id:
        return settings.bling_denavita_situacao_cancelado_id
    if conta in _cancelado:
        return _cancelado[conta]
    guardado = cache.ler_sync("cancelado_id") if cache and propria else None
    if guardado and guardado[0]:
        _cancelado[conta] = int(guardado[0])
        return _cancelado[conta]
    modulos = cli.get("/situacoes/modulos").get("data") or []
    mod = next((m for m in modulos if "venda" in str(m.get("nome", "")).casefold()), None)
    if mod:
        situacoes = cli.get(f"/situacoes/modulos/{mod['id']}").get("data") or []
        sit = next((s for s in situacoes if str(s.get("nome", "")).strip().casefold() == "cancelado"), None)
        if sit:
            _cancelado[conta] = int(sit["id"])
            if cache and propria:
                cache.marcar_sync("cancelado_id", str(_cancelado[conta]))
            return _cancelado[conta]
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


def _plataforma_do_canal(canal: dict) -> Optional[str]:
    nome = f"{canal.get('tipo', '')} {canal.get('descricao', '')}".casefold().replace(" ", "")
    if "mercadolivre" in nome or "meli" in nome:
        return "MELI"
    if "shopee" in nome:
        return "SHOPEE"
    return None  # TikTok da Denavita vem do Data Mart; outros canais ficam fora


def lojas_denavita(cli: BlingCliente) -> dict[int, str]:
    """id da loja (canal) no Bling da Denavita -> plataforma (so' MELI e SHOPEE).
    BLING_DENAVITA_LOJAS ("id:MELI,id:SHOPEE") vence; senao, descobre por /canais-venda."""
    if settings.bling_denavita_lojas.strip():
        mapa = {}
        for par in settings.bling_denavita_lojas.split(","):
            id_, _, plat = par.strip().partition(":")
            if id_.strip().isdigit() and plat.strip().upper() in ("MELI", "SHOPEE"):
                mapa[int(id_)] = plat.strip().upper()
        if mapa:
            return mapa
    if not _lojas_denavita:
        for c in cli.get("/canais-venda").get("data") or []:
            plat = _plataforma_do_canal(c)
            if plat and str(c.get("id", "")).isdigit():
                _lojas_denavita[int(c["id"])] = plat
    if not _lojas_denavita:
        raise BlingIndisponivel("Lojas de ML e Shopee da Denavita não encontradas no Bling.")
    return dict(_lojas_denavita)


def pedidos_denavita_bling(cli: BlingCliente, inicio: date, fim: date, agora: Callable[[], float] = time.monotonic) -> list[dict]:
    """Pedidos nao cancelados de ML e Shopee no Bling da Denavita (mesma regra das outras marcas). Falha sobe."""
    cancelado = id_cancelado(cli, conta=CONTA_DENAVITA)
    saida = []
    for loja, plat in lojas_denavita(cli).items():
        for p in _pedidos_da_loja(cli, loja, inicio, fim, cancelado, agora):
            saida.append({**p, "marca": DENAVITA, "plataforma": plat})
    return saida


def consultar_datamart(sql: str, params: dict) -> list[dict]:
    """Direto no Data Mart (`datamart_engine`); a reserva pelo Metabase so' nos casos de
    `datamart_leitura` (permissao, conexao ou sem engine, com chave configurada)."""
    from app.services import datamart_leitura  # import tardio: testes injetam `consultar`

    return datamart_leitura.consultar(sql, params)


def _dia(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])  # a reserva pelo Metabase devolve texto ISO


def pedidos_denavita_tiktok(consultar: Callable[[str, dict], list[dict]], inicio: date, fim: date) -> list[dict]:
    """Dias da Denavita no TikTok (gold) como linhas agregadas: {data, marca, plataforma, total, pedidos}.
    Dia sem linha nao volta; linha com `gmv` nulo e' sem dado (fora, nunca 0). Falha sobe."""
    saida = []
    for r in consultar(SQL_DENAVITA_TIKTOK, {"brand": DENAVITA, "inicio": inicio, "fim": fim}):
        if r.get("gmv") is None or r.get("dia") is None:
            continue
        ped = r.get("pedidos")
        saida.append({
            "data": _dia(r["dia"]), "marca": DENAVITA, "plataforma": "TIKTOK", "total": float(r["gmv"]),
            "pedidos": None if ped is None else int(ped),
        })
    return saida


def _montar(
    linhas: list[dict], ant: list[dict], inicio: date, fim: date, status_denavita: Optional[str] = None,
    motivo_bling_denavita: Optional[str] = None,
) -> dict:
    """Cada linha do Bling e' 1 pedido; a linha agregada da gold traz `pedidos` (None = sem dado, nao conta)."""
    por_marca: dict[str, dict] = {id_: {"plat": {}, "dias": {}, "dias_ped": {}} for id_, _, _ in MARCAS}
    for l in linhas:
        a = por_marca[l["marca"]]
        a["plat"][l["plataforma"]] = a["plat"].get(l["plataforma"], 0.0) + l["total"]
        d = a["dias"].setdefault(l["data"], {})
        d[l["plataforma"]] = d.get(l["plataforma"], 0.0) + l["total"]
        n = l.get("pedidos", 1)
        if n is not None:
            dp = a["dias_ped"].setdefault(l["data"], {})
            dp[l["plataforma"]] = dp.get(l["plataforma"], 0) + n
    ant_plat: dict[str, dict[str, float]] = {}  # marca -> plataforma -> total do periodo anterior
    for l in ant:
        d = ant_plat.setdefault(l["marca"], {})
        d[l["plataforma"]] = d.get(l["plataforma"], 0.0) + l["total"]
    ant_marca = {m: sum(d.values()) for m, d in ant_plat.items()}
    # Contagem de pedidos (cada linha da lista e um pedido nao cancelado): ticket = GMV / pedidos no front.
    qtd: dict[str, dict[str, int]] = {}
    qtd_ant: dict[str, dict[str, int]] = {}
    for fonte, destino in ((linhas, qtd), (ant, qtd_ant)):
        for l in fonte:
            n = l.get("pedidos", 1)
            if n is None:
                continue  # pedidos sem dado: nao vira 0
            d = destino.setdefault(l["marca"], {})
            d[l["plataforma"]] = d.get(l["plataforma"], 0) + n
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
        status = "ok" if conectada else "aguardando_autorizacao"
        aviso = motivo = None
        if id_ == DENAVITA and status_denavita in (DENAVITA_BLING, DENAVITA_BLING_SEM_DM):
            status = "ok"
            aviso = AVISO_DENAVITA_BLING if status_denavita == DENAVITA_BLING else AVISO_DENAVITA_BLING_SEM_DM
        elif id_ == DENAVITA and status_denavita is not None:
            status, aviso = status_denavita, AVISO_DENAVITA
            motivo = MOTIVO_DM_INDISPONIVEL if status_denavita == STATUS_FONTE_INDISPONIVEL else None
            if motivo_bling_denavita:  # por que o Bling dela nao entrou (sem token, sem credencial, erro da API)
                motivo = f"{motivo} {motivo_bling_denavita}" if motivo else motivo_bling_denavita
        marcas.append({
            "id": id_,
            "label": label,
            "status": status,
            #: Fonte provisoria (Denavita): de onde vem o numero e o que falta.
            "aviso": aviso,
            #: Por que `total` e' None quando a fonte falhou (nunca 0).
            "motivo": motivo,
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
    # Parcial: alguma marca fora do Bling conectado (Denavita provisoria, indisponivel ou aguardando).
    parcial = any(m["status"] != "ok" for m in marcas) or status_denavita == DENAVITA_BLING_SEM_DM
    aviso_total = None
    if status_denavita == DENAVITA_BLING_SEM_DM:
        aviso_total = AVISO_PARCIAL_DENAVITA_SEM_TIKTOK
    elif status_denavita == STATUS_FONTE_PROVISORIA:
        aviso_total = AVISO_PARCIAL_DENAVITA
    elif status_denavita == STATUS_FONTE_INDISPONIVEL:
        aviso_total = AVISO_PARCIAL_DENAVITA_FORA
    return {
        "disponivel": True,
        "consolidado": {
            #: True = o total nao cobre todas as marcas/canais (ex.: Shopee da Denavita pendente).
            "parcial": parcial,
            "aviso": aviso_total,
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
    consultar_dm: Optional[Callable[[str, dict], list[dict]]] = None,
    cli_denavita: Optional[BlingCliente] = None,
    motivo_sem_bling_denavita: Optional[str] = None,
) -> dict:
    """`consultar_dm`: leitura do Data Mart para o TikTok da Denavita. A rota passa
    `consultar_datamart`; sem ela (rotina, chamadas diretas) a Denavita fica indisponivel e
    nada toca o Data Mart. O cache/aquecimento do Bling nao depende disto.
    `cli_denavita`: cliente do Bling da Denavita (so' quando a conta tem token). Sem ele, ou com o
    Bling dela fora, a Denavita segue como antes (TikTok provisorio, aviso, nunca 0)."""
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
    ant_ini = ant_fim - timedelta(days=dias - 1)
    com_bling = False
    motivo_bling = motivo_sem_bling_denavita
    if cli_denavita is not None:
        try:
            den = pedidos_denavita_bling(cli_denavita, ant_ini, fim, agora)  # atual + anterior numa leitura so'
            linhas = linhas + [l for l in den if l["data"] >= inicio]
            ant = ant + [l for l in den if l["data"] <= ant_fim]
            com_bling = True
        except BlingIndisponivel as exc:  # motivo ja' sanitizado; a Denavita volta ao caminho provisorio
            logger.warning("marcas_menores: Bling da Denavita indisponivel (%s)", exc)
            motivo_bling = f"Bling da Denavita: {exc}"
    com_dm = False
    if consultar_dm is not None:
        try:
            dm = pedidos_denavita_tiktok(consultar_dm, ant_ini, fim)  # atual + anterior numa consulta so'
            linhas = linhas + [l for l in dm if l["data"] >= inicio]
            ant = ant + [l for l in dm if l["data"] <= ant_fim]
            com_dm = True
        except Exception as exc:  # noqa: BLE001 - motivo fixo; o texto da excecao (pode ter DSN) nunca sai
            logger.warning("marcas_menores: Data Mart da Denavita falhou (%s)", type(exc).__name__)
    if com_bling:
        status_denavita = DENAVITA_BLING if com_dm else DENAVITA_BLING_SEM_DM
    else:
        status_denavita = STATUS_FONTE_PROVISORIA if com_dm else STATUS_FONTE_INDISPONIVEL
    return _montar(linhas, ant, inicio, fim, status_denavita, None if com_bling else motivo_bling)


# ---------------------------------------------------------------------------
# Produtos: itens de cada pedido (valor x quantidade - desconto), com cache por id.

def receita_do_item(item: dict) -> Optional[float]:
    """valor x quantidade - desconto do item. Sem valor ou quantidade: sem dado."""
    try:
        return float(item["valor"]) * float(item["quantidade"]) - float(item.get("desconto") or 0)
    except (KeyError, TypeError, ValueError):
        return None


def _chave(p: dict) -> tuple[str, int]:
    return (p["conta"], p["id"])


def _itens(cli: BlingCliente, pedido_id: int, cache: Optional[CacheBling] = None, conta: str = CONTA_PADRAO) -> list[dict]:
    """`cache` (banco) so' vale para a Rituaria: `audit.bling_pedido_itens` tem o id do pedido como chave unica,
    sem a conta, e ids de contas diferentes podem coincidir. Os itens da Denavita ficam so' na memoria."""
    chave = (conta, pedido_id)
    if chave not in _detalhe_cache:
        itens = (cli.get(f"/pedidos/vendas/{pedido_id}").get("data") or {}).get("itens") or []
        _detalhe_cache[chave] = itens
        if cache is not None and conta == CONTA_PADRAO:
            cache.salvar_itens(pedido_id, itens)  # pedido com detalhe lido nao muda: nunca mais e' relido
    return _detalhe_cache[chave]


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
    cli_denavita: Optional[BlingCliente] = None,
    motivo_sem_bling_denavita: Optional[str] = None,
) -> dict:
    """Produto x quantidade x receita por marca. O detalhe de cada pedido custa 1 chamada (~3/s):
    le ate' `limite_detalhes` por vez e devolve `completo=False` com o progresso; o cache aquece.

    Os MESMOS filtros do GMV valem para os itens: periodo, canal (`plataformas`) e marca (`marcas`),
    com cancelados fora. Itens de um canal ou marca fora do recorte nunca entram (nem sao lidos).

    Denavita: ML e Shopee pelo Bling DELA (`cli_denavita`, so' quando a conta tem token), lidos ao vivo e por
    partes, no mesmo limite de `limite_detalhes` (a rotina de aquecimento so' conhece as lojas da Rituaria).
    O TikTok dela vem do Data Mart, sem itens: nesse canal ficam ausentes, com motivo. Sem `cli_denavita`,
    a marca fica sem itens e o motivo diz por que (`motivo_sem_bling_denavita`); nunca 0."""
    fim = min(date_to, hoje)
    inicio = min(date_from, fim)
    plat_ok = {p.upper() for p in plataformas} if plataformas is not None else None
    marca_ok = set(marcas) if marcas is not None else None
    orcamento = limite_detalhes  # o mesmo teto de leituras ao vivo vale para as duas contas
    try:
        lista = [
            {**p, "conta": CONTA_PADRAO} for p in pedidos(cli, inicio, fim, agora, cache, ao_faltar_cache)
            if (plat_ok is None or p["plataforma"] in plat_ok) and (marca_ok is None or p["marca"] in marca_ok)
        ]
        novos = 0
        if cache is not None:  # itens ja' lidos (pela rotina ou por pedidos anteriores): 1 consulta ao banco
            faltam = [p["id"] for p in lista if _chave(p) not in _detalhe_cache]
            _detalhe_cache.update({(CONTA_PADRAO, i): v for i, v in cache.itens(faltam).items()})
        # Com o cache persistente e a rotina ligados, a REQUISICAO nao le item no Bling (36 itens ~ 30 s): devolve o
        # que o banco tem, com o progresso, e aciona a rotina, que preenche o resto. Sem cache (ou rotina
        # desligada) continua lendo ao vivo, por partes.
        ao_vivo = cache is None or not settings.bling_warm_enabled
        if not ao_vivo:
            limite_detalhes = 0
            if ao_faltar_cache is not None and any(_chave(p) not in _detalhe_cache for p in lista):
                ao_faltar_cache()
        for p in lista:
            if _chave(p) in _detalhe_cache:
                continue
            if novos >= limite_detalhes:
                break
            _itens(cli, p["id"], cache)
            novos += 1
    except BlingIndisponivel as exc:
        return {"disponivel": False, "motivo": str(exc), "marcas": []}

    # Denavita (conta propria no Bling): ML e Shopee; o Bling dela falhar nao derruba as outras marcas.
    den_status, den_motivo = "ok", None
    if cli_denavita is None:
        den_status, den_motivo = "aguardando_autorizacao", motivo_sem_bling_denavita or MOTIVO_ITENS_DENAVITA
    else:
        den_plat = {"MELI", "SHOPEE"} if plat_ok is None else {"MELI", "SHOPEE"} & plat_ok
        if den_plat and (marca_ok is None or DENAVITA in marca_ok):
            try:
                den = [
                    {**p, "conta": CONTA_DENAVITA}
                    for p in pedidos_denavita_bling(cli_denavita, inicio, fim, agora) if p["plataforma"] in den_plat
                ]
                lista = lista + den
                for p in den:
                    if _chave(p) in _detalhe_cache:
                        continue
                    if novos >= orcamento:
                        break
                    _itens(cli_denavita, p["id"], None, CONTA_DENAVITA)
                    novos += 1
            except BlingIndisponivel as exc:  # motivo ja' sanitizado; o que foi lido ate' aqui fica
                logger.warning("marcas_menores: itens do Bling da Denavita indisponiveis (%s)", exc)
                den_status, den_motivo = STATUS_FONTE_INDISPONIVEL, f"Bling da Denavita: {exc}"
        if den_motivo is None and (plat_ok is None or "TIKTOK" in plat_ok):
            den_motivo = MOTIVO_TIKTOK_SEM_ITENS
    lidos = [p for p in lista if _chave(p) in _detalhe_cache]
    acum: dict[str, dict[str, dict]] = {id_: {} for id_, _, _ in MARCAS}
    por_canal: dict[str, dict[tuple, dict]] = {id_: {} for id_, _, _ in MARCAS}
    gmv_pedidos: dict[str, float] = {}
    for p in lista:
        gmv_pedidos[p["marca"]] = gmv_pedidos.get(p["marca"], 0.0) + p["total"]
    for p in lidos:
        no_pedido: set = set()  # um produto conta 1 pedido, mesmo repetido nos itens dele
        for it in _detalhe_cache[_chave(p)]:
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
                    if (p["id"], k) not in no_pedido:
                        no_pedido.add((p["id"], k))
                        linha["pedidos"] = linha.get("pedidos", 0) + 1
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
                "status": den_status if id_ == DENAVITA else ("ok" if conectada else "aguardando_autorizacao"),
                #: Por que a marca nao tem itens (ou so' parte deles); nunca 0.
                "motivo": den_motivo if id_ == DENAVITA else (None if conectada else AGUARDANDO),
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
