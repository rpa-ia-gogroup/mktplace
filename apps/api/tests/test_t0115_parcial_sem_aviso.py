"""
T-0115 — "parcial sem aviso" (VAL-B1 B1-07/B1-08, VAL-A1 A1-12/A1-14).

B1-07: em nov/26 o repasse por pedido do TikTok nao tinha chegado para
BARBOURS e LESCENT (taxa 0,01% e 0,00% do GMV) e o Financeiro dizia
`tiktok_fee_cobertura = completa (5 de 5)`; o /canais publicava custo 0,0%
com `marketplace_cost_available true`, e o 9,1% imaturo da RITUARIA virava
"custo alto".

B1-08: o Ads Shopee de nov so' tinha a KOKESHI; o total e o ROAS saiam como
o do canal, sem "parcial", e as outras 4 marcas sem `ads_missing_reason`.

Limiar (constante no servico): repasse < 30% do GMV = maturando (taxa e
repasse saem); taxa < 1% do GMV = implausivel (so' a taxa sai).
"""
from __future__ import annotations

from app.schemas.performance import FinanceiroResponse, KpiSummary
from app.services import performance_service as perf_svc

TIKTOK_ID, ML_ID, SHOPEE_ID = 1, 2, 3


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None


class FakeSession:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, stmt, params=None):
        return _Rows(self._rows)


def _fin(brand, mkt, gmv, fees=0.0, settlement=0.0, ad_spend=0.0, ad_revenue=0.0):
    return {
        "brand_key": brand, "marketplace_id": mkt, "gmv": gmv,
        "total_settlement": settlement, "total_fees": fees,
        "ad_spend": ad_spend, "ad_revenue": ad_revenue, "ad_clicks": 0, "ad_impressions": 0,
        "seller_shipping_cost": 0,
    }


#: TikTok nov/26 (escala): 3 marcas maduras, BARBOURS e LESCENT sem repasse.
TIKTOK_NOV = [
    _fin("apice", TIKTOK_ID, 1_000_000.0, fees=-300_000.0, settlement=670_000.0),
    _fin("kokeshi", TIKTOK_ID, 2_000_000.0, fees=-620_000.0, settlement=1_340_000.0),
    _fin("rituaria", TIKTOK_ID, 500_000.0, fees=-150_000.0, settlement=330_000.0),
    _fin("barbours", TIKTOK_ID, 900_000.0, fees=-106.69, settlement=-97.74),
    _fin("lescent", TIKTOK_ID, 400_000.0, fees=-30.45, settlement=-37.11),
]

#: Shopee nov/26: so' a KOKESHI tem Ads.
SHOPEE_NOV = [
    _fin("kokeshi", SHOPEE_ID, 2_224_232.90, ad_spend=84_864.07, ad_revenue=1_147_362.0),
    _fin("apice", SHOPEE_ID, 529_808.75),
    _fin("barbours", SHOPEE_ID, 815_888.62),
    _fin("lescent", SHOPEE_ID, 211_634.50),
    _fin("rituaria", SHOPEE_ID, 265_910.20),
]


def _financeiro(rows):
    return perf_svc.get_financeiro(FakeSession(rows), "all", 2026, 11)


def _marca(res, brand):
    return next(b for b in res["brands"] if b["brand"] == brand)


# ---------------------------------------------------------------------------
# B1-07 — Financeiro TikTok
# ---------------------------------------------------------------------------

def test_b107_marca_com_repasse_imaturo_nao_publica_taxa_real():
    res = _financeiro(TIKTOK_NOV)
    for brand in ("barbours", "lescent"):
        linha = _marca(res, brand)
        assert linha["tiktok_avg_fee_pct"] is None, brand  # antes: 0,01 / 0,0
        assert linha["tiktok_avg_settlement_pct"] is None, brand
        assert linha["tiktok_fees"] is None and linha["tiktok_settlement"] is None, brand
        assert linha["tiktok_repasse_status"] == "maturando", brand
        assert linha["tiktok_gmv"] is not None, "o GMV continua medido"
    assert _marca(res, "apice")["tiktok_repasse_status"] == "maduro"
    assert _marca(res, "apice")["tiktok_avg_fee_pct"] == 30.0


def test_b107_consolidado_sai_do_numerador_e_do_denominador_e_declara_parcial():
    k = _financeiro(TIKTOK_NOV)["kpis"]
    # 1.070.000 / 3.500.000 (so' as 3 maduras); antes: ÷ 4.800.000 com 5 de 5.
    assert k["tiktok_avg_fee_pct"] == 30.57
    assert k["tiktok_avg_settlement_pct"] == 66.86
    assert k["tiktok_fees"] == 1_070_000.0
    assert k["tiktok_fee_cobertura"] == {
        "status": "parcial", "marcas_com_dado": 3, "marcas_total": 5,
        "marcas_sem_dado": ["barbours", "lescent"],
        "marcas_maturando": ["barbours", "lescent"],
    }
    assert k["tiktok_settlement_cobertura"]["status"] == "parcial"
    assert k["tiktok_settlement_cobertura"]["marcas_sem_dado"] == ["barbours", "lescent"]


