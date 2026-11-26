"""ADS-SHOPEE-API-1: Investimento em Ads da Shopee pela API (raw.shopee_ads_daily). Sem banco nem rede."""
from __future__ import annotations

import contextlib
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from pipelines import sync_shopee_ads_api as A
from pipelines.transforms.shopee_orders_daily import BRAND_TO_LOJA

AGORA = datetime(2026, 11, 25, 15, 0, tzinfo=timezone.utc)   # 12:00 BRT de 25/11
KOK, BAR = BRAND_TO_LOJA["kokeshi"], BRAND_TO_LOJA["barbours"]


def _fonte(brand, dia, cost, receita=Decimal("0"), cliques=0, impressoes=0):
    return {"brand": brand, "ref_date": dia, "cost": Decimal(str(cost)), "broad_amount": Decimal(str(receita)),
            "clicks": cliques, "impressions": impressoes, "extracted_at": AGORA}


def test_linha_da_fato_com_as_formulas_do_relatorio_e_divisor_zero_nulo():
    r = A.linha_da_fato(_fonte("kokeshi", date(2026, 11, 10), "100.50", "402", 50, 1000))
    assert r == {"date": date(2026, 11, 10), "loja_id": KOK, "ad_spend": 100.5, "ad_revenue": 402.0,
                 "ad_impressions": 1000, "ad_clicks": 50, "roas": 4.0, "acos_pct": 25.0, "ctr_pct": 5.0, "cpc": 2.01}
    zero = A.linha_da_fato(_fonte("kokeshi", date(2026, 11, 11), 0))
    assert zero["ad_spend"] == 0.0 and (zero["roas"], zero["acos_pct"], zero["ctr_pct"], zero["cpc"]) == (None,) * 4


def test_so_grava_o_que_mudou():
    l1 = A.linha_da_fato(_fonte("kokeshi", date(2026, 11, 10), 10, 40, 5, 100))
    l2 = A.linha_da_fato(_fonte("kokeshi", date(2026, 11, 11), 20, 40, 5, 100))
    antes = {(l1["date"], KOK): dict(l1), (l2["date"], KOK): {**l2, "ad_spend": None}}
    assert A.a_gravar(antes, [l1, l2]) == [l2]


def test_comparacao_por_mes_e_aviso_quando_a_api_fica_abaixo():
    antes = {(date(2026, 10, d), KOK): {"ad_spend": 100.0} for d in (1, 2)}
    antes[(date(2026, 10, 3), BAR)] = {"ad_spend": None}               # sem dado nao conta
    linhas = [A.linha_da_fato(_fonte("kokeshi", date(2026, 10, d), 90)) for d in (1, 2)]
    linhas.append(A.linha_da_fato(_fonte("barbours", date(2026, 10, 3), 50)))
    comp = A.comparar_por_mes(antes, linhas)
    kok = next(c for c in comp if c["loja_id"] == KOK)
    assert (kok["publicado"], kok["api"], kok["dias_publicado"], kok["dias_api"]) == (200.0, 180.0, 2, 2)
    avisos = A.avisos_de_queda(comp)
    assert len(avisos) == 1 and f"loja {KOK} 2026-10" in avisos[0]     # barbours sem publicado: sem aviso


class _Conn:
    def __init__(self, antes):
        self.antes, self.gravado = antes, []

    def execute(self, sql, params=None):
        self.gravado += params or []
        for r in params or []:
            self.antes[(r["date"], r["loja_id"])] = dict(r)


def test_dry_run_compara_e_nao_escreve(monkeypatch):
    fonte = [_fonte("kokeshi", date(2026, 11, 23), 1000, 4000, 10, 100)]
    monkeypatch.setattr(A, "coletar_fonte", lambda i, f: fonte)
    monkeypatch.setattr(A, "publicado", lambda conn, i, f: {})
    monkeypatch.setattr(A, "local_engine", lambda: type("E", (), {"connect": lambda s: contextlib.nullcontext(None)})())
    res = A.run(apply=True, agora=AGORA, ambiente={})                 # sem a flag: dry-run declarado
    assert res["modo"].startswith("dry-run") and res["janela"] == ["2026-09-26", "2026-11-24"]
    assert res["linhas_que_mudariam"] == 1 and not res["aplicado"]
    assert any("apice: sem nenhum dia na API" in a for a in res["avisos"])


def test_apply_grava_reconcilia_e_e_idempotente(monkeypatch):
    fonte = [_fonte("kokeshi", date(2026, 11, 23), 1000, 4000, 10, 100)]
    antes: dict = {}
    conn = _Conn(antes)
    monkeypatch.setattr(A, "coletar_fonte", lambda i, f: fonte)
    monkeypatch.setattr(A, "publicado", lambda c, i, f: dict(antes))
    monkeypatch.setattr(A, "local_engine", lambda: type("E", (), {"begin": lambda s: contextlib.nullcontext(conn)})())
    monkeypatch.setattr(A, "fato_diaria_lock", lambda *a, **k: contextlib.nullcontext())
    res = A.run(apply=True, desde=date(2026, 10, 1), agora=AGORA, ambiente={A.FLAG_HABILITADO: "true"})
    assert res["linhas_gravadas"] == 1 and res["janela"] == ["2026-10-01", "2026-11-24"]
    assert conn.gravado[0]["ad_spend"] == 1000.0 and conn.gravado[0]["marketplace_id"] == 3
    again = A.run(apply=True, desde=date(2026, 10, 1), agora=AGORA, ambiente={A.FLAG_HABILITADO: "true"})
    assert again["linhas_gravadas"] == 0 and not again["aplicado"]


def test_desde_depois_de_ontem_e_erro():
    with pytest.raises(A.ShopeeAdsApiError):
        A.run(desde=date(2026, 11, 25), agora=AGORA, ambiente={})
