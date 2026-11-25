"""Marcas menores > Produtos: itens da Denavita pelo Bling DELA (ML e Shopee). Tudo com dubles, sem rede."""
from __future__ import annotations

from datetime import date

import pytest

from app.routers import marcas_menores as rota_mm
from app.services import marcas_menores_service as svc
from app.services.bling_token import BlingIndisponivel
from tests.test_bling_cache import FakeCache
from tests.test_bling_denavita import (
    CANCELADO_DEN, DEN_ML, DEN_SHOPEE, DEN_TIKTOK, FakeBlingDenavita,
)
from tests.test_marcas_menores import YENZAH_SHOPEE, FakeBling, pedido

HOJE = date(2026, 11, 16)
INI, FIM = date(2026, 11, 1), date(2026, 11, 15)


def item(codigo, qtd, valor, desc=None):
    return {"codigo": codigo, "descricao": f"Produto {codigo}", "quantidade": qtd, "valor": valor, **({"desconto": desc} if desc else {})}


#: O MESMO id (11) existe nas duas contas, com itens diferentes: o id so' vale dentro da conta.
RIT = {YENZAH_SHOPEE: [pedido(11, "2026-11-08", 100.0), pedido(12, "2026-11-09", 50.0)]}
RIT_ITENS = {11: [item("RIT-A", 2, 50.0)], 12: [item("RIT-B", 1, 50.0)]}
DEN = {
    DEN_ML: [pedido(11, "2026-11-03", 200.0), pedido(13, "2026-11-04", 999.0, CANCELADO_DEN)],
    DEN_SHOPEE: [pedido(14, "2026-11-05", 30.0)],
    DEN_TIKTOK: [pedido(15, "2026-11-05", 5000.0)],  # TikTok do Bling nunca entra: o dela vem do Data Mart
}
DEN_ITENS = {
    11: [item("DEN-X", 4, 50.0, 10.0)],
    14: [item("DEN-Y", 1, 30.0)],
    13: [item("DEN-CANCELADO", 1, 999.0)],
    15: [item("DEN-TIKTOK", 1, 5000.0)],
}


@pytest.fixture(autouse=True)
def _limpo():
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def _produtos(den=None, rit=None, **kw):
    rit_cli = rit or FakeBling(RIT, RIT_ITENS)
    den_cli = den if den is not None else FakeBlingDenavita(DEN, DEN_ITENS)
    return svc.get_produtos(rit_cli, INI, FIM, HOJE, cli_denavita=den_cli, **kw), rit_cli, den_cli


def _marcas(r):
    return {m["id"]: m for m in r["marcas"]}


def _detalhes(fake):
    return [c for c, _ in fake.chamadas if c.startswith("/pedidos/vendas/")]


def test_com_token_ml_e_shopee_da_denavita_tem_itens_sem_cancelado_e_sem_tiktok():
    r, _, den_cli = _produtos()
    d = _marcas(r)["denavita"]
    assert d["status"] == "ok"
    skus = {p["sku"]: p for p in d["produtos"]}
    assert set(skus) == {"DEN-X", "DEN-Y"}, "cancelado e TikTok do Bling ficam fora"
    assert skus["DEN-X"]["quantidade"] == 4.0 and skus["DEN-X"]["receita"] == 190.0  # 4*50 - 10
    assert {(p["plataforma"], p["sku"]) for p in d["itens_por_canal"]} == {("MELI", "DEN-X"), ("SHOPEE", "DEN-Y")}
    assert d["receita_itens"] == 220.0 and d["gmv_pedidos"] == 230.0
    assert sorted(_detalhes(den_cli)) == ["/pedidos/vendas/11", "/pedidos/vendas/14"]
    assert r["completo"] is True and r["pedidos_total"] == 4 and r["pedidos_lidos"] == 4


