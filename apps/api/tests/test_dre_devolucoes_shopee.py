"""T-0093 — devolucoes reais da Shopee na DRE.

A receita Shopee da DRE e' o `gmv` do mart, com dois donos por loja:
  * apice, barbours, lescent, rituaria (API): soma de `item_total` dos nao
    cancelados, SEM descontar reembolso -> a devolucao real (publicada em
    `marts.fact_dre_insumo_mensal.shopee_devolucao_reembolso`) entra na margem;
  * kokeshi (shop-stats): vendas − canceladas − devolvidas -> a receita ja' e'
    liquida; a devolucao do export (`marts.shopee_returns_export`) e' so'
    INFORMATIVA (D2), nunca deduzida.

Aqui se prova, sem banco: status pela cobertura, falha fechada (sem linha,
vencido, sem tabela), a margem conhecida, ML/TikTok intactos, o cenario
estimado e o agregado Shopee. Numeros sinteticos.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app.schemas.dre import DREResponse
from app.services import dre_premissas as DP
from app.services import dre_service as dre
from tests.test_dre_mvp import FakeNeon, mart
from tests.test_dre_premissas import prem

OUT, NOV = date(2026, 10, 1), date(2026, 11, 1)
HOJE = date(2026, 11, 11)
AGORA = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)
PUBLICADO = AGORA - timedelta(hours=6)
COB_OUT = round(25 / 31, 6)  # captura comeca em 07/10
SEM_FONTE = "sem fonte de devolucao/reembolso em valor (perguntas C6, F5)"


def dev_pub(marca="barbours", mes=OUT, valor=12_000.0, cobertura=COB_OUT, *, publicado_em=None,
            lote_status="success", sinal=1):
    """Linha `shopee_devolucao_reembolso`, como o publisher vai gravar (contrato da T-0093)."""
    return {
        "competencia": mes, "canal": "shopee", "marca": marca, "componente": "shopee_devolucao_reembolso",
        "valor": valor, "sinal_origem": None if valor is None else sinal,
        "cobertura": None if valor is None else cobertura, "provisorio_share": None,
        "status_reconciliacao": "ausente_na_origem" if valor is None else "nao_avaliado",
        "motivo": "sem devolucao aceita na origem" if valor is None else "reembolso das ACCEPTED por create_time",
        "data_max_origem": datetime(2026, 11, 10, 18, 0, tzinfo=UTC),
        "publicado_em": publicado_em or PUBLICADO, "lote_id": 7, "lote_status": lote_status,
    }


def dev_export(marca="kokeshi", mes=OUT, reembolsado=Decimal("8765.43"), devolucoes=40, aceitas=30):
    """Uma linha de `ler_devolucoes_export` (soma do mes em `marts.shopee_returns_export`)."""
    return {"mes": mes, "marca": marca, "devolucoes": devolucoes, "aceitas": aceitas,
            "reembolsado": reembolsado, "data_max_origem": datetime(2026, 11, 10, 9, 0, tzinfo=UTC)}


def sh(marca="barbours", mes=OUT):
    return mart("shopee", marca, mes=mes, dias=dre.ultimo_dia(mes).day)


def montar(mart_rows, insumos=(), export=None, *, mes=OUT, canais=("shopee",), marcas=("barbours", "kokeshi"),
           premissas=None):
    return dre.montar_dre(
        inicio=mes, fim=dre.ultimo_dia(mes), canais=list(canais), marcas=list(marcas),
        mart_rows=list(mart_rows), afiliado_rows=[],
        insumos=dre.LeituraInsumos(tabela_existe=True, linhas=list(insumos)), hoje=HOJE, agora=AGORA,
        premissas=None if premissas is None else DP.LeituraPremissas(tabela_existe=True, linhas=list(premissas)),
        devolucoes_export=export,
    )


def cel(out, canal, marca):
    return next(c for c in out["celulas_base"] if (c["canal"], c["marca"]) == (canal, marca))


def lido(*linhas):
    return dre.LeituraDevolucoesExport(tabela_existe=True, linhas=list(linhas))


# ---------------------------------------------------------------------------
# Lojas com API: devolucao publicada, na margem
# ---------------------------------------------------------------------------

def test_cobertura_parcial_entra_na_margem_pelo_valor_medido_com_rotulo():
    out = montar([sh()], [dev_pub()])
    DREResponse.model_validate(out)
    c = cel(out, "shopee", "barbours")
    d = c["componentes"]["devolucoes"]
    assert (d["valor"], d["status"], d["origem"]) == (12_000.0, dre.COBERTURA_PARCIAL, dre.ORIGEM_PARCIAL)
    assert d["somavel"] is True and d["entra_na_margem"] is True
    assert d["cobertura_rotulo"] == "desde 07/10 (25 de 31 dias)"
    assert d["cobertura"] == COB_OUT
    assert d["fonte"] == "marts.fact_dre_insumo_mensal.shopee_devolucao_reembolso"
    assert d["publicado_em"] == PUBLICADO
    m = c["margem_contribuicao_conhecida"]
    assert "devolucoes" in m["componentes_usados"] and "devolucoes" in m["componentes_parciais"]
    # Nunca extrapolado no realizado: a margem desconta exatamente o medido.
    sem = cel(montar([sh()]), "shopee", "barbours")["margem_contribuicao_conhecida"]["valor"]
    assert round(sem - m["valor"], 2) == 12_000.0


def test_cobertura_total_e_disponivel():
    d = cel(montar([sh(mes=NOV)], [dev_pub(mes=NOV, cobertura=1.0)], mes=NOV), "shopee", "barbours")
    d = d["componentes"]["devolucoes"]
    assert (d["valor"], d["status"], d["origem"], d["entra_na_margem"]) == (
        12_000.0, dre.DISPONIVEL, dre.ORIGEM_REALIZADO, True)
    assert d["cobertura_rotulo"] is None


def test_sem_linha_publicada_fica_indisponivel_nunca_zero():
    c = cel(montar([sh()]), "shopee", "barbours")
    d = c["componentes"]["devolucoes"]
    assert (d["valor"], d["status"]) == (None, dre.INDISPONIVEL)
    assert d["motivo"] == dre.MOTIVO_DEVOLUCAO_SEM_PUBLICACAO
    assert d["entra_na_margem"] is False
    assert "devolucoes" in c["margem_contribuicao_conhecida"]["faltam"]


def test_ausente_na_origem_nao_vira_zero():
    d = cel(montar([sh()], [dev_pub(valor=None)]), "shopee", "barbours")["componentes"]["devolucoes"]
    assert (d["valor"], d["status"], d["entra_na_margem"]) == (None, dre.INDISPONIVEL, False)


def test_insumo_vencido_fica_fora_da_margem():
    c = cel(montar([sh()], [dev_pub(publicado_em=AGORA - timedelta(hours=60))]), "shopee", "barbours")
    d = c["componentes"]["devolucoes"]
    assert (d["valor"], d["status"], d["entra_na_margem"]) == (None, dre.SNAPSHOT_VENCIDO, False)
    assert "devolucoes" not in c["margem_contribuicao_conhecida"]["componentes_usados"]


def test_lote_nao_concluido_falha_fechado():
    d = cel(montar([sh()], [dev_pub(lote_status="running")]), "shopee", "barbours")["componentes"]["devolucoes"]
    assert (d["valor"], d["status"]) == (None, dre.SNAPSHOT_AUSENTE)


def test_linha_publicada_para_a_kokeshi_e_ignorada():
    """Uma fonte por loja: a Kokeshi nunca deduz, mesmo que o publisher grave algo para ela."""
    c = cel(montar([sh("kokeshi")], [dev_pub("kokeshi")], lido(dev_export())), "shopee", "kokeshi")
    assert c["componentes"]["devolucoes"]["somavel"] is False
    assert c["componentes"]["devolucoes"]["valor"] == 8765.43


# ---------------------------------------------------------------------------
# Kokeshi: informativa (D2)
# ---------------------------------------------------------------------------

def test_kokeshi_informativa_nao_reduz_a_margem():
    com = cel(montar([sh("kokeshi")], export=lido(dev_export())), "shopee", "kokeshi")
    sem = cel(montar([sh("kokeshi")]), "shopee", "kokeshi")
    d = com["componentes"]["devolucoes"]
    assert d["valor"] == 8765.43
    assert d["somavel"] is False and d["entra_na_margem"] is False
    assert d["status"] == dre.COBERTURA_PARCIAL and d["origem"] == dre.ORIGEM_PARCIAL
    assert d["cobertura_rotulo"] == "desde 07/10 (25 de 31 dias)"
    assert "já descontada da receita: GMV do shop-stats é líquido de devoluções" in d["motivo"]
    assert d["fonte"].startswith("marts.shopee_returns_export")
    assert com["componentes"]["receita"]["valor"] == sem["componentes"]["receita"]["valor"]
    assert com["margem_contribuicao_conhecida"]["valor"] == sem["margem_contribuicao_conhecida"]["valor"]
    assert "devolucoes" not in com["margem_contribuicao_conhecida"]["faltam"]
    assert "devolucoes" not in com["margem_contribuicao_conhecida"]["componentes_usados"]


def test_kokeshi_mes_inteiro_e_disponivel():
    d = cel(montar([sh("kokeshi", NOV)], export=lido(dev_export(mes=NOV)), mes=NOV), "shopee", "kokeshi")
    d = d["componentes"]["devolucoes"]
    assert (d["status"], d["origem"], d["somavel"], d["entra_na_margem"]) == (
        dre.DISPONIVEL, dre.ORIGEM_REALIZADO, False, False)


def test_kokeshi_sem_a_tabela_fica_indisponivel():
    d = cel(montar([sh("kokeshi")], export=dre.LeituraDevolucoesExport(tabela_existe=False)), "shopee", "kokeshi")
    d = d["componentes"]["devolucoes"]
    assert (d["valor"], d["status"], d["somavel"]) == (None, dre.INDISPONIVEL, False)
    assert "migration 036" in d["motivo"]


def test_kokeshi_sem_devolucao_no_mes_nao_vira_zero():
    d = cel(montar([sh("kokeshi")], export=lido()), "shopee", "kokeshi")["componentes"]["devolucoes"]
    assert (d["valor"], d["status"]) == (None, dre.INDISPONIVEL)


def test_kokeshi_antes_da_captura_fica_indisponivel():
    set_ = date(2026, 9, 1)
    d = cel(montar([sh("kokeshi", set_)], export=lido(dev_export(mes=set_)), mes=set_), "shopee", "kokeshi")
    d = d["componentes"]["devolucoes"]
    assert (d["valor"], d["status"]) == (None, dre.INDISPONIVEL)
    assert "07/10/2026" in d["motivo"]


def test_kokeshi_sem_leitura_fica_como_antes():
    """`montar_dre` sem `devolucoes_export` (chamadores antigos): sem fonte, como antes."""
    d = cel(montar([sh("kokeshi")]), "shopee", "kokeshi")["componentes"]["devolucoes"]
    assert (d["valor"], d["status"], d["somavel"], d["motivo"]) == (None, dre.INDISPONIVEL, True, SEM_FONTE)


def test_get_dre_le_o_export_da_kokeshi_e_tolera_a_tabela_ausente():
    rows = [sh("kokeshi"), sh("barbours")]
    neon = FakeNeon(mart_rows=rows, devolucoes_export=[dev_export()], insumos=[dev_pub()])
    out = dre.get_dre(neon, inicio=OUT, fim=date(2026, 10, 31), canais=["shopee"], marcas=None,
                      hoje=HOJE, agora=AGORA)
    DREResponse.model_validate(out)
    assert cel(out, "shopee", "kokeshi")["componentes"]["devolucoes"]["valor"] == 8765.43
    p = next(p for p, s in zip(neon.params, neon.sqls) if "shopee_returns_export" in s and "to_regclass" not in s)
    assert p["marcas"] == ["kokeshi"]
    sem = dre.get_dre(FakeNeon(mart_rows=rows), inicio=OUT, fim=date(2026, 10, 31), canais=["shopee"],
                      marcas=None, hoje=HOJE, agora=AGORA)
    assert cel(sem, "shopee", "kokeshi")["componentes"]["devolucoes"]["status"] == dre.INDISPONIVEL


def test_get_dre_sem_shopee_nao_le_o_export():
    neon = FakeNeon(mart_rows=[mart("ml", "kokeshi", mes=OUT)], devolucoes_export=[dev_export()])
    dre.get_dre(neon, inicio=OUT, fim=date(2026, 10, 31), canais=["ml"], marcas=None, hoje=HOJE, agora=AGORA)
    assert not any("shopee_returns_export" in s for s in neon.sqls)


# ---------------------------------------------------------------------------
# ML e TikTok: sem mudanca
# ---------------------------------------------------------------------------

def test_ml_e_tiktok_inalterados():
    rows = [mart("ml", "barbours", mes=OUT), mart("tiktok", "barbours", mes=OUT)]
    out = montar(rows, [dev_pub()], lido(dev_export()), canais=("tiktok", "ml", "shopee"))
    for canal in ("ml", "tiktok"):
        d = cel(out, canal, "barbours")["componentes"]["devolucoes"]
        assert (d["valor"], d["status"], d["somavel"], d["motivo"]) == (None, dre.INDISPONIVEL, True, SEM_FONTE)


# ---------------------------------------------------------------------------
# Agregado Shopee
# ---------------------------------------------------------------------------

def test_agregado_shopee_nao_soma_a_kokeshi_na_margem_nem_no_valor():
    out = montar([sh("barbours"), sh("kokeshi")], [dev_pub()], lido(dev_export()))
    DREResponse.model_validate(out)
    b, k = cel(out, "shopee", "barbours"), cel(out, "shopee", "kokeshi")
    canal = next(c for c in out["por_canal"] if c["canal"] == "shopee")
    soma = b["margem_contribuicao_conhecida"]["valor"] + k["margem_contribuicao_conhecida"]["valor"]
    assert canal["margem_contribuicao_conhecida"]["valor"] == round(soma, 2)
    # a margem da Kokeshi e' a mesma sem a leitura do export
    k_sem = cel(montar([sh("barbours"), sh("kokeshi")], [dev_pub()]), "shopee", "kokeshi")
    assert k["margem_contribuicao_conhecida"]["valor"] == k_sem["margem_contribuicao_conhecida"]["valor"]
    d = canal["componentes"]["devolucoes"]
    assert d["valor"] == 12_000.0  # so' a deduzida; a informativa fica fora do valor do agregado
    assert d["somavel"] is True and d["entra_na_margem"] is True
    assert "informativo" in d["motivo"]
    kk = next(c for c in out["por_canal_marca"] if c["marca"] == "kokeshi")["componentes"]["devolucoes"]
    assert kk["somavel"] is False and kk["valor"] == 8765.43


# ---------------------------------------------------------------------------
# Cenario estimado
# ---------------------------------------------------------------------------

def _dev_cenario(out, marca):
    return DP.linha(cel(out, "shopee", marca)["cenario_premissas"], "devolucoes_reembolsos")


def test_estimada_usa_devolucao_realizada_disponivel():
    out = montar([sh(mes=NOV)], [dev_pub(mes=NOV, cobertura=1.0)], mes=NOV, premissas=prem(NOV, "barbours"))
    ln = _dev_cenario(out, "barbours")
    assert (ln["valor"], ln["origem"], ln["somavel"]) == (12_000.0, DP.ORIGEM_REALIZADO, True)


def test_estimada_extrapola_pela_cobertura():
    out = montar([sh()], [dev_pub()], premissas=prem(OUT, "barbours"))
    DREResponse.model_validate(out)
    ln = _dev_cenario(out, "barbours")
    assert ln["origem"] == DP.ORIGEM_EXTRAPOLADO
    assert ln["valor"] == round(12_000.0 / COB_OUT, 2)
    assert "extrapolado" in ln["motivo"]


def test_estimada_kokeshi_sem_premissa_de_devolucao():
    out = montar([sh("kokeshi")], export=lido(dev_export()), premissas=prem(OUT, "kokeshi"))
    DREResponse.model_validate(out)
    cen = cel(out, "shopee", "kokeshi")["cenario_premissas"]
    ln = DP.linha(cen, "devolucoes_reembolsos")
    assert (ln["valor"], ln["status"], ln["somavel"]) == (None, "nao_aplicavel", False)
    assert "receita já líquida de devoluções (shop-stats)" in ln["motivo"]
    # sem a leitura (comportamento antigo) a premissa e' aplicada: a margem estimada cai exatamente 1% da receita
    antes = cel(montar([sh("kokeshi")], premissas=prem(OUT, "kokeshi")), "shopee", "kokeshi")["cenario_premissas"]
    receita = cen["receita_base"]
    assert round(cen["margem_contribuicao_estimada"] - antes["margem_contribuicao_estimada"], 2) == round(
        receita * 0.01, 2)


def test_estimada_sem_realizado_usa_a_premissa():
    out = montar([sh()], premissas=prem(OUT, "barbours"))
    ln = _dev_cenario(out, "barbours")
    assert ln["origem"] == DP.ORIGEM_PREMISSA and ln["percentual"] == 0.01
