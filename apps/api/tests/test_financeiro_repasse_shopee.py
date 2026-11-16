"""
T-0120b — repasse da Shopee na Financeiro pelo insumo da DRE.

A fato grava `total_settlement` NULL nas lojas Shopee com API (`COLUNAS_ANULADAS`,
pipelines/sync_shopee_daily_api.py) e o repasse Shopee da Financeiro saia "—".
O publisher da DRE passa a publicar o repasse do escrow (`shopee_repasse_escrow`
= soma de `valor_repasse` = `escrow_amount`, antes de ajustes posteriores), com a
mesma coorte da taxa. A Financeiro le' esse componente com a MESMA regra da taxa
(T-0120), mes a mes:

  * mart com `total_settlement` em todas as linhas do mes -> mart;
  * senao, mes inteiro no periodo -> repasse publicado; cobertura < 100% -> parcial;
  * mes cortado pelo periodo -> sem escrow (insumo mensal, nao rateado);
  * marca sem valor -> null (nunca 0).

Valores: out/26 medido no Data Mart (16/11/2026), por marca.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.deps.period import EffectivePeriod
from app.schemas.performance import FinanceiroResponse
from app.services import performance_service as perf_svc
from tests.financeiro_shopee_fake import FinanceiroSession

SHOPEE_ID = 3
SET26 = date(2026, 9, 1)
OUT26 = date(2026, 10, 1)

#: marca -> (gmv da fato, repasse do escrow out/26, pedidos com escrow, pedidos nao cancelados).
OUT26_REPASSE = {
    "apice": (645_673.00, 423_257.41, 8121, 8168),
    "barbours": (862_664.44, 555_641.50, 11068, 11111),
    "kokeshi": (3_800_202.69, 2_296_007.01, 67581, 67695),
    "lescent": (290_581.67, 174_769.65, 3999, 4013),
    "rituaria": (392_725.81, 244_532.29, 3567, 3578),
}


def _fato(brand, gmv, total_settlement=0):
    # A fato chega com COALESCE(SUM(...), 0): o repasse anulado chega como 0.
    return {
        "brand_key": brand, "marketplace_id": SHOPEE_ID, "gmv": gmv,
        "total_settlement": total_settlement, "total_fees": 0,
        "ad_spend": 0, "ad_revenue": 0, "ad_clicks": 0, "ad_impressions": 0,
        "seller_shipping_cost": 0,
    }


def _mes(marca, mes=OUT26, linhas=31, settlement=None, settlement_n=0):
    """Uma linha de `SQL_SHOPEE_TAXA_MES`: taxa anulada; repasse do mart opcional."""
    return {"mes": mes, "marca": marca, "dias": linhas, "linhas": linhas,
            "fees": None, "fees_n": 0, "fees_neg_n": 0,
            "settlement": settlement, "settlement_n": settlement_n}


def _insumo(marca, valor, com, pedidos, mes=OUT26, componente="shopee_repasse_escrow", publicado_em=None,
            lote_status="success", sinal=None):
    return {
        "competencia": mes, "canal": "shopee", "marca": marca, "componente": componente,
        "valor": valor, "sinal_origem": sinal, "cobertura": com / pedidos, "provisorio_share": None,
        "status_reconciliacao": "nao_avaliado",
        "motivo": f"escrow_amount, antes de ajustes posteriores; escrow em {com} de {pedidos} pedidos nao cancelados",
        "data_max_origem": None, "publicado_em": publicado_em or datetime.now(timezone.utc) - timedelta(hours=2),
        "lote_id": "lote-1", "lote_status": lote_status,
    }


def _todos(completo=False):
    return [_insumo(m, v, p if completo else c, p) for m, (_g, v, c, p) in OUT26_REPASSE.items()]


def _get(insumos, rows=None, meses=None, period=None):
    rows = rows if rows is not None else [_fato(m, g) for m, (g, *_r) in OUT26_REPASSE.items()]
    meses = meses if meses is not None else [_mes(r["brand_key"]) for r in rows]
    db = FinanceiroSession(rows, OUT26, insumos=insumos, meses=meses)
    return perf_svc.get_financeiro(db, "shopee", 2026, 10, period=period), db


def _marca(res, brand):
    return next(b for b in res["brands"] if b["brand"] == brand)


def test_repasse_completo_por_marca_vem_do_insumo():
    res, _ = _get(_todos(completo=True))
    for marca, (gmv, repasse, _c, _p) in OUT26_REPASSE.items():
        linha = _marca(res, marca)
        assert linha["shopee_settlement"] == repasse, marca
        assert linha["shopee_avg_settlement_pct"] == round(repasse / gmv * 100, 2), marca
        assert linha["shopee_settlement_status"] == "completa", marca
    k = res["kpis"]
    assert abs(k["shopee_settlement"] - sum(v for _g, v, _c, _p in OUT26_REPASSE.values())) < 0.01
    c = k["shopee_settlement_cobertura"]
    assert c["status"] == "completa" and (c["marcas_com_dado"], c["marcas_total"]) == (5, 5)
    assert c["marcas_parciais"] == [] and c["marcas_sem_dado"] == []
    FinanceiroResponse.model_validate(res)


def test_repasse_parcial_quando_o_escrow_nao_cobre_todos_os_pedidos():
    res, _ = _get(_todos())
    assert _marca(res, "kokeshi")["shopee_settlement"] == 2_296_007.01
    assert _marca(res, "kokeshi")["shopee_settlement_status"] == "parcial"
    c = res["kpis"]["shopee_settlement_cobertura"]
    assert c["status"] == "parcial"
    assert c["marcas_parciais"] == ["apice", "barbours", "kokeshi", "lescent", "rituaria"]
    assert c["marcas_sem_dado"] == []
    # o contrato da resposta publica marcas_parciais na cobertura
    validado = FinanceiroResponse.model_validate(res)
    assert validado.kpis.shopee_settlement_cobertura.marcas_parciais == c["marcas_parciais"]


def test_sem_componente_publicado_continua_sem_fonte():
    """So' a taxa publicada (antes da 048): repasse "—", como hoje."""
    taxa = [_insumo(m, 1.0, c, p, componente="shopee_taxa_escrow", sinal=1)
            for m, (_g, _v, c, p) in OUT26_REPASSE.items()]
    res, _ = _get(taxa)
    for marca in OUT26_REPASSE:
        linha = _marca(res, marca)
        assert linha["shopee_settlement"] is None and linha["shopee_avg_settlement_pct"] is None, marca
        assert linha["shopee_settlement_status"] == "sem_dado"
    assert res["kpis"]["shopee_settlement"] is None
    assert res["kpis"]["shopee_settlement_cobertura"]["status"] == "sem_dado"
    # a taxa nao foi afetada
    assert _marca(res, "apice")["shopee_fees"] == 1.0