def test_tiktok_da_denavita_segue_sem_itens_com_motivo_curto_e_nunca_zero():
    r, *_ = _produtos()
    d = _marcas(r)["denavita"]
    assert d["motivo"] == "TikTok sem itens: o Data Mart só traz o total do dia."
    assert all(p["plataforma"] != "TIKTOK" for p in d["itens_por_canal"])
    # so' TikTok no recorte: nenhum item, motivo, e o Bling da Denavita nem e' lido
    r2, _, den_cli = _produtos(plataformas=["TIKTOK"])
    d2 = _marcas(r2)["denavita"]
    assert d2["produtos"] == [] and d2["receita_itens"] is None and d2["gmv_pedidos"] is None
    assert d2["motivo"].startswith("TikTok sem itens")
    assert den_cli.chamadas == []
    # ML e Shopee no recorte, sem TikTok: nada a explicar
    r3, *_ = _produtos(plataformas=["MELI"])
    d3 = _marcas(r3)["denavita"]
    assert d3["motivo"] is None and {p["sku"] for p in d3["produtos"]} == {"DEN-X"}


def test_filtros_de_canal_e_marca_valem_para_a_denavita():
    r, _, den_cli = _produtos(plataformas=["SHOPEE"])
    assert {p["sku"] for p in _marcas(r)["denavita"]["produtos"]} == {"DEN-Y"}
    assert _detalhes(den_cli) == ["/pedidos/vendas/14"], "pedido de canal fora do recorte nem e' lido"
    r2, _, den2 = _produtos(marcas=["yenzah"])
    assert _marcas(r2)["denavita"]["produtos"] == [] and _detalhes(den2) == []
    assert {p["sku"] for p in _marcas(r2)["yenzah"]["produtos"]} == {"RIT-A", "RIT-B"}


def test_sem_token_comportamento_atual_com_motivo_correto():
    r = svc.get_produtos(FakeBling(RIT, RIT_ITENS), INI, FIM, HOJE)
    d = _marcas(r)["denavita"]
    assert d["status"] == "aguardando_autorizacao" and d["produtos"] == [] and d["receita_itens"] is None
    assert d["motivo"] == "Bling da Denavita sem autorização."
    assert {p["sku"] for p in _marcas(r)["yenzah"]["produtos"]} == {"RIT-A", "RIT-B"}
    # a rota manda o motivo exato (sem credencial, sem token, banco fora)
    r2 = svc.get_produtos(
        FakeBling(RIT, RIT_ITENS), INI, FIM, HOJE,
        motivo_sem_bling_denavita="Bling da Denavita: conta ainda sem autorização (sem token gravado).",
    )
    assert _marcas(r2)["denavita"]["motivo"] == "Bling da Denavita: conta ainda sem autorização (sem token gravado)."


def test_mesmo_id_de_pedido_em_duas_contas_nao_colide():
    r, rit_cli, den_cli = _produtos()
    m = _marcas(r)
    assert {p["sku"] for p in m["yenzah"]["produtos"]} == {"RIT-A", "RIT-B"}
    assert {p["sku"] for p in m["denavita"]["produtos"]} == {"DEN-X", "DEN-Y"}
    assert "/pedidos/vendas/11" in _detalhes(rit_cli) and "/pedidos/vendas/11" in _detalhes(den_cli), "cada conta le o seu"
    assert len([k for k in svc._detalhe_cache if k[1] == 11]) == 2
    # 2a leitura: tudo vem da memoria, nenhuma conta chama o Bling de novo
    r2, rit2, den2 = _produtos(rit=FakeBling(RIT, RIT_ITENS), den=FakeBlingDenavita(DEN, DEN_ITENS))
    assert _detalhes(rit2) == [] and _detalhes(den2) == []
    assert {p["sku"] for p in _marcas(r2)["denavita"]["produtos"]} == {"DEN-X", "DEN-Y"}


