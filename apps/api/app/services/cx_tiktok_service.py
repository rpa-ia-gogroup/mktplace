"""CX do TikTok Shop direto da Open API (app da Torre), por marca.

Para cada marca com token em `audit.tiktok_oauth_token`: devolucoes/reembolsos
(`/return_refund/202309/returns/search`) e cancelamentos (`/cancellations/search`) criados
na janela. Leitura POR DIA, em paralelo, com cache por (marca, dia): dia fechado vale 6 h, os 3
ultimos 10 min; uma rotina mantem 30/7/90 dias quentes. Junta por motivo (Pareto) e por marca.
Marca sem permissao/erro nao derruba as outras: vem com `estado` e `motivo`.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from app.services import tiktok_token
from app.services.tiktok_client import Cliente, TikTokErro

logger = logging.getLogger(__name__)
TZ = ZoneInfo("America/Sao_Paulo")
CACHE_S = 600
_cache: dict[int, tuple[float, dict]] = {}
_trava = threading.Lock()
_cipher: dict[str, str] = {}

AUTOR = {"BUYER": "Comprador", "SELLER": "Loja", "SYSTEM": "Plataforma", "OPERATOR": "Plataforma",
         "BUYER_CANCEL": "Comprador", "SELLER_CANCEL": "Loja", "SYSTEM_CANCEL": "Plataforma"}
#: Nao pago: o TikTok cancela sozinho; fica fora do Pareto (mesma regra da Shopee), contado a' parte.
NAO_PAGO = {"customer overdue to pay"}
#: Motivos mais comuns em portugues; fora do mapa, sai o texto do TikTok.
MOTIVOS_PT = {
    "no longer needed": "Não quer mais",
    "bought by mistake": "Comprou por engano",
    "need to change payment method": "Quer mudar a forma de pagamento",
    "need to change delivery address": "Quer mudar o endereço",
    "need to change the delivery address": "Quer mudar o endereço",
    "package received but missing item": "Pacote chegou faltando item",
    "package arrived damaged. example: spilled liquid, damaged box.": "Pacote chegou danificado",
    "package wasn't received": "Pacote não recebido",
    "package was not received": "Pacote não recebido",
    "item doesn't match description": "Produto diferente do anúncio",
    "item does not match description": "Produto diferente do anúncio",
    "wrong item was sent": "Produto errado enviado",
    "received wrong item": "Produto errado enviado",
    "product is defective or doesn't work": "Produto com defeito",
    "found a better price": "Achou preço melhor",
    "delivery takes too long": "Entrega demorando",
    "seller is out of stock": "Sem estoque",
    "out of stock": "Sem estoque",
    "item is counterfeit": "Suspeita de falsificação",
    "expired product": "Produto vencido",
    "better price available": "Achou preço melhor",
    "forgot to apply coupons": "Esqueceu de usar cupom",
    "package lost": "Pacote extraviado",
    "discount not as expected": "Desconto diferente do esperado",
    "incorrect shipping address": "Endereço de entrega errado",
    "wrong shipping address": "Endereço de entrega errado",
    "change of mind": "Mudou de ideia",
    "item is damaged": "Produto danificado",
    "damaged item": "Produto danificado",
    "product doesn't work": "Produto não funciona",
    "missing parts or accessories": "Faltam peças ou acessórios",
    "seller did not ship": "Loja não enviou",
    "seller didn't ship": "Loja não enviou",
    "delivery failed": "Entrega falhou",
    "logistics issue": "Problema na entrega",
    "pricing error": "Erro de preço",
    "unable to deliver": "Não foi possível entregar",
}


def _pt(motivo: str) -> str:
    return MOTIVOS_PT.get(motivo.strip().lower(), motivo)


def _autor(c: dict) -> str:
    for k in ("cancel_initiator", "cancel_user", "initiator", "cancel_role", "role", "cancel_type"):
        v = str(c.get(k) or "").upper()
        if v in AUTOR:
            return AUTOR[v]
        if v.startswith("BUYER"):
            return "Comprador"
        if v.startswith("SELLER"):
            return "Loja"
    return "Plataforma"


def janela(dias: int, hoje: date) -> tuple[date, date]:
    """Dias fechados ate' ontem (mesma regra das outras abas de CX)."""
    fim = hoje - timedelta(days=1)
    return fim - timedelta(days=dias - 1), fim