def test_b107_repasse_maduro_com_taxa_implausivel_tira_so_a_taxa():
    rows = [_fin("apice", TIKTOK_ID, 1_000_000.0, fees=-5_000.0, settlement=900_000.0)]
    linha = _marca(_financeiro(rows), "apice")
    assert linha["tiktok_avg_fee_pct"] is None  # 0,5% < 1%
    assert linha["tiktok_avg_settlement_pct"] == 90.0
    assert linha["tiktok_repasse_status"] == "maduro"


def test_b107_limiar_de_30_por_cento_e_inclusivo():
    no_limiar = [_fin("apice", TIKTOK_ID, 1_000.0, fees=-300.0, settlement=300.0)]
    assert _marca(_financeiro(no_limiar), "apice")["tiktok_repasse_status"] == "maduro"
    abaixo = [_fin("apice", TIKTOK_ID, 1_000.0, fees=-300.0, settlement=299.0)]
    assert _marca(_financeiro(abaixo), "apice")["tiktok_repasse_status"] == "maturando"


def test_b107_schema_publica_maturando():
    v = FinanceiroResponse.model_validate(_financeiro(TIKTOK_NOV))
    assert v.kpis.tiktok_fee_cobertura.marcas_maturando == ["barbours", "lescent"]
    assert next(b for b in v.brands if b.brand == "lescent").tiktok_repasse_status == "maturando"


# ---------------------------------------------------------------------------
# B1-08 — Financeiro Shopee Ads
# ---------------------------------------------------------------------------

def test_b108_ads_shopee_declara_parcial_com_as_marcas_sem_ads():
    k = _financeiro(SHOPEE_NOV)["kpis"]
    assert k["shopee_ad_spend"] == 84_864.07  # so' as marcas com Ads
    assert k["shopee_roas"] == 13.52
    assert k["shopee_ads_cobertura"] == {
        "status": "parcial", "marcas_com_dado": 1, "marcas_total": 5,
        "marcas_sem_dado": ["apice", "barbours", "lescent", "rituaria"],
    }


def test_b108_roas_ignora_receita_de_marca_sem_investimento():
    rows = [
        _fin("kokeshi", SHOPEE_ID, 1_000.0, ad_spend=100.0, ad_revenue=1_000.0),
        _fin("apice", SHOPEE_ID, 1_000.0, ad_revenue=5_000.0),
    ]
    res = _financeiro(rows)
    assert res["kpis"]["shopee_roas"] == 10.0  # antes: 60,0
    assert _marca(res, "apice")["shopee_ad_revenue"] is None


def test_b108_schema_financeiro_publica_shopee_ads_cobertura():
    v = FinanceiroResponse.model_validate(_financeiro(SHOPEE_NOV))
    assert v.kpis.shopee_ads_cobertura is not None
    assert v.kpis.shopee_ads_cobertura.status == "parcial"


# ---------------------------------------------------------------------------
# A1-12 / A1-14 — /canais
# ---------------------------------------------------------------------------

def _canal(brand, mkt, gmv, fees=0.0, settlement=0.0, ad_spend=None, ad_revenue=0.0):
    return {
        "gmv": gmv, "orders": 100,
        "ad_spend": ad_spend or 0, "ad_revenue": ad_revenue,
        "ad_spend_n": 12 if ad_spend else 0,
        "total_fees": fees, "total_fees_n": 12,
        "total_settlement": settlement,
        "seller_shipping_cost": 0, "seller_shipping_cost_n": 0,
    }


#: /canais nov/26: custo TikTok imaturo em todas as marcas (repasse < 30%).
CANAIS_NOV = {
    "barbours": {TIKTOK_ID: _canal("barbours", TIKTOK_ID, 900_000.0, fees=-106.69, settlement=-97.74)},
    "lescent": {TIKTOK_ID: _canal("lescent", TIKTOK_ID, 400_000.0, fees=-30.45, settlement=-37.11)},
    "apice": {TIKTOK_ID: _canal("apice", TIKTOK_ID, 1_000_000.0, fees=-44_000.0, settlement=150_000.0)},
    "kokeshi": {TIKTOK_ID: _canal("kokeshi", TIKTOK_ID, 2_000_000.0, fees=-98_000.0, settlement=300_000.0)},
    "rituaria": {TIKTOK_ID: _canal("rituaria", TIKTOK_ID, 500_000.0, fees=-45_500.0, settlement=100_000.0)},
}