def test_cache_do_banco_so_guarda_itens_da_rituaria(monkeypatch):
    """`audit.bling_pedido_itens` tem o id do pedido como chave unica: itens da Denavita nunca vao para la'."""
    monkeypatch.setattr(svc.settings, "bling_warm_enabled", False)  # leitura ao vivo: a Rituaria grava no cache
    cache = FakeCache()
    r, *_ = _produtos(cache=cache)
    assert set(cache.itens_) == {11, 12}, "so' os da Rituaria"
    assert cache.itens_[11][0]["codigo"] == "RIT-A", "o id 11 do banco e' o da Rituaria, nao o da Denavita"
    assert {p["sku"] for p in _marcas(r)["denavita"]["produtos"]} == {"DEN-X", "DEN-Y"}


def test_denavita_le_ao_vivo_mesmo_com_a_rotina_ligada(monkeypatch):
    """A rotina de aquecimento so' conhece as lojas da Rituaria; sem leitura ao vivo a Denavita nunca encheria."""
    monkeypatch.setattr(svc.settings, "bling_warm_enabled", True)
    cache = FakeCache()
    r, rit_cli, den_cli = _produtos(cache=cache)
    assert _detalhes(rit_cli) == [], "Rituaria: so' do banco/rotina"
    assert sorted(_detalhes(den_cli)) == ["/pedidos/vendas/11", "/pedidos/vendas/14"]
    assert {p["sku"] for p in _marcas(r)["denavita"]["produtos"]} == {"DEN-X", "DEN-Y"}


def test_mesmo_limite_por_partes_e_progresso():
    r1, _, den_cli = _produtos(limite_detalhes=1)
    assert r1["completo"] is False and r1["pedidos_total"] == 4 and r1["pedidos_lidos"] == 1
    r2, *_ = _produtos(limite_detalhes=1)  # mesma memoria; 1 por vez
    assert r2["pedidos_lidos"] == 1 + 1
    for _ in range(4):
        r, *_ = _produtos(limite_detalhes=1)
    assert r["completo"] is True and r["pedidos_lidos"] == 4


def test_bling_da_denavita_fora_nao_derruba_as_outras_marcas():
    class Fora(FakeBlingDenavita):
        def get(self, caminho, params=None):
            if caminho == "/canais-venda":
                raise BlingIndisponivel("Bling da Denavita recusou o token.")
            return super().get(caminho, params)

    r, *_ = _produtos(den=Fora(DEN, DEN_ITENS))
    m = _marcas(r)
    assert r["disponivel"] is True
    assert m["denavita"]["status"] == "fonte_indisponivel" and m["denavita"]["produtos"] == []
    assert m["denavita"]["motivo"] == "Bling da Denavita: Bling da Denavita recusou o token."
    assert {p["sku"] for p in m["yenzah"]["produtos"]} == {"RIT-A", "RIT-B"}


def test_rota_passa_o_cliente_e_o_motivo_da_denavita(monkeypatch):
    visto = {}
    monkeypatch.setattr(rota_mm, "cliente_bling", lambda db: "cli-rituaria")
    monkeypatch.setattr(rota_mm, "cache_bling", lambda db: None)
    monkeypatch.setattr(rota_mm, "bling_denavita", lambda db: (None, "Bling da Denavita: app sem credencial na API."))
    monkeypatch.setattr(rota_mm.svc, "get_produtos", lambda *a, **kw: visto.update(kw) or {"disponivel": True, "completo": True, "pedidos_total": 0, "pedidos_lidos": 0, "marcas": []})
    rota_mm.marcas_menores_produtos(date_from=INI, date_to=FIM, canais=None, marcas=None, db=None)
    assert visto["cli_denavita"] is None
    assert visto["motivo_sem_bling_denavita"] == "Bling da Denavita: app sem credencial na API."
    monkeypatch.setattr(rota_mm, "bling_denavita", lambda db: ("cli-den", None))
    rota_mm.marcas_menores_produtos(date_from=INI, date_to=FIM, canais=None, marcas=None, db=None)
    assert visto["cli_denavita"] == "cli-den" and visto["motivo_sem_bling_denavita"] is None
