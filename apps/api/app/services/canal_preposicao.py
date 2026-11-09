"""Preposicao certa antes do nome do canal -- par do `noCanal` do front
(`apps/web/src/lib/canal-preposicao.ts`).

"no Shopee" e' agramatical: a Shopee e' feminina; o Mercado Livre e o
TikTok Shop, masculinos. O genero vem do ID do canal, nao do rotulo, e vale
para os dois esquemas de ID da API ("ml"/"mercadolivre", "tiktok"/
"tiktokshop"): so' a Shopee e' feminina.
"""
from __future__ import annotations

_FEMININOS = frozenset({"shopee"})


def no_canal(canal: str, rotulo: str) -> str:
    """"no Mercado Livre", "na Shopee", "no TikTok Shop"."""
    return f"{'na' if canal in _FEMININOS else 'no'} {rotulo}"


def do_canal(canal: str, rotulo: str) -> str:
    """"do Mercado Livre", "da Shopee", "do TikTok Shop"."""
    return f"{'da' if canal in _FEMININOS else 'do'} {rotulo}"
