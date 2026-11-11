"""
T-0085 — no `/financeiro`, ausência de taxa/repasse não vira 0 nem dilui o total.

Caso real (Shopee, out/26): só a kokeshi tinha `total_fees`; apice, barbours,
lescent e rituaria vinham com fees/settlement nulos e `*_avg_*_pct` = 0,0. O
consolidado dividia a taxa da kokeshi pelo GMV das 5 marcas e dava 16,1%,
com a taxa real da kokeshi em 25,27%.

Trava-se aqui:

  * por marca: valor-base nulo -> % nulo;
  * consolidado: Σ base (marcas COM dado) ÷ Σ GMV (das MESMAS marcas);
  * cobertura publicada com o %: marcas_com_dado, marcas_total, status;
  * a mesma regra vale para TikTok e ML.
"""
from __future__ import annotations

from app.schemas.performance import FinanceiroResponse
from app.services import performance_service as perf_svc

TIKTOK_ID, ML_ID, SHOPEE_ID = 1, 2, 3


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return list(self._rows)


class FakeSession:
    """Linhas como `.mappings().all()` devolve: dicionários por nome de coluna."""

    def __init__(self, rows):
        self._rows = rows

    def execute(self, stmt, params=None):
        return _Rows(self._rows)


def _linha(brand, mkt, gmv, total_fees=None, total_settlement=None):
    # A fato chega com COALESCE(SUM(...), 0): ausência é 0 na linha do SQL.
    return {
        "brand_key": brand, "marketplace_id": mkt, "gmv": gmv,
        "total_settlement": total_settlement or 0, "total_fees": total_fees or 0,
        "ad_spend": 0, "ad_revenue": 0, "ad_clicks": 0, "ad_impressions": 0,
        "seller_shipping_cost": 0,
    }


#: Shopee out/26, em escala: só a kokeshi tem taxa e repasse.
SHOPEE_OUT26 = [
    _linha("kokeshi", SHOPEE_ID, 3_850_000.0, total_fees=972_946.0, total_settlement=3_700_708.0),
    _linha("apice", SHOPEE_ID, 600_000.0),
    _linha("barbours", SHOPEE_ID, 700_000.0),
    _linha("lescent", SHOPEE_ID, 400_000.0),
    _linha("rituaria", SHOPEE_ID, 490_000.0),
]


def _financeiro(rows):
    return perf_svc.get_financeiro(FakeSession(rows), "all", 2026, 10)


def _marca(res, brand):
    return next(b for b in res["brands"] if b["brand"] == brand)


# ---------------------------------------------------------------------------
# Por marca
# ---------------------------------------------------------------------------

def test_marca_sem_fees_tem_pct_nulo_e_nao_zero():
    res = _financeiro(SHOPEE_OUT26)
    for brand in ("apice", "barbours", "lescent", "rituaria"):
        linha = _marca(res, brand)
        assert linha["shopee_fees"] is None and linha["shopee_avg_fee_pct"] is None, brand
        assert linha["shopee_settlement"] is None and linha["shopee_avg_settlement_pct"] is None, brand
        assert linha["shopee_gmv"] is not None, "o GMV continua medido"


def test_marca_com_fees_mantem_o_pct():
    linha = _marca(_financeiro(SHOPEE_OUT26), "kokeshi")
    assert linha["shopee_avg_fee_pct"] == 25.27
    assert linha["shopee_avg_settlement_pct"] == 96.12


# ---------------------------------------------------------------------------
# Consolidado
# ---------------------------------------------------------------------------

def test_consolidado_divide_so_pelo_gmv_das_marcas_com_dado():
    k = _financeiro(SHOPEE_OUT26)["kpis"]
    # antes: 972.946 ÷ 6.040.000 = 16,11% (diluído)
    assert k["shopee_avg_fee_pct"] == 25.27
    # antes: 3.700.708 ÷ 6.040.000 = 61,27% (diluído)
    assert k["shopee_avg_settlement_pct"] == 96.12
    assert k["shopee_gmv"] == 6_040_000.0, "o GMV do canal continua cheio"
    assert k["shopee_fees"] == 972_946.0