def test_a112_canais_custo_tiktok_imaturo_fica_indisponivel_e_sem_custo_alto():
    rows, medians = perf_svc._build_channel_rows(CANAIS_NOV)
    for r in rows:
        assert r["marketplace_cost_available"] is False, r["brand"]  # antes: True com 0,0%
        assert r["marketplace_cost_pct"] is None, r["brand"]
        assert "custo_alto" not in r["signals"], r["brand"]  # antes: RITUARIA 9,1%
        assert "sem_dado" in r["signals"], r["brand"]
        assert r["data_warning"] == perf_svc._TIKTOK_COST_MATURANDO_WARNING
    tk = next(m for m in medians if m["channel"] == "tiktok")
    assert tk["marketplace_cost_pct_median"] is None and tk["marketplace_cost_pct_p75"] is None


def test_a112_canais_custo_tiktok_maduro_segue_disponivel():
    rows, _ = perf_svc._build_channel_rows({
        "apice": {TIKTOK_ID: _canal("apice", TIKTOK_ID, 1_000_000.0, fees=-300_000.0, settlement=670_000.0)},
    })
    assert rows[0]["marketplace_cost_available"] is True
    assert rows[0]["marketplace_cost_pct"] == 30.0
    assert rows[0]["data_warning"] == perf_svc._TIKTOK_COST_WARNING


def test_a114_canais_shopee_sem_ads_tem_motivo():
    rows, _ = perf_svc._build_channel_rows({
        "kokeshi": {SHOPEE_ID: _canal("kokeshi", SHOPEE_ID, 2_000_000.0, fees=0, ad_spend=84_864.07, ad_revenue=1_147_362.0)},
        "apice": {SHOPEE_ID: _canal("apice", SHOPEE_ID, 500_000.0, fees=0)},
    })
    apice = next(r for r in rows if r["brand"] == "apice")
    kokeshi = next(r for r in rows if r["brand"] == "kokeshi")
    assert apice["ad_spend"] is None
    assert apice["ads_missing_reason"] == perf_svc._SHOPEE_ADS_MISSING_REASON  # antes: None
    assert kokeshi["ads_missing_reason"] is None


def test_a112_sql_do_canais_le_o_repasse():
    class _Captura(FakeSession):
        def __init__(self):
            super().__init__([])
            self.sql: list[str] = []

        def execute(self, stmt, params=None):
            self.sql.append(str(stmt))
            return _Rows([])

    db = _Captura()
    perf_svc.get_canais(db, "all", 2026, 11)
    assert any("SUM(f.total_settlement)" in s for s in db.sql)


# ---------------------------------------------------------------------------
# A1-14 — /overview
# ---------------------------------------------------------------------------

class _OverviewSession:
    """Responde o agregado por canal e a consulta de cobertura do Ads Shopee."""

    def __init__(self, por_canal, por_marca_shopee):
        self.por_canal = por_canal
        self.por_marca_shopee = por_marca_shopee

    def execute(self, stmt, params=None):
        t = str(stmt)
        if "shopee_ads_cobertura" in t:
            return _Rows(self.por_marca_shopee)
        if "GROUP BY f.marketplace_id" in t:
            return _Rows(self.por_canal)
        return _Rows([])


def test_a114_overview_declara_ads_shopee_parcial():
    db = _OverviewSession(
        [{"marketplace_id": SHOPEE_ID, "gmv": 4_047_474.97, "orders": 1000, "canceled_orders": 0,
          "unique_buyers": 0, "ad_spend": 84_864.07, "ad_revenue": 1_147_362.0}],
        [
            {"brand_key": "kokeshi", "gmv": 2_224_232.90, "ad_spend": 84_864.07},
            {"brand_key": "apice", "gmv": 529_808.75, "ad_spend": 0},
            {"brand_key": "barbours", "gmv": 815_888.62, "ad_spend": 0},
            {"brand_key": "lescent", "gmv": 211_634.50, "ad_spend": 0},
            {"brand_key": "rituaria", "gmv": 265_910.20, "ad_spend": 0},
        ],
    )
    res = perf_svc.get_overview(db, "all", 2026, 11)
    cob = res["current"]["shopee_ads_cobertura"]
    assert cob["status"] == "parcial"
    assert (cob["marcas_com_dado"], cob["marcas_total"]) == (1, 5)
    assert cob["marcas_sem_dado"] == ["apice", "barbours", "lescent", "rituaria"]
    assert KpiSummary.model_validate(res["current"]).shopee_ads_cobertura.status == "parcial"


def test_a114_overview_sem_shopee_no_filtro_nao_consulta_cobertura():
    db = _OverviewSession([], [{"brand_key": "kokeshi", "gmv": 1.0, "ad_spend": 1.0}])
    res = perf_svc.get_overview(db, "ml", 2026, 11)
    assert res["current"]["shopee_ads_cobertura"] is None