def test_tabela_de_insumos_ausente_nao_derruba():
    res, _ = _get(None)
    assert _marca(res, "apice")["shopee_settlement"] is None
    assert res["kpis"]["shopee_settlement_cobertura"]["status"] == "sem_dado"


def test_mes_cortado_pelo_periodo_nao_usa_o_escrow():
    periodo = EffectivePeriod(start=date(2026, 10, 1), end=date(2026, 10, 15), ref_month="2026-10")
    res, db = _get(_todos(completo=True), period=periodo)
    assert all(_marca(res, m)["shopee_settlement"] is None for m in OUT26_REPASSE)
    assert not any("fact_dre_insumo_mensal" in s for s in db.sqls)


def test_repasse_negativo_publicado_e_aceito():
    res, _ = _get([_insumo("apice", -150.0, 10, 10)], rows=[_fato("apice", 645_673.0)])
    assert _marca(res, "apice")["shopee_settlement"] == -150.0
    assert _marca(res, "apice")["shopee_settlement_status"] == "completa"


def test_mart_com_repasse_em_todas_as_linhas_tem_precedencia():
    """Regra 1 da taxa: mart cheio -> mart, mesmo com escrow publicado."""
    rows = [_fato("kokeshi", 3_800_202.69, total_settlement=2_100_000.0)]
    meses = [_mes("kokeshi", settlement=2_100_000.0, settlement_n=31)]
    res, _ = _get(_todos(completo=True), rows=rows, meses=meses)
    assert _marca(res, "kokeshi")["shopee_settlement"] == 2_100_000.0
    assert _marca(res, "kokeshi")["shopee_settlement_status"] == "completa"


def test_sem_componente_o_repasse_do_mart_continua_como_hoje():
    """Marca sem `shopee_repasse_escrow` publicado: soma da fato no periodo, como antes."""
    rows = [_fato("apice", 645_673.0, total_settlement=100_000.0)]
    meses = [_mes("apice", settlement=100_000.0, settlement_n=10)]
    res, _ = _get([], rows=rows, meses=meses)
    assert _marca(res, "apice")["shopee_settlement"] == 100_000.0


def test_mart_parcial_com_componente_sem_valor_no_mes_sai_parcial():
    """Componente publicado como ausente (sem pedido com escrow): o mart parcial vale, `parcial`."""
    rows = [_fato("apice", 645_673.0, total_settlement=100_000.0)]
    meses = [_mes("apice", settlement=100_000.0, settlement_n=10)]
    ausente = _insumo("apice", None, 0, 1)
    ausente.update(cobertura=None, status_reconciliacao="ausente_na_origem")
    res, _ = _get([ausente], rows=rows, meses=meses)
    assert _marca(res, "apice")["shopee_settlement"] == 100_000.0
    assert _marca(res, "apice")["shopee_settlement_status"] == "parcial"


def test_insumo_vencido_lote_falho_ou_sinal_inesperado_nao_e_usado():
    velho = datetime.now(timezone.utc) - timedelta(days=10)
    insumos = [_insumo("apice", 423_257.41, 8121, 8168, publicado_em=velho),
               _insumo("barbours", 555_641.50, 11068, 11111, lote_status="failed"),
               _insumo("lescent", 174_769.65, 3999, 4013, sinal=1)]
    rows = [_fato("apice", 645_673.0), _fato("barbours", 862_664.44), _fato("lescent", 290_581.67)]
    res, _ = _get(insumos, rows=rows)
    for marca in ("apice", "barbours", "lescent"):
        assert _marca(res, marca)["shopee_settlement"] is None, marca
        assert _marca(res, marca)["shopee_settlement_status"] == "sem_dado", marca