def test_consolidado_publica_cobertura_parcial():
    k = _financeiro(SHOPEE_OUT26)["kpis"]
    assert k["shopee_fee_cobertura"] == {
        "status": "parcial", "marcas_com_dado": 1, "marcas_total": 5,
        "marcas_sem_dado": ["apice", "barbours", "lescent", "rituaria"],
    }
    assert k["shopee_settlement_cobertura"]["marcas_com_dado"] == 1


def test_consolidado_com_duas_marcas_medidas_pondera_pelo_gmv_delas():
    rows = [
        _linha("kokeshi", SHOPEE_ID, 1_000_000.0, total_fees=250_000.0),
        _linha("lescent", SHOPEE_ID, 1_000_000.0, total_fees=150_000.0),
        _linha("apice", SHOPEE_ID, 2_000_000.0),
    ]
    k = _financeiro(rows)["kpis"]
    assert k["shopee_avg_fee_pct"] == 20.0  # 400k ÷ 2 mi, não ÷ 4 mi
    assert k["shopee_fee_cobertura"]["status"] == "parcial"
    assert (k["shopee_fee_cobertura"]["marcas_com_dado"], k["shopee_fee_cobertura"]["marcas_total"]) == (2, 3)


def test_cobertura_completa_e_sem_dado():
    completa = _financeiro([_linha("kokeshi", SHOPEE_ID, 1_000.0, total_fees=250.0)])["kpis"]
    assert completa["shopee_fee_cobertura"]["status"] == "completa"
    vazia = _financeiro([_linha("apice", SHOPEE_ID, 1_000.0)])["kpis"]
    assert vazia["shopee_avg_fee_pct"] is None
    assert vazia["shopee_fee_cobertura"]["status"] == "sem_dado"
    assert vazia["shopee_fee_cobertura"]["marcas_com_dado"] == 0


def test_canal_sem_gmv_nao_tem_cobertura():
    k = _financeiro([_linha("kokeshi", SHOPEE_ID, 1_000.0, total_fees=250.0)])["kpis"]
    assert k["ml_fee_cobertura"] is None and k["tiktok_fee_cobertura"] is None


# ---------------------------------------------------------------------------
# A mesma regra em TikTok e ML
# ---------------------------------------------------------------------------

def test_tiktok_marca_sem_fees_nao_vira_zero_nem_dilui():
    rows = [
        _linha("kokeshi", TIKTOK_ID, 1_000_000.0, total_fees=-300_000.0, total_settlement=650_000.0),
        _linha("apice", TIKTOK_ID, 1_000_000.0),
    ]
    res = _financeiro(rows)
    apice = _marca(res, "apice")
    assert apice["tiktok_avg_fee_pct"] is None and apice["tiktok_avg_settlement_pct"] is None
    k = res["kpis"]
    assert k["tiktok_avg_fee_pct"] == 30.0  # antes: 15,0
    assert k["tiktok_avg_settlement_pct"] == 65.0  # antes: 32,5
    assert k["tiktok_fee_cobertura"]["status"] == "parcial"
    assert k["tiktok_settlement_cobertura"]["marcas_sem_dado"] == ["apice"]


def test_ml_consolidado_nao_dilui_pela_marca_sem_tarifa():
    rows = [
        _linha("kokeshi", ML_ID, 1_000_000.0, total_fees=170_000.0),
        _linha("barbours", ML_ID, 1_000_000.0),
    ]
    k = _financeiro(rows)["kpis"]
    assert k["ml_avg_fee_pct"] == 17.0  # antes: 8,5
    assert k["ml_fee_cobertura"]["marcas_sem_dado"] == ["barbours"]


# ---------------------------------------------------------------------------
# Contrato
# ---------------------------------------------------------------------------

def test_schema_publica_a_cobertura_e_aceita_pct_nulo():
    validado = FinanceiroResponse.model_validate(_financeiro(SHOPEE_OUT26))
    assert validado.kpis.shopee_fee_cobertura is not None
    assert validado.kpis.shopee_fee_cobertura.marcas_com_dado == 1
    assert validado.kpis.shopee_fee_cobertura.marcas_total == 5
    apice = next(b for b in validado.brands if b.brand == "apice")
    assert apice.shopee_avg_fee_pct is None