def _ts(d: date, fim: bool = False) -> int:
    dt = datetime.combine(d + timedelta(days=1) if fim else d, dtime.min, tzinfo=TZ)
    return int(dt.timestamp())


def _valor(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _itens(linhas) -> list[dict]:
    out = []
    for li in linhas or []:
        out.append({"sku": li.get("seller_sku") or li.get("sku_id"), "produto": li.get("product_name")})
    return out


def coletar_marca(cli: Cliente, ini: int, fim: int) -> dict:
    corpo = {"create_time_ge": ini, "create_time_lt": fim}
    devs, t1 = cli.paginar("/return_refund/202309/returns/search", corpo, "return_orders", page_size=50, max_paginas=200)
    cans, t2 = cli.paginar("/return_refund/202309/cancellations/search", corpo, "cancellations", page_size=50, max_paginas=200)
    # pedido de devolucao que o proprio comprador desistiu nao e' problema (mesma regra da Shopee)
    devs = [d for d in devs if "CANCEL" not in str(d.get("return_status") or "").upper()]
    texto = lambda x, *ks: next((x.get(k) for k in ks if x.get(k)), None) or "Sem motivo informado"  # noqa: E731
    nao_pagos = [c for c in cans if texto(c, "cancel_reason_text", "cancel_reason").strip().lower() in NAO_PAGO]
    cans = [c for c in cans if c not in nao_pagos]
    return {
        "nao_pagos": len(nao_pagos),
        "devolucoes": [{
            "motivo": _pt(texto(d, "return_reason_text", "return_reason")),
            "tipo": d.get("return_type"), "status": d.get("return_status"),
            "valor": _valor((d.get("refund_amount") or {}).get("refund_total")),
            "itens": _itens(d.get("return_line_items")),
        } for d in devs],
        "cancelamentos": [{
            "motivo": _pt(texto(c, "cancel_reason_text", "cancel_reason")),
            "autor": _autor(c),
            "status": c.get("cancel_status"),
            "itens": _itens(c.get("cancel_line_items")),
        } for c in cans],
        "truncado": t1 or t2,
    }


def _cliente_da_marca(conta: str, tok: str, criar: Callable[..., Cliente]) -> Cliente:
    if conta not in _cipher:
        lojas = criar(tok).lojas()
        if not lojas:
            raise TikTokErro("Token sem loja autorizada.")
        _cipher[conta] = lojas[0].get("cipher")
    return criar(tok, _cipher[conta])


# --- Cache POR DIA e por marca (agregado compacto, nao os registros) ---------------------------
#: Dia fechado quase nao muda: 6 h. Os ultimos `RECENTES` dias ainda recebem devolucao: 10 min.
TTL_RECENTE, TTL_FECHADO, RECENTES = 600, 6 * 3600, 3
#: Chamadas simultaneas ao TikTok (dias x marcas em paralelo).
PARALELO = 4  # Render Free tem 0,1 CPU: mais que isso trava o /health
_uma_leitura = threading.Lock()  # um periodo por vez (rotina e tela nao leem o mesmo dia juntas)
_dias: dict[tuple[str, date], tuple[float, dict]] = {}


def resumir(c: dict) -> dict:
    """Saida de `coletar_marca` (um dia) -> agregado: contagens, motivos, autores, SKUs."""
    motivos, skus = Counter(), Counter()
    autores: dict[tuple, Counter] = defaultdict(Counter)
    nomes: dict[str, str] = {}
    for tipo, lista in (("Devolução", c["devolucoes"]), ("Cancelamento", c["cancelamentos"])):
        for x in lista:
            k = (tipo, x["motivo"])
            motivos[k] += 1
            if tipo == "Cancelamento":
                autores[k][x["autor"]] += 1
            for it in x["itens"]:
                if it["sku"]:
                    skus[(tipo, x["motivo"], it["sku"])] += 1
                    nomes[it["sku"]] = it["produto"] or nomes.get(it["sku"]) or it["sku"]
    return {"devolucoes": len(c["devolucoes"]), "reembolsado": sum(x["valor"] for x in c["devolucoes"]),
            "cancelamentos": len(c["cancelamentos"]), "nao_pagos": c["nao_pagos"],
            "comprador": sum(1 for x in c["cancelamentos"] if x["autor"] == "Comprador"),
            "motivos": motivos, "autores": autores, "skus": skus, "nomes": nomes, "truncado": c["truncado"]}


def _fresco(chave: tuple[str, date], hoje: date, agora: float) -> bool:
    hit = _dias.get(chave)
    if not hit:
        return False
    ttl = TTL_RECENTE if (hoje - chave[1]).days <= RECENTES else TTL_FECHADO
    return agora - hit[0] < ttl


def _estado_erro(e: Exception) -> dict:
    if isinstance(e, tiktok_token.TikTokIndisponivel):
        return {"estado": "nao_autorizada", "motivo": str(e)}
    sem = getattr(e, "codigo", None) in (105005, 105002, 106011)  # escopo/permissao do app
    return {"estado": "sem_permissao" if sem else "erro",
            "motivo": "O app da Torre não tem permissão de devoluções/cancelamentos nesta loja." if sem else str(e)}


def montar(dias: int, contas: list[str], obter_token: Callable[[str], str],
           criar: Callable[..., Cliente] = Cliente, hoje: Optional[date] = None) -> dict:
    hoje = hoje or datetime.now(TZ).date()
    ini, fim = janela(dias, hoje)
    datas = [ini + timedelta(days=i) for i in range(dias)]

    # tokens e lojas em sequencia (a sessao do banco nao e' thread-safe)
    clientes: dict[str, Cliente] = {}
    falha: dict[str, dict] = {}
    for c in contas:
        try:
            clientes[c] = _cliente_da_marca(c, obter_token(c), criar)
        except (tiktok_token.TikTokIndisponivel, TikTokErro) as e:
            falha[c] = _estado_erro(e)

    # so' os dias que faltam (ou venceram) vao ao TikTok, em paralelo
    agora = time.time()
    tarefas = [(c, d) for c in clientes for d in datas if not _fresco((c, d), hoje, agora)]

    def uma(t: tuple[str, date]):
        c, d = t
        try:
            ag = resumir(coletar_marca(clientes[c], _ts(d), _ts(d, fim=True)))
            with _trava:
                _dias[t] = (time.time(), ag)
            return t, None
        except TikTokErro as e:
            return t, e

    with ThreadPoolExecutor(max_workers=PARALELO) as ex:
        for (c, _), e in ex.map(uma, tarefas):
            if e is not None and c not in falha:
                falha[c] = _estado_erro(e)

    marcas, motivos = [], Counter()
    autores: dict[tuple, Counter] = defaultdict(Counter)
    por_motivo_marca: dict[tuple, Counter] = defaultdict(Counter)
    por_motivo_sku: dict[tuple, Counter] = defaultdict(Counter)
    nome_sku: dict[str, str] = {}
    for conta in contas:
        dias_ag = [_dias.get((conta, d)) for d in datas]
        faltam = sum(1 for x in dias_ag if x is None)
        if faltam == len(datas) and conta in falha:  # nenhum dia lido: a marca vem com o motivo
            marcas.append({"marca": conta, **falha[conta]})
            continue
        ags = [x[1] for x in dias_ag if x]
        # dia que falhou (limite do TikTok) entra na proxima rodada; ate' la' a marca e' parcial
        marcas.append({"marca": conta, "estado": "dado", "motivo": None, "dias_faltando": faltam,
                       "truncado": faltam > 0 or any(a["truncado"] for a in ags),
                       "devolucoes": sum(a["devolucoes"] for a in ags),
                       "reembolsado": round(sum(a["reembolsado"] for a in ags), 2),
                       "cancelamentos": sum(a["cancelamentos"] for a in ags),
                       "nao_pagos": sum(a["nao_pagos"] for a in ags),
                       "cancelamentos_comprador": sum(a["comprador"] for a in ags)})
        for a in ags:
            for k, n in a["motivos"].items():
                motivos[k] += n
                por_motivo_marca[k][conta] += n
            for k, cnt in a["autores"].items():
                autores[k].update(cnt)
            for (tipo, motivo, sku), n in a["skus"].items():
                por_motivo_sku[(tipo, motivo)][(conta, sku)] += n
            nome_sku.update(a["nomes"])

    itens = []
    for (tipo, motivo), n in motivos.most_common():
        k = (tipo, motivo)
        itens.append({
            "tipo": tipo, "motivo": motivo, "quantidade": n,
            "autor": autores[k].most_common(1)[0][0] if autores[k] else None,
            "marcas": [{"marca": m, "quantidade": q} for m, q in por_motivo_marca[k].most_common()],
            "skus": [{"marca": m, "sku": s, "produto": nome_sku.get(s), "quantidade": q}
                     for (m, s), q in por_motivo_sku[k].most_common(30)],
        })
    return {"gerado_em": datetime.now(timezone.utc).isoformat(), "dias": dias,
            "inicio": ini.isoformat(), "fim": fim.isoformat(), "marcas": marcas, "motivos": itens}


def iniciar_rotina(intervalo_s: int = 540) -> None:
    """Startup da API: le os ultimos 30 dias logo ao subir e a cada ~9 min, antes de alguem abrir a tela.
    Como o cache e' por dia, 7 dias sai do mesmo cache; 90 dias so' busca os dias que faltam."""
    from app.config import settings

    if not settings.tiktok_app_key:
        return

    def laco() -> None:
        time.sleep(30)
        while True:
            for d in (30,):  # 7 dias sai do mesmo cache; 90 so' quando alguem pede
                with _trava:
                    livre = d not in _rodando
                    if livre:
                        _rodando.add(d)
                if livre:
                    _atualizar(d)
            time.sleep(intervalo_s)

    threading.Thread(target=laco, name="tiktok-cx-rotina", daemon=True).start()


_rodando: set[int] = set()


def _atualizar(dias: int) -> None:
    """Le o TikTok inteiro da janela em segundo plano (sessao propria) e guarda no cache."""
    from sqlalchemy import text

    from app.database import SessionLocal

    try:
        with _uma_leitura, SessionLocal() as db:
            todas = [r[0] for r in db.execute(text("SELECT conta FROM audit.tiktok_oauth_token ORDER BY conta")).all()]
            db.rollback()
            armazem = tiktok_token.ArmazemPg(db)
            dados = montar(dias, todas, lambda c: tiktok_token.obter_access_token(armazem, c))
        with _trava:
            _cache[dias] = (time.time(), dados)
    except Exception:  # noqa: BLE001 -- falha fica no log; a tela segue com o cache anterior
        logger.exception("cx tiktok: leitura da janela %s falhou", dias)
    finally:
        with _trava:
            _rodando.discard(dias)


def obter(dias: int, contas: Optional[list[str]] = None, iniciar: Callable[[int], None] | None = None) -> dict:
    """Nunca espera o TikTok: cache fresco volta direto; vencido volta e atualiza por tras;
    sem cache, dispara a leitura e devolve `carregando=True` (a tela pergunta de novo)."""
    agora = time.time()
    with _trava:
        hit = _cache.get(dias)
        precisa = (not hit or agora - hit[0] > CACHE_S) and dias not in _rodando
        if precisa:
            _rodando.add(dias)
    if precisa:
        (iniciar or (lambda d: threading.Thread(target=_atualizar, args=(d,), daemon=True).start()))(dias)
    if not hit:
        return {"carregando": True, "dias": dias, "marcas": [], "motivos": []}
    dados = hit[1]
    return _filtrar(dados, contas) if contas else dados


def _filtrar(d: dict, contas: list[str]) -> dict:
    motivos = []
    for m in d["motivos"]:
        marcas = [x for x in m["marcas"] if x["marca"] in contas]
        if marcas:
            motivos.append({**m, "quantidade": sum(x["quantidade"] for x in marcas), "marcas": marcas,
                            "skus": [s for s in m["skus"] if s["marca"] in contas]})
    motivos.sort(key=lambda m: -m["quantidade"])
    return {**d, "marcas": [x for x in d["marcas"] if x["marca"] in contas], "motivos": motivos}