def test_dois_meses_um_sem_repasse_fica_nulo_nunca_soma_parcial():
    meses = [_mes("apice", mes=SET26, linhas=30), _mes("apice")]
    periodo = EffectivePeriod(start=SET26, end=date(2026, 10, 31), ref_month="2026-10")
    res, _ = _get([_insumo("apice", 423_257.41, 8121, 8168)], rows=[_fato("apice", 1_200_000.0)],
                  meses=meses, period=periodo)
    assert _marca(res, "apice")["shopee_settlement"] is None, "setembro sem repasse: nao soma so' outubro"
    assert _marca(res, "apice")["shopee_settlement_status"] == "sem_dado"


def test_dois_meses_inteiros_com_repasse_somam():
    meses = [_mes("apice", mes=SET26, linhas=30), _mes("apice")]
    insumos = [_insumo("apice", 400_000.0, 10, 10, mes=SET26), _insumo("apice", 423_257.41, 10, 10)]
    periodo = EffectivePeriod(start=SET26, end=date(2026, 10, 31), ref_month="2026-10")
    res, _ = _get(insumos, rows=[_fato("apice", 1_200_000.0)], meses=meses, period=periodo)
    assert _marca(res, "apice")["shopee_settlement"] == 823_257.41


def _get_rota(insumos, rows=None, meses=None):
    """T-0124: chama a ROTA `/financeiro` (passa pelo `response_model`) com o dublê."""
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app

    rows = rows if rows is not None else [_fato(m, g) for m, (g, *_r) in OUT26_REPASSE.items()]
    meses = meses if meses is not None else [_mes(r["brand_key"]) for r in rows]
    db = FinanceiroSession(rows, OUT26, insumos=insumos, meses=meses)
    app.dependency_overrides[get_db] = lambda: db
    try:
        r = TestClient(app).get("/api/v1/performance/financeiro",
                                params={"channels": "shopee", "ref_month": "2026-10"})
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert r.status_code == 200, r.text
    return r.json()


def _marca_json(body, brand):
    return next(b for b in body["brands"] if b["brand"] == brand)


def test_rota_publica_status_do_repasse_e_aviso_do_escrow():
    """T-0124: `shopee_settlement_status` e o aviso sobrevivem ao `response_model`."""
    body = _get_rota(_todos())
    assert _marca_json(body, "kokeshi")["shopee_settlement"] == 2_296_007.01
    assert _marca_json(body, "kokeshi")["shopee_settlement_status"] == "parcial"
    assert body["kpis"]["shopee_settlement_aviso"] == perf_svc.AVISO_REPASSE_SHOPEE_ESCROW
    assert "escrow_amount" in body["kpis"]["shopee_settlement_aviso"]


def test_rota_completa_pelo_escrow_tambem_avisa():
    body = _get_rota(_todos(completo=True))
    assert all(_marca_json(body, m)["shopee_settlement_status"] == "completa" for m in OUT26_REPASSE)
    assert body["kpis"]["shopee_settlement_aviso"] == perf_svc.AVISO_REPASSE_SHOPEE_ESCROW


def test_rota_sem_repasse_do_escrow_nao_avisa():
    """Repasse do mart (sem componente publicado) ou sem dado: aviso nulo."""
    rows = [_fato("apice", 645_673.0, total_settlement=100_000.0)]
    meses = [_mes("apice", settlement=100_000.0, settlement_n=31)]
    body = _get_rota([], rows=rows, meses=meses)
    assert _marca_json(body, "apice")["shopee_settlement"] == 100_000.0
    assert _marca_json(body, "apice")["shopee_settlement_status"] == "completa"
    assert body["kpis"]["shopee_settlement_aviso"] is None
    # mart cheio tem precedencia sobre o escrow publicado: tambem sem aviso
    body = _get_rota(_todos(completo=True), rows=[_fato("kokeshi", 3_800_202.69, total_settlement=2_100_000.0)],
                     meses=[_mes("kokeshi", settlement=2_100_000.0, settlement_n=31)])
    assert _marca_json(body, "kokeshi")["shopee_settlement"] == 2_100_000.0
    assert body["kpis"]["shopee_settlement_aviso"] is None
    # sem nenhum repasse: "—" e sem aviso
    body = _get_rota(None)
    assert _marca_json(body, "apice")["shopee_settlement_status"] == "sem_dado"
    assert body["kpis"]["shopee_settlement_aviso"] is None


def test_sql_do_mes_le_o_repasse_do_mart():
    sql = " ".join(str(perf_svc.SQL_SHOPEE_TAXA_MES).split())
    assert "SUM(f.total_settlement) AS settlement" in sql
    assert "COUNT(f.total_settlement) AS settlement_n" in sql
