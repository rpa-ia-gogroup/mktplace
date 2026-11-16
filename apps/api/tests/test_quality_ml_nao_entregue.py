"""T-0118 — "não entregue" do ML na população de ENVIOS, como a gold.

`get_quality` passou de `(pedidos pagos - entregues) / pedidos pagos` para
`GREATEST(envios - entregues, 0) / envios`, a fórmula de
`gold.ml_gestao_diaria`. Pedido != envio: pack/carrinho junta pedidos num envio.
Sem `total_shipments` no recorte, taxa e contagem são None — nunca 0.
"""
from __future__ import annotations

from datetime import date

from app.deps.period import EffectivePeriod
from app.schemas.performance import QualityBrandRow
from app.services import performance_service as ps


class _Res:
    def __init__(self, linhas):
        self._linhas = linhas

    def mappings(self):
        return self

    def all(self):
        return self._linhas

    def first(self):
        return {"refreshed_at": None}


class _Db:
    def __init__(self, linhas):
        self.linhas = linhas
        self.sqls: list[str] = []

    def execute(self, sql, params=None):
        self.sqls.append(str(sql))
        return _Res(self.linhas)


def _linha(marca, pedidos, entregues, envios, cancelados=0, entregues_pareados="igual"):
    base = {k: 0 for k in ("returned_orders", "unique_buyers", "new_buyers",
                           "repeat_buyers", "gmv", "seller_shipping_cost")}
    if entregues_pareados == "igual":
        entregues_pareados = entregues if envios is not None else None
    return {**base, "brand_key": marca, "marketplace_id": ps.ML_ID,
            "orders": pedidos, "canceled_orders": cancelados,
            "delivered_orders": entregues,
            "total_shipments": envios,
            "delivered_with_shipments": entregues_pareados,
            "avg_delivery_days": None, "avg_delivery_hours": None, "problem_rate": None}


def _qualidade(linhas):
    db = _Db(linhas)
    periodo = EffectivePeriod(start=date(2026, 10, 1), end=date(2026, 10, 31))
    res = ps.get_quality(db, "ml", 2026, 10, brand_keys=None,
                         period=periodo, compare_period=None)
    return res, db


def _marca(res, marca):
    return next(r for r in res["brands"] if r["brand"] == marca)


def test_sql_soma_envios_sem_coalesce_e_pareia_os_entregues():
    _, db = _qualidade([])
    sql = " ".join(db.sqls[0].split())
    assert "SUM(f.total_shipments) AS total_shipments" in sql
    assert "COALESCE(SUM(f.total_shipments)" not in sql
    assert "FILTER (WHERE f.total_shipments IS NOT NULL)" in sql


def test_formula_por_marca_divide_por_envios():
    res, _ = _qualidade([_linha("barbours", 1000, 980, 990)])
    b = _marca(res, "barbours")
    assert b["ml_total_shipments"] == 990
    assert b["ml_not_delivered_shipments"] == 10
    assert b["ml_not_delivered_rate_pct"] == round(10 / 990 * 100, 2)


def test_contraprova_formula_antiga_daria_outro_numero():
    """Pack: 1000 pedidos pagos em 800 envios, 794 entregues.

    Nova: 6 / 800 = 0,75%. Antiga: (1000 - 794) / 1000 = 20,6%.
    """
    res, _ = _qualidade([_linha("kokeshi", 1000, 794, 800)])
    k = _marca(res, "kokeshi")
    assert k["ml_not_delivered_rate_pct"] == 0.75
    antiga = round((1000 - 794) / 1000 * 100, 2)
    assert antiga == 20.6 and k["ml_not_delivered_rate_pct"] != antiga
    assert res["kpis"]["ml_not_delivered_rate_pct"] == 0.75


def test_entregues_acima_dos_envios_vira_zero_nao_negativo():
    res, _ = _qualidade([_linha("lescent", 100, 105, 100)])
    l = _marca(res, "lescent")
    assert (l["ml_not_delivered_shipments"], l["ml_not_delivered_rate_pct"]) == (0, 0.0)


def test_agregado_soma_so_as_marcas_com_envios():
    res, _ = _qualidade([
        _linha("barbours", 100, 97, 100),     # 3 / 100
        _linha("kokeshi", 60, 49, 50),        # 1 / 50
        _linha("lescent", 300, 250, None),    # sem envios: fora dos dois lados
    ])
    assert res["kpis"]["ml_not_delivered_rate_pct"] == round(4 / 150 * 100, 2)
    sem = _marca(res, "lescent")
    assert sem["ml_total_shipments"] is None
    assert sem["ml_not_delivered_shipments"] is None
    assert sem["ml_not_delivered_rate_pct"] is None


def test_sem_total_shipments_em_nenhuma_marca_e_none_nunca_zero():
    res, _ = _qualidade([_linha("barbours", 100, 97, None),
                         _linha("kokeshi", 50, 0, None)])
    assert res["kpis"]["ml_not_delivered_rate_pct"] is None
    for marca in ("barbours", "kokeshi"):
        m = _marca(res, marca)
        assert m["ml_not_delivered_rate_pct"] is None
        assert m["ml_not_delivered_shipments"] is None
    # o cancelamento da mesma linha nao e' afetado
    assert _marca(res, "barbours")["ml_total_orders"] == 100


def test_envios_zero_no_recorte_e_none():
    res, _ = _qualidade([_linha("barbours", 10, 0, 0)])
    b = _marca(res, "barbours")
    assert b["ml_not_delivered_rate_pct"] is None
    assert b["ml_not_delivered_shipments"] is None
    assert res["kpis"]["ml_not_delivered_rate_pct"] is None


def test_numerador_usa_so_os_entregues_dos_dias_com_envios():
    """Mes com backfill parcial: 97 entregues no total, 40 nos dias com envios."""
    res, _ = _qualidade([_linha("barbours", 100, 97, 41, entregues_pareados=40)])
    b = _marca(res, "barbours")
    assert b["ml_not_delivered_shipments"] == 1
    assert b["ml_not_delivered_rate_pct"] == round(1 / 41 * 100, 2)


def test_schema_aceita_o_campo_novo_e_continua_opcional():
    assert QualityBrandRow(brand="x", label="X").ml_total_shipments is None
    assert QualityBrandRow(brand="x", label="X", ml_total_shipments=5).ml_total_shipments == 5
