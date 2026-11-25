"""Diagnostico do Bling da Denavita: de onde vem (e onde parou) a Shopee dela.

Mostra, sem token e sem dado pessoal:
  - os canais de venda (`/canais-venda`: id, tipo, descricao, situacao) e a plataforma que `_plataforma_do_canal` deu;
  - o mapa de lojas que a Torre usa hoje (so' ML e Shopee);
  - os pedidos do periodo contados por LOJA e por semana, lendo a lista SEM o filtro de loja: uma loja Shopee nova,
    recriada ou com outro nome aparece aqui mesmo fora do mapa.
Do pedido le' so' a data, o total e o id da loja. Nome, contato e itens nunca sao lidos nem devolvidos.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from app.services import marcas_menores_service as svc
from app.services.bling_client import BlingCliente
from app.services.bling_token import BlingIndisponivel

MAX_DIAS = 120


def _texto(v, n: int = 80) -> Optional[str]:
    if v is None:
        return None
    t = " ".join(str(v).split())
    return t[:n] if t else None


def _semana(d: date) -> str:
    """Segunda-feira da semana de `d` (AAAA-MM-DD)."""
    return (d - timedelta(days=d.weekday())).isoformat()


def listar_todos(cli: BlingCliente, inicio: date, fim: date) -> tuple[list[dict], bool]:
    """Pedidos da janela de TODAS as lojas: {loja_id, data, total}. `truncado` = bateu no teto de paginas."""
    saida: list[dict] = []
    cheio = False
    for pagina in range(1, svc.MAX_PAGINAS + 1):
        data = cli.get(
            "/pedidos/vendas",
            {"dataInicial": inicio.isoformat(), "dataFinal": fim.isoformat(), "limite": svc.LIMITE, "pagina": pagina},
        ).get("data") or []
        for p in data:
            try:
                loja = (p.get("loja") or {}).get("id")
                saida.append({
                    "loja_id": int(loja) if loja is not None and str(loja).isdigit() else None,
                    "data": date.fromisoformat(str(p["data"])[:10]),
                    "total": float(p["total"]),
                })
            except (KeyError, TypeError, ValueError):
                continue  # pedido sem data ou sem total = sem dado
        cheio = len(data) >= svc.LIMITE
        if not cheio:
            break
    return saida, cheio


def diagnosticar(cli: BlingCliente, de: date, ate: date) -> dict:
    canais = [c for c in (cli.get("/canais-venda").get("data") or []) if isinstance(c, dict)]
    por_id = {}
    canais_out = []
    for c in canais:
        id_ = int(c["id"]) if str(c.get("id", "")).isdigit() else None
        out = {
            "id": id_, "tipo": _texto(c.get("tipo")), "descricao": _texto(c.get("descricao")),
            "situacao": _texto(c.get("situacao")), "plataforma": svc._plataforma_do_canal(c),
        }
        canais_out.append(out)
        if id_ is not None:
            por_id[id_] = out
    try:
        mapa = svc.lojas_denavita(cli, None, atualizar=True)
        erro_mapa = None
    except BlingIndisponivel as exc:
        mapa, erro_mapa = {}, str(exc)

    pedidos, truncado = listar_todos(cli, de, ate)
    lojas: dict[Optional[int], dict] = {}

    def _loja(k: Optional[int]) -> dict:
        return lojas.setdefault(k, {"pedidos": 0, "valor": 0.0, "por_semana": {}, "ultimo_pedido": None})

    for k in list(por_id) + list(mapa):  # lojas conhecidas aparecem mesmo sem pedido (0, nao ausente)
        _loja(k)
    for p in pedidos:
        l = _loja(p["loja_id"])
        l["pedidos"] += 1
        l["valor"] += p["total"]
        sem = _semana(p["data"])
        l["por_semana"][sem] = l["por_semana"].get(sem, 0) + 1
        if l["ultimo_pedido"] is None or p["data"].isoformat() > l["ultimo_pedido"]:
            l["ultimo_pedido"] = p["data"].isoformat()
    semanas = sorted({_semana(de + timedelta(days=i)) for i in range((ate - de).days + 1)})

    lojas_out = []
    for k in sorted(lojas, key=lambda x: (x is None, x or 0)):
        l, canal = lojas[k], por_id.get(k) if k is not None else None
        lojas_out.append({
            "loja_id": k,
            "canal": {"tipo": canal["tipo"], "descricao": canal["descricao"], "situacao": canal["situacao"]} if canal else None,
            "no_mapa": k in mapa,
            "plataforma": mapa.get(k) if k is not None else None,
            "pedidos": l["pedidos"],
            "valor": round(l["valor"], 2),
            "ultimo_pedido": l["ultimo_pedido"],
            "por_semana": [{"semana": s, "pedidos": l["por_semana"].get(s, 0)} for s in semanas],
        })
    return {
        "periodo": {"de": de.isoformat(), "ate": ate.isoformat()},
        "canais": canais_out,
        "mapa_atual": {str(k): v for k, v in sorted(mapa.items())},
        "erro_mapa": erro_mapa,
        "lojas": lojas_out,
        # Loja com pedido e FORA do mapa: e' ai' que uma Shopee nova ou renomeada costuma aparecer.
        "fora_do_mapa": [x["loja_id"] for x in lojas_out if not x["no_mapa"] and x["pedidos"] > 0],
        "pedidos_lidos": len(pedidos),
        "truncado": truncado,
    }
