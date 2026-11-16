"""
T-0120 (VAL-B1 B1-13) — a Financeiro tinha a taxa da Shopee anulada por desenho.

Desde o `daily_shopee` a fato grava `total_fees` NULL nas lojas com API
(`COLUNAS_ANULADAS`, pipelines/sync_shopee_daily_api.py). A DRE passou a ler a
taxa dessas lojas do escrow publicado em `marts.fact_dre_insumo_mensal`
(componente `shopee_taxa_escrow`, grao competencia x marca). A Financeiro agora
usa a MESMA fonte e a MESMA regra (funcoes da DRE), por mes:

  * mart com taxa em todas as linhas do mes -> mart;
  * senao, mes inteiro no periodo -> escrow publicado; cobertura < 100% -> parcial;
  * mes cortado pelo periodo -> sem escrow (insumo mensal, nao rateado);
  * marca sem valor -> null (nunca 0).

Valores: out/26 publicado em producao (DRE de 15/11/2026, `celulas_base`).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.schemas.performance import FinanceiroResponse
from app.services import dre_service
from app.services import performance_service as perf_svc
from app.deps.period import EffectivePeriod
from tests.financeiro_shopee_fake import FinanceiroSession, meses_do_mart

SHOPEE_ID = 3
OUT26 = date(2026, 10, 1)

#: GMV da fato e taxa do escrow (DRE out/26, produção): marca -> (gmv, taxa, pedidos com escrow, pedidos).
OUT26_DRE = {
    "apice": (645_673.00, 140_303.93, 8121, 8168),
    "barbours": (862_664.44, 188_879.25, 11068, 11111),
    "kokeshi": (3_800_202.69, 971_173.40, 67581, 67695),
    "lescent": (290_581.67, 70_011.61, 3999, 4013),
    "rituaria": (392_725.81, 102_164.58, 3567, 3578),
}


def _fato(brand, gmv, total_fees=0, total_settlement=0):
    # A fato chega com COALESCE(SUM(...), 0): a taxa anulada chega como 0.
    return {
        "brand_key": brand, "marketplace_id": SHOPEE_ID, "gmv": gmv,
        "total_settlement": total_settlement, "total_fees": total_fees,
        "ad_spend": 0, "ad_revenue": 0, "ad_clicks": 0, "ad_impressions": 0,
        "seller_shipping_cost": 0,
    }


def _insumo(marca, valor, com, pedidos, mes=OUT26, publicado_em=None, lote_status="success"):
    return {
        "competencia": mes, "canal": "shopee", "marca": marca, "componente": "shopee_taxa_escrow",
        "valor": valor, "sinal_origem": 1, "cobertura": com / pedidos, "provisorio_share": None,
        "status_reconciliacao": "nao_avaliado", "motivo": f"escrow em {com} de {pedidos} pedidos nao cancelados",
        "data_max_origem": None, "publicado_em": publicado_em or datetime.now(timezone.utc) - timedelta(hours=2),
        "lote_id": "lote-1", "lote_status": lote_status,
    }


def _out26(insumos=None, rows=None, period=None):
    rows = rows if rows is not None else [_fato(m, g) for m, (g, *_resto) in OUT26_DRE.items()]
    if insumos is None:
        insumos = [_insumo(m, t, c, p) for m, (_g, t, c, p) in OUT26_DRE.items()]
    db = FinanceiroSession(rows, OUT26, insumos=insumos)
    return perf_svc.get_financeiro(db, "shopee", 2026, 10, period=period), db


def _marca(res, brand):
    return next(b for b in res["brands"] if b["brand"] == brand)


def test_taxa_shopee_por_marca_igual_a_dre_out26():
    """Aceite numerico: taxa por marca da Financeiro = DRE (±0,5%)."""
    res, _ = _out26()
    for marca, (gmv, taxa, _c, _p) in OUT26_DRE.items():
        linha = _marca(res, marca)
        assert abs(linha["shopee_fees"] - taxa) <= taxa * 0.005, marca
        assert linha["shopee_avg_fee_pct"] == round(taxa / gmv * 100, 2), marca
    assert _marca(res, "kokeshi")["shopee_fees"] == 971_173.40
    assert _marca(res, "kokeshi")["shopee_avg_fee_pct"] == 25.56


def test_taxa_da_financeiro_e_a_mesma_da_celula_da_dre():
    """Mesma fonte e regra: o componente `taxas` que a DRE monta para a celula."""
    agora = datetime.now(timezone.utc)
    insumos = [_insumo(m, t, c, p) for m, (_g, t, c, p) in OUT26_DRE.items()]
    idx = dre_service.indexar_taxa_shopee(insumos, agora)
    res, _ = _out26()
    for marca, *_ in OUT26_DRE.items():
        do_mart = dre_service._custo_do_mart("taxas", "shopee", None, 0, 0, 31, "f", "m", dias=31)
        esperado = dre_service._taxa_shopee_escrow(idx[(OUT26, "shopee", marca)], do_mart)
        assert _marca(res, marca)["shopee_fees"] == esperado["valor"], marca


def test_escrow_abaixo_de_100_por_cento_vira_parcial_com_as_marcas():
    k = _out26()[0]["kpis"]
    c = k["shopee_fee_cobertura"]
    assert c["status"] == "parcial"
    assert (c["marcas_com_dado"], c["marcas_total"]) == (5, 5)
    assert c["marcas_sem_dado"] == []
    assert c["marcas_parciais"] == ["apice", "barbours", "kokeshi", "lescent", "rituaria"]
    assert abs(k["shopee_fees"] - sum(t for _g, t, _c, _p in OUT26_DRE.values())) < 0.01
    FinanceiroResponse.model_validate(_out26()[0])


def test_escrow_completo_e_completa():
    insumos = [_insumo(m, t, p, p) for m, (_g, t, _c, p) in OUT26_DRE.items()]
    res, _ = _out26(insumos=insumos)
    c = res["kpis"]["shopee_fee_cobertura"]
    assert c["status"] == "completa" and c["marcas_parciais"] == []
    assert _marca(res, "apice")["shopee_fee_status"] == "completa"


def test_marca_sem_escrow_fica_nula_e_nao_zero():
    insumos = [_insumo(m, t, c, p) for m, (_g, t, c, p) in OUT26_DRE.items() if m != "lescent"]
    res, _ = _out26(insumos=insumos)
    lescent = _marca(res, "lescent")
    assert lescent["shopee_fees"] is None and lescent["shopee_avg_fee_pct"] is None
    assert lescent["shopee_fee_status"] == "sem_dado"
    c = res["kpis"]["shopee_fee_cobertura"]
    assert c["marcas_sem_dado"] == ["lescent"] and c["status"] == "parcial"


def test_insumo_vencido_ou_lote_falho_nao_e_usado():
    """Mesma falha fechada da DRE (`_estado_do_lote`)."""
    velho = datetime.now(timezone.utc) - timedelta(days=10)
    insumos = [_insumo("apice", 140_303.93, 8121, 8168, publicado_em=velho),
               _insumo("barbours", 188_879.25, 11068, 11111, lote_status="failed")]
    res, _ = _out26(insumos=insumos, rows=[_fato("apice", 645_673.0), _fato("barbours", 862_664.44)])
    assert _marca(res, "apice")["shopee_fees"] is None
    assert _marca(res, "barbours")["shopee_fees"] is None


def test_mart_com_taxa_em_todas_as_linhas_tem_precedencia():
    """Regra 1 da DRE: mart cheio -> mart, mesmo com escrow publicado."""
    res, _ = _out26(rows=[_fato("kokeshi", 3_800_202.69, total_fees=950_000.0)])
    assert _marca(res, "kokeshi")["shopee_fees"] == 950_000.0
    assert _marca(res, "kokeshi")["shopee_fee_status"] == "completa"


def test_periodo_que_corta_o_mes_nao_usa_escrow():
    """O insumo e' mensal: nao e' rateado para um pedaco do mes."""
    periodo = EffectivePeriod(start=date(2026, 10, 1), end=date(2026, 10, 15),
                              ref_month="2026-10")
    res, db = _out26(period=periodo)
    assert all(_marca(res, m)["shopee_fees"] is None for m in OUT26_DRE)
    assert not any("fact_dre_insumo_mensal" in s for s in db.sqls)


def test_tabela_de_insumos_ausente_nao_derruba():
    rows = [_fato("apice", 645_673.0)]
    db = FinanceiroSession(rows, OUT26, insumos=None)
    res = perf_svc.get_financeiro(db, "shopee", 2026, 10)
    assert _marca(res, "apice")["shopee_fees"] is None
    assert res["kpis"]["shopee_fee_cobertura"]["status"] == "sem_dado"


def test_dois_meses_sem_escrow_num_deles_fica_nulo():
    meses = (meses_do_mart([_fato("apice", 1.0)], date(2026, 9, 1))
             + meses_do_mart([_fato("apice", 1.0)], OUT26))
    db = FinanceiroSession([_fato("apice", 1_200_000.0)], OUT26,
                           insumos=[_insumo("apice", 140_303.93, 8121, 8168)], meses=meses)
    periodo = EffectivePeriod(start=date(2026, 9, 1), end=date(2026, 10, 31),
                              ref_month="2026-10")
    res = perf_svc.get_financeiro(db, "shopee", 2026, 10, period=periodo)
    assert _marca(res, "apice")["shopee_fees"] is None, "setembro sem taxa: nao soma so' outubro"
