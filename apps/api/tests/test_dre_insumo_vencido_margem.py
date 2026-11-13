"""T-0101 — insumo vencido ou ausente SUSPENDE a margem; nunca a infla.

Medido em producao (11/11/2026 21:27Z): o insumo publicado em 09/11 venceu
(54 h) e, com a regra da T-0090 (margem sempre que ha receita), a margem
conhecida do TikTok em out/26 saiu 100% — nenhum custo entrou. Regra nova:
dado velho nao e' dado parcial.

  * custo obrigatorio (taxas, CMV) `snapshot_vencido`/`snapshot_ausente` ->
    margem conhecida None, `suspensa`, `motivo_suspensao` com a data;
  * o cenario estimado da celula fica `nao_calculavel` pela mesma condicao;
  * agregado com alguma celula suspensa -> margem None, `celulas_suspensas`;
  * parcial NAO vencido continua entrando (T-0090);
  * receita e componentes continuam visiveis.

Numeros sinteticos.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.schemas.dre import DREResponse
from app.services import dre_premissas as DP
from app.services import dre_service as dre
from tests.test_dre_mvp import AGORA, JUL, celula, cmv, mart, montar, repasse
from tests.test_dre_premissas import prem

#: 54 h + 1 min antes de AGORA (13/10 12:00 UTC) = 11/10 05:59 UTC = 11/10 em BRT.
VELHO = AGORA - dre.INSUMO_IDADE_MAXIMA - timedelta(minutes=1)
DATA_VELHO = "11/10/2026"
FECHO = f"margem suspensa até a republicação (publicado em {DATA_VELHO})"


def _montar(mart_rows, insumos, *, premissas=None):
    leit = None if premissas is None else DP.LeituraPremissas(tabela_existe=True, linhas=list(premissas))
    body = dre.montar_dre(inicio=JUL, fim=date(2026, 7, 31), canais=["tiktok", "ml", "shopee"],
                          marcas=["kokeshi", "barbours"], mart_rows=list(mart_rows), afiliado_rows=[],
                          insumos=dre.LeituraInsumos(tabela_existe=True, linhas=list(insumos)),
                          hoje=date(2026, 10, 13), agora=AGORA, premissas=leit)
    validado = DREResponse.model_validate(body).model_dump()  # os campos novos passam pelo contrato
    return body, validado


def _suspensa(m: dict, motivo: str) -> None:
    assert m["valor"] is None and m["pct_receita"] is None
    assert m["suspensa"] is True and m["motivo_suspensao"] == motivo


# ---------------------------------------------------------------------------
# Celula base
# ---------------------------------------------------------------------------

def test_taxas_vencidas_suspendem_a_margem_com_motivo_e_data():
    # O caso de producao: repasse TikTok vencido (taxas e frete), CMV em dia.
    c = celula("tiktok", m=mart("tiktok"), r=repasse(publicado_em=VELHO))
    assert c["componentes"]["taxas"]["status"] == dre.SNAPSHOT_VENCIDO
    assert c["componentes"]["frete"]["status"] == dre.SNAPSHOT_VENCIDO
    motivo = f"insumo vencido: taxas; {FECHO}"
    _suspensa(c["margem_contribuicao_conhecida"], motivo)
    assert c["motivos_classificacao"][0] == motivo
    assert c["classificacao"] == dre.PARCIAL  # a classificacao nao muda
    # Receita e componentes seguem visiveis, com os valores e status de hoje.
    assert c["componentes"]["receita"]["valor"] == 1_000_000.0
    assert c["componentes"]["cmv"]["valor"] == 300_000.0 and c["componentes"]["cmv"]["entra_na_margem"] is True
    assert c["completude"]["usados"] == 1 and "cmv" in c["componentes_disponiveis"]


def test_cmv_vencido_suspende_a_margem():
    c = celula("ml", c=cmv("ml", publicado_em=VELHO))
    assert c["componentes"]["cmv"]["status"] == dre.SNAPSHOT_VENCIDO
    _suspensa(c["margem_contribuicao_conhecida"], f"insumo vencido: cmv; {FECHO}")
    assert c["componentes"]["taxas"]["valor"] == 150_000.0
    assert c["completude"]["texto"] == "3 de 6 custos"


def test_cmv_snapshot_ausente_sem_publicacao_suspende_sem_data():
    c = celula("ml", c=[])
    assert c["componentes"]["cmv"]["status"] == dre.SNAPSHOT_AUSENTE
    _suspensa(c["margem_contribuicao_conhecida"], "insumo ausente: cmv; margem suspensa até a republicação")


def test_cmv_snapshot_ausente_por_lote_falho_leva_a_data_do_lote():
    c = celula("ml", c=cmv("ml", publicado_em=VELHO, lote_status="failed"))
    assert c["componentes"]["cmv"]["status"] == dre.SNAPSHOT_AUSENTE
    _suspensa(c["margem_contribuicao_conhecida"], f"insumo ausente: cmv; {FECHO}")


def test_taxas_e_cmv_vencidos_nomeiam_os_dois():
    c = celula("tiktok", m=mart("tiktok"), c=cmv("tiktok", publicado_em=VELHO), r=repasse(publicado_em=VELHO))
    _suspensa(c["margem_contribuicao_conhecida"], f"insumo vencido: taxas, cmv; {FECHO}")


def test_parcial_nao_vencido_continua_com_margem():
    # CMV nao reconciliado e Ads parcial, publicados em dia: regra da T-0090.
    c = celula("ml", m=mart("ml", ads_n=20), c=cmv("ml", status="nao_reconciliado"))
    m = c["margem_contribuicao_conhecida"]
    assert m["suspensa"] is False and m["motivo_suspensao"] is None
    assert m["valor"] is not None and {"ads", "cmv"} <= set(m["componentes_parciais"])


def test_frete_vencido_sozinho_nao_suspende():
    # So' taxas e CMV sao obrigatorios: frete fora da soma segue a regra da T-0090.
    c = celula("ml", m=mart("ml", frete=None, frete_n=0))
    assert c["margem_contribuicao_conhecida"]["suspensa"] is False


def test_sem_receita_continua_nao_calculavel_sem_suspensao():
    c = celula("ml", m=mart("ml", gmv=None), c=[])
    assert c["classificacao"] == dre.NAO_CALCULAVEL
    assert c["margem_contribuicao_conhecida"]["suspensa"] is False


# ---------------------------------------------------------------------------
# Cenario estimado
# ---------------------------------------------------------------------------

def test_estimada_suspensa_pela_mesma_condicao():
    rows = [mart("ml", "kokeshi", dias=31)]
    body, _ = _montar(rows, cmv("ml", "kokeshi", publicado_em=VELHO), premissas=prem(JUL, "kokeshi"))
    cel = body["celulas_base"][0]
    cen = cel["cenario_premissas"]
    motivo = f"insumo vencido: cmv; {FECHO}"
    assert cen["estado"] == DP.NAO_CALCULAVEL and cen["margem_contribuicao_estimada"] is None
    assert cen["margem_contribuicao_estimada_pct"] is None
    assert cen["suspensa"] is True and cen["motivo_suspensao"] == motivo and cen["motivos"][0] == motivo
    # As linhas seguem visiveis.
    assert DP.linha(cen, "icms")["valor"] == 10_000.0
    assert DP.linha(cen, "despesas_marketplace")["valor"] == 150_000.0
    assert DP.linha(cen, "cmv")["valor"] is None


def test_estimada_com_taxas_tiktok_vencidas_e_suspensa():
    rows = [mart("tiktok", "kokeshi", dias=31)]
    body, _ = _montar(rows, [*cmv("tiktok", "kokeshi"), *repasse(publicado_em=VELHO)],
                      premissas=prem(JUL, "kokeshi"))
    cen = body["celulas_base"][0]["cenario_premissas"]
    assert cen["estado"] == DP.NAO_CALCULAVEL and cen["suspensa"] is True
    assert cen["margem_contribuicao_estimada"] is None


def test_estimada_sem_suspensao_segue_com_numero():
    body, _ = _montar([mart("ml", "kokeshi", dias=31)], cmv("ml", "kokeshi"), premissas=prem(JUL, "kokeshi"))
    cen = body["celulas_base"][0]["cenario_premissas"]
    assert cen["suspensa"] is False and cen["celulas_suspensas"] == 0
    assert cen["margem_contribuicao_estimada"] is not None


# ---------------------------------------------------------------------------
# Agregado
# ---------------------------------------------------------------------------

def test_agregado_com_uma_celula_suspensa_fica_suspenso():
    rows = [mart("ml", "kokeshi"), mart("tiktok", "kokeshi")]
    body, validado = _montar(rows, [*cmv("ml", "kokeshi"), *cmv("tiktok", "kokeshi"),
                                    *repasse(publicado_em=VELHO)], premissas=prem(JUL, "kokeshi"))
    total = body["total"]
    motivo = f"1 de 2 células com margem suspensa (insumo vencido); {FECHO}"
    # Escolha conservadora: soma parcial de canais tambem engana -> None.
    _suspensa(total["margem_contribuicao_conhecida"], motivo)
    assert total["celulas_suspensas"] == 1 and total["motivos_classificacao"][0] == motivo
    assert validado["total"]["celulas_suspensas"] == 1
    assert validado["total"]["margem_contribuicao_conhecida"]["suspensa"] is True
    # Receita e componentes do agregado seguem visiveis.
    assert total["componentes"]["receita"]["valor"] == pytest.approx(2_000_000.0 - 0.0, rel=0.01)
    assert total["componentes"]["cmv"]["valor"] == 600_000.0
    # O canal sem suspensao continua com margem; o suspenso, nao.
    ml = next(c for c in body["por_canal"] if c["canal"] == "ml")
    tk = next(c for c in body["por_canal"] if c["canal"] == "tiktok")
    assert ml["margem_contribuicao_conhecida"]["valor"] is not None and ml["celulas_suspensas"] == 0
    assert tk["margem_contribuicao_conhecida"]["suspensa"] is True and tk["celulas_suspensas"] == 1
    # Cenario estimado do agregado: tambem suspenso, com a contagem.
    cen = total["cenario_premissas"]
    assert cen["estado"] == DP.NAO_CALCULAVEL and cen["margem_contribuicao_estimada"] is None
    assert cen["suspensa"] is True and cen["celulas_suspensas"] == 1
    assert cen["motivos"][0].startswith("1 de 2 células com margem estimada suspensa")


def test_cenario_agregado_suspenso_traz_a_data_mais_antiga():
    # kokeshi publicado em 11/10, barbours dois dias antes (09/10): vale a mais antiga.
    rows = [mart("ml", "kokeshi", dias=31), mart("ml", "barbours", dias=31)]
    insumos = [*cmv("ml", "kokeshi", publicado_em=VELHO),
               *cmv("ml", "barbours", publicado_em=VELHO - timedelta(days=2))]
    body, validado = _montar(rows, insumos, premissas=[*prem(JUL, "kokeshi"), *prem(JUL, "barbours")])
    motivos_celulas = [c["cenario_premissas"]["motivo_suspensao"] for c in body["celulas_base"]]
    assert {m[-11:-1] for m in motivos_celulas} == {"09/10/2026", DATA_VELHO}
    cen = body["total"]["cenario_premissas"]
    motivo = ("2 de 2 células com margem estimada suspensa (insumo vencido ou ausente); "
              "margem suspensa até a republicação (publicado em 09/10/2026)")
    assert cen["suspensa"] is True and cen["motivo_suspensao"] == motivo and cen["motivos"][0] == motivo
    assert validado["total"]["cenario_premissas"]["motivo_suspensao"] == motivo


def test_cenario_agregado_suspenso_sem_data_mantem_o_texto():
    # CMV ausente sem publicacao nas duas celulas: nenhuma data a herdar.
    rows = [mart("ml", "kokeshi", dias=31), mart("ml", "barbours", dias=31)]
    body, _ = _montar(rows, [], premissas=[*prem(JUL, "kokeshi"), *prem(JUL, "barbours")])
    cen = body["total"]["cenario_premissas"]
    assert cen["suspensa"] is True and cen["motivo_suspensao"] == (
        "2 de 2 células com margem estimada suspensa (insumo vencido ou ausente); "
        "margem suspensa até a republicação")


def test_agregado_com_todas_suspensas_e_none():
    rows = [mart("ml", "kokeshi"), mart("ml", "barbours")]
    body, _ = _montar(rows, [*cmv("ml", "kokeshi", publicado_em=VELHO)])  # barbours: CMV ausente
    total = body["total"]
    m = total["margem_contribuicao_conhecida"]
    assert m["valor"] is None and m["suspensa"] is True and total["celulas_suspensas"] == 2
    assert m["motivo_suspensao"] == f"2 de 2 células com margem suspensa (insumo vencido ou ausente); {FECHO}"
    assert total["componentes"]["receita"]["valor"] == 2_000_000.0


def test_agregado_sem_suspensao_mantem_a_soma():
    body = montar([mart("ml", "kokeshi"), mart("ml", "barbours")],
                  cmv_rows=[cmv("ml", "kokeshi"), cmv("ml", "barbours")])
    total = body["total"]
    m = total["margem_contribuicao_conhecida"]
    assert m["suspensa"] is False and total["celulas_suspensas"] == 0
    assert m["valor"] == pytest.approx(2 * (1_000_000 - 150_000 - 40_000 - 130_000 - 300_000))


# ---------------------------------------------------------------------------
# T-0112 (A2-23): taxa ou CMV sem valor utilizavel tambem suspende
# ---------------------------------------------------------------------------
# Medido no VAL-A2: kokeshi Shopee out/26 com a taxa `indisponivel` saiu com
# margem "conhecida" de 51% — a taxa ficava fora da soma. Agora suspende como
# na T-0101, com motivo sem data (republicar nao resolve).

def test_taxa_indisponivel_com_receita_suspende():
    c = celula("ml", m=mart("ml", fees=None, fees_n=0))
    tx = c["componentes"]["taxas"]
    assert tx["status"] == dre.INDISPONIVEL and tx["motivo"]
    _suspensa(c["margem_contribuicao_conhecida"], f"taxa indisponível: {tx['motivo']}; margem suspensa")
    assert c["margem_contribuicao_conhecida"]["_suspensa_desde"] is None
    assert c["componentes"]["receita"]["valor"] == 1_000_000.0  # receita segue visivel


def test_cmv_indisponivel_com_receita_suspende():
    c = celula("ml", c=cmv("ml", custo=None))
    cm = c["componentes"]["cmv"]
    assert cm["status"] == dre.INDISPONIVEL
    _suspensa(c["margem_contribuicao_conhecida"], f"CMV indisponível: {cm['motivo']}; margem suspensa")


def test_taxa_sinal_inesperado_suspende():
    c = celula("ml", m=mart("ml", fees_neg_n=1))
    tx = c["componentes"]["taxas"]
    assert tx["status"] == dre.SINAL_INESPERADO
    _suspensa(c["margem_contribuicao_conhecida"], f"taxa com sinal inesperado: {tx['motivo']}; margem suspensa")


def test_taxa_nao_aplicavel_nao_suspende():
    comps = {"taxas": {"status": dre.NAO_APLICAVEL, "motivo": None},
             "cmv": {"status": dre.DISPONIVEL, "motivo": None}}
    assert dre._suspensao_da_celula(comps) is None


def test_taxa_parcial_nao_suspende_contraprova():
    c = celula("ml", m=mart("ml", fees_n=5))
    assert c["componentes"]["taxas"]["status"] == dre.COBERTURA_PARCIAL
    m = c["margem_contribuicao_conhecida"]
    assert m["suspensa"] is False and m["valor"] is not None and m["componentes_parciais"] == ["taxas"]


def test_indisponivel_e_vencido_juntos_mantem_a_data():
    c = celula("ml", m=mart("ml", fees=None, fees_n=0), c=cmv("ml", publicado_em=VELHO))
    tx = c["componentes"]["taxas"]
    _suspensa(c["margem_contribuicao_conhecida"], f"insumo vencido: cmv; taxa indisponível: {tx['motivo']}; {FECHO}")


def test_estimada_da_celula_com_taxa_indisponivel_fica_nao_calculavel():
    body, _ = _montar([mart("ml", "kokeshi", dias=31, fees=None, fees_n=0)], cmv("ml", "kokeshi"),
                      premissas=prem(JUL, "kokeshi"))
    cen = body["celulas_base"][0]["cenario_premissas"]
    assert cen["estado"] == DP.NAO_CALCULAVEL and cen["margem_contribuicao_estimada"] is None
    assert cen["suspensa"] is True and cen["motivo_suspensao"].startswith("taxa indisponível: ")


def test_agregado_com_uma_celula_suspensa_por_indisponivel():
    rows = [mart("ml", "kokeshi", dias=31, fees=None, fees_n=0), mart("ml", "barbours", dias=31)]
    body, validado = _montar(rows, [*cmv("ml", "kokeshi"), *cmv("ml", "barbours")],
                             premissas=[*prem(JUL, "kokeshi"), *prem(JUL, "barbours")])
    total = body["total"]
    motivo = "1 de 2 células com margem suspensa (taxa ou CMV indisponível); margem suspensa"
    _suspensa(total["margem_contribuicao_conhecida"], motivo)
    assert total["celulas_suspensas"] == 1 and validado["total"]["celulas_suspensas"] == 1
    cen = total["cenario_premissas"]
    assert cen["suspensa"] is True and cen["celulas_suspensas"] == 1
    assert cen["margem_contribuicao_estimada"] is None
    assert cen["motivo_suspensao"] == ("1 de 2 células com margem estimada suspensa "
                                       "(taxa ou CMV sem valor utilizável); margem suspensa")
