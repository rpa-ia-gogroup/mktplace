"""CX do TikTok Shop direto da Open API (app da Torre), por marca.

Para cada marca com token em `audit.tiktok_oauth_token`: devolucoes/reembolsos
(`/return_refund/202309/returns/search`) e cancelamentos (`/cancellations/search`) criados
na janela. Junta por motivo (Pareto) e por marca. Marca sem permissao/erro nao derruba as
outras: vem com `estado` e `motivo`. Cache de 10 min por janela (a API e' lenta e paginada).
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
    devs, t1 = cli.paginar("/return_refund/202309/returns/search", corpo, "return_orders", page_size=100, max_paginas=100)
    cans, t2 = cli.paginar("/return_refund/202309/cancellations/search", corpo, "cancellations", page_size=100, max_paginas=100)
    # pedido de devolucao que o proprio comprador desistiu nao e' problema (mesma regra da Shopee)
    devs = [d for d in devs if "CANCEL" not in str(d.get("return_status") or "").upper()]
    texto = lambda x, *ks: next((x.get(k) for k in ks if x.get(k)), None) or "Sem motivo informado"  # noqa: E731
    nao_pagos = [c for c in cans if texto(c, "cancel_reason_text", "cancel_reason").strip().lower() in NAO_PAGO]
    cans = [c for c in cans if c not in nao_pagos]
    return {
        "nao_pagos": len(nao_pagos),
        # nomes dos campos (sem valores) para conferir o contrato da API
        "campos": {"devolucao": sorted(devs[0])[:40] if devs else [], "cancelamento": sorted(cans[0])[:40] if cans else []},
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


def montar(dias: int, contas: list[str], obter_token: Callable[[str], str],
           criar: Callable[..., Cliente] = Cliente, hoje: Optional[date] = None) -> dict:
    hoje = hoje or datetime.now(TZ).date()
    ini, fim = janela(dias, hoje)

    # tokens em sequencia (a sessao do banco nao e' thread-safe); so' as chamadas ao TikTok vao em paralelo
    tokens: dict[str, object] = {}
    for c in contas:
        try:
            tokens[c] = obter_token(c)
        except tiktok_token.TikTokIndisponivel as e:
            tokens[c] = e

    def uma(conta: str) -> tuple[str, dict]:
        try:
            if isinstance(tokens[conta], Exception):
                raise tokens[conta]
            cli = _cliente_da_marca(conta, tokens[conta], criar)
            return conta, {"estado": "dado", **coletar_marca(cli, _ts(ini), _ts(fim, fim=True))}
        except tiktok_token.TikTokIndisponivel as e:
            return conta, {"estado": "nao_autorizada", "motivo": str(e)}
        except TikTokErro as e:
            sem = e.codigo in (105005, 105002, 106011)  # escopo/permissao do app
            return conta, {"estado": "sem_permissao" if sem else "erro",
                           "motivo": "O app da Torre não tem permissão de devoluções/cancelamentos nesta loja." if sem else str(e)}

    with ThreadPoolExecutor(max_workers=6) as ex:
        por_conta = dict(ex.map(uma, contas))

    marcas, motivos = [], Counter()
    autores: dict[str, Counter] = defaultdict(Counter)
    por_motivo_marca: dict[tuple, Counter] = defaultdict(Counter)
    por_motivo_sku: dict[tuple, Counter] = defaultdict(Counter)
    nome_sku: dict[str, str] = {}
    for conta in contas:
        d = por_conta[conta]
        if d["estado"] != "dado":
            marcas.append({"marca": conta, "estado": d["estado"], "motivo": d.get("motivo")})
            continue
        devs, cans = d["devolucoes"], d["cancelamentos"]
        marcas.append({"marca": conta, "estado": "dado", "motivo": None, "truncado": d["truncado"],
                       "devolucoes": len(devs), "reembolsado": round(sum(x["valor"] for x in devs), 2),
                       "cancelamentos": len(cans), "nao_pagos": d["nao_pagos"], "campos": d["campos"],
                       "cancelamentos_comprador": sum(1 for c in cans if c["autor"] == "Comprador")})
        for tipo, lista in (("Devolução", devs), ("Cancelamento", cans)):
            for x in lista:
                k = (tipo, x["motivo"])
                motivos[k] += 1
                if tipo == "Cancelamento":
                    autores[k][x["autor"]] += 1
                por_motivo_marca[k][conta] += 1
                for it in x["itens"]:
                    if it["sku"]:
                        por_motivo_sku[k][(conta, it["sku"])] += 1
                        nome_sku[it["sku"]] = it["produto"] or nome_sku.get(it["sku"]) or it["sku"]

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


def obter(dias: int, db, contas: Optional[list[str]] = None) -> dict:
    """Com cache de 10 min por janela (todas as contas); `contas` filtra no fim."""
    agora = time.time()
    with _trava:
        hit = _cache.get(dias)
    if not hit or agora - hit[0] > CACHE_S:
        from sqlalchemy import text

        todas = [r[0] for r in db.execute(text("SELECT conta FROM audit.tiktok_oauth_token ORDER BY conta")).all()]
        db.rollback()
        armazem = tiktok_token.ArmazemPg(db)
        dados = montar(dias, todas, lambda c: tiktok_token.obter_access_token(armazem, c))
        with _trava:
            _cache[dias] = (agora, dados)
        hit = (agora, dados)
    dados = hit[1]
    if not contas:
        return dados
    return _filtrar(dados, contas)


def _filtrar(d: dict, contas: list[str]) -> dict:
    motivos = []
    for m in d["motivos"]:
        marcas = [x for x in m["marcas"] if x["marca"] in contas]
        if marcas:
            motivos.append({**m, "quantidade": sum(x["quantidade"] for x in marcas), "marcas": marcas,
                            "skus": [s for s in m["skus"] if s["marca"] in contas]})
    motivos.sort(key=lambda m: -m["quantidade"])
    return {**d, "marcas": [x for x in d["marcas"] if x["marca"] in contas], "motivos": motivos}
