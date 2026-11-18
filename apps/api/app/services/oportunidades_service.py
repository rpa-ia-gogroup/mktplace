"""OPORTUNIDADES-1 -- top oportunidades de ganho real, com a acao, por marca e no geral.

Junta o que a Torre ja' mede em R$ e poe tudo na mesma regua -- R$ em 30 dias:
- RUPTURA NO FULL (ML e Shopee): venda perdida por dia (media 28d x preco, a
  conta do `full_impacto_service`) x 30. Acao: repor no Full o que cobre 30 dias.
  Brinde e descontinuado ja' saem la' (`fora_da_fila`).
- CAPITAL PARADO (slow moving, regra do Supply): quanto de custo sai do estoque em
  30 dias se o SKU passar a vender o ritmo da meta (estoque / 120 dias), alem do que
  ja' vende. Acao: subir a venda ate' esse ritmo.

Nada e' somado entre itens ou canais: o ranking so' ordena. Fonte que falha nao
derruba a outra; vai em `fontes_indisponiveis`.
"""
from __future__ import annotations

import logging
import math
from typing import Callable, Optional

logger = logging.getLogger(__name__)

DIAS = 30


def _int(v: float) -> str:
    """1234567 -> "1.234.567" (pt-BR)."""
    return f"{v:,.0f}".replace(",", ".")


def _dec(v: float) -> str:
    """69.04 -> "69,0" (pt-BR)."""
    return f"{v:.1f}".replace(".", ",")
CANAL = {"ml": "do Mercado Livre", "shopee": "da Shopee"}


def _ruptura(impacto: dict) -> list[dict]:
    out = []
    for chave in ("ml", "shopee"):
        canal = impacto.get(chave) or {}
        if canal.get("status") != "ok":
            continue
        for i in canal.get("itens") or []:
            perda = i.get("perda_dia")
            if not perda or perda <= 0:
                continue
            media = float(i.get("media_diaria_28d") or 0)
            un = math.ceil(media * DIAS)
            sem_vendedor = i.get("estoque_vendedor") == 0
            acao = (f"Repor no Full {CANAL[chave]}: ~{_int(un)} un cobrem {DIAS} dias"
                    + (" (sem estoque no vendedor: comprar/transferir antes)" if sem_vendedor else ""))
            out.append({
                "tipo": "ruptura_full", "canal": chave, "marca": i.get("brand"), "sku": i.get("sku"),
                "titulo": i.get("titulo") or i.get("sku") or "", "valor_30d": round(perda * DIAS, 2),
                "acao": acao,
                "motivo": f"Sem estoque no Full; vendia {_dec(media)}/dia (R$ {_int(perda)}/dia perdidos)",
            })
    return out


def _slow(slow: dict, meta: int) -> list[dict]:
    out = []
    for s in slow.get("skus") or []:
        estoque, custo = s.get("estoque"), s.get("custo_unitario")
        if not estoque or not custo:
            continue
        alvo = estoque / meta
        extra = alvo - float(s.get("venda_dia") or 0)
        if extra <= 0:
            continue
        cob = s.get("cobertura_dias")
        out.append({
            "tipo": "capital_parado", "canal": None, "marca": s["marca"], "sku": s["sku"],
            "titulo": s.get("descricao") or s["sku"], "valor_30d": round(extra * custo * DIAS, 2),
            "acao": f"Acelerar a venda: de {_int(s.get('venda_dia') or 0)} para ~{_int(math.ceil(alvo))} pç/dia (promoção, ads ou kit)",
            "motivo": (f"{_int(estoque)} pç paradas no Marketplace, {'sem venda' if cob is None else f'{cob:.0f} dias de estoque'}; "
                       f"R$ {_int(s.get('valor_parado') or 0)} a custo"),
        })
    return out


def get_oportunidades(obter_impacto: Callable[[], dict], obter_slow: Callable[[], dict],
                      brands: Optional[list[str]] = None, top: int = 3) -> dict:
    itens, indisponiveis = [], []
    for nome, obter, montar in (("ruptura_full", obter_impacto, _ruptura),
                                ("capital_parado", obter_slow, lambda d: _slow(d, d.get("meta_dias") or 120))):
        try:
            itens += montar(obter())
        except Exception:  # noqa: BLE001 -- uma fonte fora nao derruba a outra
            logger.exception("oportunidades: %s indisponivel", nome)
            indisponiveis.append(nome)
    if brands:
        itens = [i for i in itens if i["marca"] in brands]
    itens.sort(key=lambda i: i["valor_30d"], reverse=True)
    por_marca: dict[str, list[dict]] = {}
    for i in itens:
        lista = por_marca.setdefault(i["marca"], [])
        if len(lista) < top:
            lista.append(i)
    return {"dias": DIAS, "geral": itens[:top], "por_marca": por_marca, "fontes_indisponiveis": indisponiveis}
