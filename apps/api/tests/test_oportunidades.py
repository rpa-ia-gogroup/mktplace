"""Oportunidades: mesma regua (R$ em 30 dias), top 3 no geral e por marca, fonte que falha nao derruba."""
from __future__ import annotations

from app.services.oportunidades_service import get_oportunidades

IMPACTO = {
    "ml": {"status": "ok", "itens": [
        {"brand": "barbours", "sku": "BB1", "titulo": "Kiss", "media_diaria_28d": 10.2, "perda_dia": 400.0},
        {"brand": "kokeshi", "sku": "KS1", "titulo": "Gel", "media_diaria_28d": 2, "perda_dia": None},  # sem preco
    ]},
    "shopee": {"status": "ok", "itens": [
        {"brand": "barbours", "sku": "BB2", "titulo": "Roses", "media_diaria_28d": 5, "perda_dia": 100.0, "estoque_vendedor": 0},
    ]},
}
SLOW = {"meta_dias": 120, "skus": [
    {"marca": "kokeshi", "sku": "KS9", "descricao": "Creme", "estoque": 12000, "custo_unitario": 4.0,
     "venda_dia": 40.0, "cobertura_dias": 300, "valor_parado": 48000},
    {"marca": "barbours", "sku": "BB9", "descricao": "Ja na meta", "estoque": 1000, "custo_unitario": 9.0,
     "venda_dia": 20.0, "cobertura_dias": 50, "valor_parado": 9000},  # vende acima do alvo: fora
]}


def test_ranking_na_mesma_regua_e_acao():
    r = get_oportunidades(lambda: IMPACTO, lambda: SLOW)
    assert [(i["sku"], i["valor_30d"]) for i in r["geral"]] == [("BB1", 12000.0), ("KS9", 7200.0), ("BB2", 3000.0)]
    assert r["geral"][0]["acao"].startswith("Repor no Full do Mercado Livre: ~306 un")
    assert "sem estoque no vendedor" in r["geral"][2]["acao"]
    assert r["geral"][1]["acao"] == "Acelerar a venda: de 40 para ~100 pç/dia (promoção, ads ou kit)"
    assert [i["sku"] for i in r["por_marca"]["barbours"]] == ["BB1", "BB2"]
    assert r["fontes_indisponiveis"] == []


def test_filtro_de_marca_e_fonte_fora():
    def quebra():
        raise RuntimeError("datamart fora")
    r = get_oportunidades(lambda: IMPACTO, quebra, brands=["barbours"])
    assert [i["sku"] for i in r["geral"]] == ["BB1", "BB2"]
    assert r["fontes_indisponiveis"] == ["capital_parado"]


def test_report_ganha_secao_de_oportunidades():
    from app.services import torre_report
    linhas = torre_report.linhas_oportunidades([
        {"acao": "Repor no Full da Shopee: ~3.717 un cobrem 30 dias", "titulo": "Geleia Delight", "marca": "barbours", "valor_30d": 99052.0},
    ])
    assert linhas[0].startswith("1. *Repor no Full da Shopee: ~3.717 un cobrem 30 dias* · Geleia Delight (")
    assert "em 30 dias" in linhas[0]
