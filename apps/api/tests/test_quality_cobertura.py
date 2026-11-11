"""
T-0088 (C2-01) — no `/quality`, devolução Shopee ausente não vira 0 nem dilui o consolidado.

Caso real (Shopee, out/26): só a kokeshi tinha `returned_orders` (260 em 69.073
pedidos); apice, barbours, lescent e rituaria vinham com `shopee_returned_orders`
nulo e `shopee_return_rate_pct` = 0,0. O consolidado dividia as 260 devoluções
pelos 95.945 pedidos das 5 marcas e dava 0,27%, com a taxa real da kokeshi em 0,38%.

Trava-se aqui (mesmo contrato da T-0085 no Financeiro):

  * por marca: devolução nula -> % nulo;
  * consolidado: Σ devolvidos (marcas COM dado) ÷ Σ pedidos (das MESMAS marcas);
  * cobertura publicada com o %: marcas_com_dado, marcas_total, status;
  * o cancelamento continua com cancelados ÷ (pedidos + cancelados) de todas as marcas.
"""
from __future__ import annotations

import pytest

from app.schemas.performance import QualityResponse
from app.services import performance_service as perf_svc

SHOPEE_ID = 3


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


@pytest.fixture(autouse=True)
def _sem_scope_quality(monkeypatch):
    # O selo de Produtos Shopee e' outra fonte e outra query; fora do escopo aqui.
    monkeypatch.setattr(perf_svc, "get_shopee_scope_quality", lambda *a, **k: None)


def _linha(brand, orders, returned=0, canceled=0):
    # A fato chega com COALESCE(SUM(...), 0): ausência é 0 na linha do SQL.
    return {
        "brand_key": brand, "marketplace_id": SHOPEE_ID,
        "orders": orders, "canceled_orders": canceled, "returned_orders": returned,
        "delivered_orders": 0, "unique_buyers": 0, "new_buyers": 0, "repeat_buyers": 0,
        "gmv": 0, "seller_shipping_cost": 0,
        "avg_delivery_days": None, "avg_delivery_hours": None, "problem_rate": None,
    }


#: Shopee out/26, medido em produção: só a kokeshi tem devolução.
SHOPEE_OUT26 = [
    _linha("apice", 8_169),
    _linha("barbours", 11_112),
    _linha("kokeshi", 69_073, returned=260),
    _linha("lescent", 4_013),
    _linha("rituaria", 3_578),
]


def _quality(rows):
    return perf_svc.get_quality(FakeSession(rows), "shopee", 2026, 10)


def _marca(res, brand):
    return next(b for b in res["brands"] if b["brand"] == brand)


# ---------------------------------------------------------------------------
# Por marca
# ---------------------------------------------------------------------------

def test_marca_sem_devolucao_tem_pct_nulo_e_nao_zero():
    res = _quality(SHOPEE_OUT26)
    for brand in ("apice", "barbours", "lescent", "rituaria"):
        linha = _marca(res, brand)
        assert linha["shopee_returned_orders"] is None, brand
        assert linha["shopee_return_rate_pct"] is None, brand
        assert linha["shopee_orders"] is not None, "os pedidos continuam medidos"


def test_marca_com_devolucao_mantem_o_pct():
    linha = _marca(_quality(SHOPEE_OUT26), "kokeshi")
    assert linha["shopee_returned_orders"] == 260
    assert linha["shopee_return_rate_pct"] == 0.38


# ---------------------------------------------------------------------------
# Consolidado
# ---------------------------------------------------------------------------

def test_consolidado_divide_so_pelos_pedidos_das_marcas_com_dado():
    k = _quality(SHOPEE_OUT26)["kpis"]
    # antes: 260 ÷ 95.945 = 0,27% (diluído)
    assert k["shopee_return_rate_pct"] == 0.38


def test_consolidado_publica_cobertura_parcial_1_de_5():
    k = _quality(SHOPEE_OUT26)["kpis"]
    assert k["shopee_return_cobertura"] == {
        "status": "parcial", "marcas_com_dado": 1, "marcas_total": 5,
        "marcas_sem_dado": ["apice", "barbours", "lescent", "rituaria"],
    }


def test_todas_as_marcas_com_dado_nada_muda():
    rows = [
        _linha("kokeshi", 10_000, returned=40),
        _linha("apice", 5_000, returned=10),
    ]
    k = _quality(rows)["kpis"]
    # Igual à regra antiga: Σ devolvidos ÷ Σ pedidos de todas = 50 ÷ 15.000.
    assert k["shopee_return_rate_pct"] == round(50 / 15_000 * 100, 2) == 0.33
    assert k["shopee_return_cobertura"]["status"] == "completa"
    assert (k["shopee_return_cobertura"]["marcas_com_dado"], k["shopee_return_cobertura"]["marcas_total"]) == (2, 2)
    assert k["shopee_return_cobertura"]["marcas_sem_dado"] == []


def test_nenhuma_marca_com_dado_consolidado_nulo():
    k = _quality([_linha("apice", 8_169), _linha("lescent", 4_013)])["kpis"]
    assert k["shopee_return_rate_pct"] is None
    assert k["shopee_return_cobertura"]["status"] == "sem_dado"
    assert k["shopee_return_cobertura"]["marcas_com_dado"] == 0


def test_cancelamento_nao_muda():
    # Regra correta, fora do defeito: cancelados ÷ (pedidos + cancelados), todas as marcas.
    rows = [
        _linha("kokeshi", 69_073, returned=260, canceled=500),
        _linha("apice", 8_169, canceled=100),
    ]
    k = _quality(rows)["kpis"]
    assert k["shopee_cancel_rate_pct"] == round(600 / (77_242 + 600) * 100, 2)


def test_shopee_sem_pedido_nao_tem_cobertura():
    k = _quality([])["kpis"]
    assert k["shopee_return_rate_pct"] is None
    assert k["shopee_return_cobertura"] is None


# ---------------------------------------------------------------------------
# Contrato
# ---------------------------------------------------------------------------

def test_schema_publica_a_cobertura_e_aceita_pct_nulo():
    validado = QualityResponse.model_validate(_quality(SHOPEE_OUT26))
    assert validado.kpis.shopee_return_cobertura is not None
    assert validado.kpis.shopee_return_cobertura.marcas_com_dado == 1
    assert validado.kpis.shopee_return_cobertura.marcas_total == 5
    apice = next(b for b in validado.brands if b.brand == "apice")
    assert apice.shopee_return_rate_pct is None
