"""T-0090 — DRE sempre com numeros: PREVIA no lugar de NAO_CALCULAVEL.

Decisao do Mario (11/11/2026). O que se prova:
  * mes imaturo (M+2) com receita sai PREVIA, com valores, `fecha_em` e margem;
  * NAO_CALCULAVEL so' quando a receita e' nula;
  * custo parcial entra na margem conhecida (`origem=parcial`,
    `entra_na_margem`, `componentes_parciais`, `aviso`);
  * snapshot vencido / indisponivel nao entra (nunca como zero);
  * agregado: margem = soma das celulas; NAO_CALCULAVEL so' se todas forem;
  * cenario: CMV nao reconciliado extrapolado pela razao coberta, taxa do
    escrow Shopee extrapolada pela fracao de pedidos, recorte misto parcial.

Numeros sinteticos.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.schemas.dre import DREResponse
from app.services import dre_premissas as DP
from app.services import dre_service as dre
from tests.test_dre_mvp import AGORA, HOJE, JUL, _pub, celula, cmv, mart, montar
from tests.test_dre_premissas import prem

AGO = date(2026, 8, 1)


def _montar(mart_rows, insumos, *, premissas=None, inicio=JUL, canais=("ml", "shopee", "tiktok"),
            marcas=("kokeshi", "barbours")):
    leit = None if premissas is None else DP.LeituraPremissas(tabela_existe=True, linhas=list(premissas))
    body = dre.montar_dre(inicio=inicio, fim=dre.ultimo_dia(inicio), canais=list(canais), marcas=list(marcas),
                          mart_rows=list(mart_rows), afiliado_rows=[],
                          insumos=dre.LeituraInsumos(tabela_existe=True, linhas=list(insumos)),
                          hoje=HOJE, agora=AGORA, premissas=leit)
    DREResponse.model_validate(body)  # PREVIA e campos novos passam pelo contrato
    return body


# ---------------------------------------------------------------------------
# Celula
# ---------------------------------------------------------------------------

def test_mes_imaturo_com_receita_e_previa_com_valores_e_fecha_em():
    c = celula("ml", m=mart("ml", mes=AGO), c=cmv("ml", mes=AGO))
    assert c["classificacao"] == dre.PREVIA and c["previa"] is True
    assert c["fecha_em"] == "2026-10-31"  # ultimo dia de M+2
    m = c["margem_contribuicao_conhecida"]
    assert m["valor"] == pytest.approx(1_000_000 - 150_000 - 40_000 - 130_000 - 300_000)
    assert m["componentes_usados"] == ["taxas", "ads", "frete", "cmv"]
    assert any("mes imaturo" in x for x in c["motivos_classificacao"])


def test_mes_maduro_nao_tem_fecha_em():
    c = celula("ml")
    assert c["classificacao"] == dre.PARCIAL and c["previa"] is False and c["fecha_em"] is None


def test_celula_sem_receita_e_nao_calculavel():
    c = celula("ml", m=mart("ml", gmv=None))
    assert c["classificacao"] == dre.NAO_CALCULAVEL and c["fecha_em"] is None
    rec = c["componentes"]["receita"]
    assert rec["valor"] is None and rec["origem"] == "indisponivel"
    m = c["margem_contribuicao_conhecida"]
    assert m["valor"] is None and m["componentes_usados"] == [] and m["aviso"] is None
    assert not any(c["componentes"][n]["entra_na_margem"] for n in dre.COMPONENTES)


def test_parcial_entra_na_margem_com_origem_e_aviso():
    c = celula("ml", m=mart("ml", ads_n=20))
    ads = c["componentes"]["ads"]
    assert (ads["status"], ads["origem"], ads["entra_na_margem"]) == (dre.COBERTURA_PARCIAL, "parcial", True)
    assert ads["cobertura_rotulo"] == "presente em 20 de 31 dias"
    m = c["margem_contribuicao_conhecida"]
    assert m["componentes_parciais"] == ["ads"] and "ads" in m["componentes_usados"]
    assert m["valor"] == pytest.approx(1_000_000 - 150_000 - 40_000 - 130_000 - 300_000)
    assert m["aviso"] == ("Margem conhecida inclui custos parciais (ads); custo não medido não entra, "
                          "então a margem tende a estar acima da real.")
    assert c["completude"] == {"usados": 4, "aplicaveis": 6, "parciais": 1, "texto": "4 de 6 custos (1 parcial)"}
    assert c["componentes"]["taxas"]["origem"] == "realizado"


def test_receita_e_afiliado_nunca_entram_na_margem():
    c = celula("tiktok", m=mart("tiktok"))
    assert c["componentes"]["receita"]["entra_na_margem"] is False
    af = c["componentes"]["afiliados"]
    assert af["origem"] == "realizado" and af["entra_na_margem"] is False


def test_snapshot_vencido_e_indisponivel_nao_entram():
    velho = AGORA - dre.INSUMO_IDADE_MAXIMA - timedelta(minutes=1)
    c = celula("ml", m=mart("ml", fees=None, fees_n=0), c=cmv("ml", publicado_em=velho))
    for nome, status in (("cmv", dre.SNAPSHOT_VENCIDO), ("taxas", dre.INDISPONIVEL)):
        comp = c["componentes"][nome]
        assert (comp["status"], comp["valor"], comp["origem"], comp["entra_na_margem"]) == (
            status, None, "indisponivel", False)
    m = c["margem_contribuicao_conhecida"]
    assert m["valor"] == pytest.approx(1_000_000 - 40_000 - 130_000)
    assert {"taxas", "cmv"} <= set(m["faltam"]) and m["componentes_parciais"] == []
    assert c["classificacao"] == dre.PARCIAL


def test_nao_aplicavel_tem_origem_propria():
    c = celula("ml")
    assert c["componentes"]["afiliados"]["origem"] == "nao_aplicavel"


# ---------------------------------------------------------------------------
# Agregado
# ---------------------------------------------------------------------------

def test_agregado_soma_margens_e_nao_calculavel_so_se_todas():
    res = montar(mart_rows=[mart("ml", "kokeshi"), mart("ml", "barbours", gmv=None)],
                 cmv_rows=[cmv("ml", "kokeshi"), cmv("ml", "barbours")], canais=("ml",))
    tot = res["total"]
    kok = next(c for c in res["celulas_base"] if c["marca"] == "kokeshi")
    assert tot["classificacao"] == dre.PARCIAL
    assert tot["margem_contribuicao_conhecida"]["valor"] == kok["margem_contribuicao_conhecida"]["valor"]
    assert tot["componentes"]["receita"]["valor"] == 1_000_000.0
    assert "2026-07 ml barbours: sem receita" in tot["motivos_classificacao"]

    nada = montar(mart_rows=[mart("ml", "kokeshi", gmv=None)], cmv_rows=[cmv("ml", "kokeshi")],
                  canais=("ml",), marcas=("kokeshi",))
    assert nada["total"]["classificacao"] == dre.NAO_CALCULAVEL
    assert nada["total"]["margem_contribuicao_conhecida"]["valor"] is None
    assert nada["total"]["componentes"]["receita"]["valor"] is None


def test_agregado_previa_e_a_pior_e_leva_o_maior_fecha_em():
    res = montar(mart_rows=[mart("ml", "kokeshi"), mart("ml", "kokeshi", mes=AGO)],
                 cmv_rows=[cmv("ml", "kokeshi"), cmv("ml", "kokeshi", mes=AGO)],
                 canais=("ml",), marcas=("kokeshi",), fim=date(2026, 8, 31))
    tot = res["total"]
    assert tot["classificacao"] == dre.PREVIA and tot["previa"] is True and tot["fecha_em"] == "2026-10-31"
    assert tot["margem_contribuicao_conhecida"]["valor"] == pytest.approx(
        sum(c["margem_contribuicao_conhecida"]["valor"] for c in res["celulas_base"]))
    DREResponse.model_validate(res)


def test_agregado_com_parcial_tem_origem_rotulo_e_aviso():
    res = montar(mart_rows=[mart("ml", "kokeshi"), mart("ml", "barbours", ads_n=10)],
                 cmv_rows=[cmv("ml", "kokeshi"), cmv("ml", "barbours")], canais=("ml",))
    ads = res["total"]["componentes"]["ads"]
    assert (ads["origem"], ads["entra_na_margem"]) == ("parcial", True)
    assert ads["cobertura_rotulo"] == "50,0% da receita com dado realizado, 50,0% com dado parcial"
    m = res["total"]["margem_contribuicao_conhecida"]
    assert m["componentes_parciais"] == ["ads"] and m["aviso"] is not None
    assert res["total"]["completude"]["parciais"] == 1


# ---------------------------------------------------------------------------
# Cenario estimado
# ---------------------------------------------------------------------------

def _cmv_nao_reconciliado():
    linhas = cmv("ml", "kokeshi", receita_fiscal=450_000.0, custo=135_000.0, status="nao_reconciliado")
    for ln in linhas:
        ln["cobertura"] = 1.0
    return linhas


def test_cenario_extrapola_cmv_nao_reconciliado_pela_razao_coberta():
    body = _montar([mart("ml", "kokeshi")], _cmv_nao_reconciliado(), premissas=prem(JUL, "kokeshi"),
                   canais=("ml",), marcas=("kokeshi",))
    cel = body["celulas_base"][0]
    assert cel["componentes"]["cmv"]["valor"] == 135_000.0          # o realizado nunca extrapola
    assert cel["componentes"]["cmv"]["cobertura_rotulo"] == "NF cobre 45% do GMV"
    cen = cel["cenario_premissas"]
    linha = DP.linha(cen, "cmv")
    assert linha["origem"] == "extrapolado" and linha["valor"] == pytest.approx(300_000.0)  # 30% x 1 mi
    assert linha["motivo"].startswith("extrapolado: CMV de 30,0% da receita com custo")
    assert "NF cobre 45% do GMV" in linha["motivo"]
    assert cen["estado"] == DP.PARCIAL and cen["margem_contribuicao_estimada"] is not None


def test_cenario_cmv_parcial_sem_base_entra_como_esta():
    linhas = cmv("ml", "kokeshi", receita_fiscal=450_000.0, custo=135_000.0, status="nao_reconciliado")
    body = _montar([mart("ml", "kokeshi")], linhas, premissas=prem(JUL, "kokeshi"), canais=("ml",),
                   marcas=("kokeshi",))
    linha = DP.linha(body["celulas_base"][0]["cenario_premissas"], "cmv")
    assert (linha["origem"], linha["valor"]) == ("parcial", 135_000.0)  # cobertura nao publicada


def _escrow(cobertura=0.93, valor=93_000.0):
    r = _pub(JUL, "shopee", "kokeshi", "shopee_taxa_escrow", valor, sinal=1)
    r["cobertura"] = cobertura
    return r


def test_taxa_shopee_do_escrow_parcial_tem_rotulo_e_e_extrapolada_no_cenario():
    body = _montar([mart("shopee", "kokeshi", fees=None, fees_n=0)], cmv("shopee", "kokeshi") + [_escrow()],
                   premissas=prem(JUL, "kokeshi"), canais=("shopee",), marcas=("kokeshi",))
    cel = body["celulas_base"][0]
    tx = cel["componentes"]["taxas"]
    assert (tx["status"], tx["valor"], tx["origem"]) == (dre.COBERTURA_PARCIAL, 93_000.0, "parcial")
    assert tx["cobertura_rotulo"] == "escrow em 93,0% dos pedidos"
    assert "taxas" in cel["margem_contribuicao_conhecida"]["componentes_parciais"]
    linha = DP.linha(cel["cenario_premissas"], "despesas_marketplace")
    assert linha["origem"] == "extrapolado" and linha["valor"] == pytest.approx(100_000.0)
    assert linha["motivo"] == "extrapolado: taxa do escrow (93,0% dos pedidos) estendida à parte sem escrow"


def test_taxa_nao_confirmada_entra_no_cenario_como_parcial():
    body = _montar([mart("shopee", "kokeshi")], cmv("shopee", "kokeshi"), premissas=prem(JUL, "kokeshi"),
                   canais=("shopee",), marcas=("kokeshi",))
    linha = DP.linha(body["celulas_base"][0]["cenario_premissas"], "despesas_marketplace")
    assert (linha["origem"], linha["valor"]) == ("parcial", 150_000.0)


def test_cenario_so_e_nao_calculavel_sem_receita_ou_com_premissa_invalida():
    sem_receita = _montar([mart("ml", "kokeshi", gmv=None)], cmv("ml", "kokeshi"),
                          premissas=prem(JUL, "kokeshi"), canais=("ml",), marcas=("kokeshi",))
    assert sem_receita["celulas_base"][0]["cenario_premissas"]["estado"] == DP.NAO_CALCULAVEL
    invalida = _montar([mart("ml", "kokeshi")], cmv("ml", "kokeshi"),
                       premissas=prem(JUL, "kokeshi", lote_status="failed"), canais=("ml",), marcas=("kokeshi",))
    assert invalida["celulas_base"][0]["cenario_premissas"]["estado"] == DP.NAO_CALCULAVEL


def test_recorte_misto_e_parcial_com_celulas_sem_premissa():
    body = _montar([mart("ml", "kokeshi"), mart("ml", "barbours", gmv=500_000.0)],
                   cmv("ml", "kokeshi") + cmv("ml", "barbours", receita_fiscal=500_000.0),
                   premissas=prem(JUL, "kokeshi"), canais=("ml",))
    total = body["total"]["cenario_premissas"]
    kok = next(c for c in body["celulas_base"] if c["marca"] == "kokeshi")["cenario_premissas"]
    assert total["estado"] == DP.PARCIAL and total["celulas_sem_premissa"] == 1 and total["celulas"] == 1
    assert total["receita_base"] == 1_000_000.0
    assert total["margem_contribuicao_estimada"] == kok["margem_contribuicao_estimada"]
    assert any("sem premissa publicada" in m for m in total["motivos"])
    assert kok["celulas_sem_premissa"] == 0


def test_regras_anunciam_a_previa_e_impostos_parciais_na_margem():
    regras = montar(mart_rows=[mart("ml")], cmv_rows=[cmv("ml")], canais=("ml",), marcas=("kokeshi",))["regras"]
    assert regras["previa"] == "mes imaturo (M+2) sai como PREVIA com valores e fecha_em"
    assert "fica fora" not in regras["impostos"]
