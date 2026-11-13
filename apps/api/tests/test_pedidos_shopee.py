"""T-0116 — a aba /pedidos inclui a Shopee e "sem dado" deixa de virar 0 (B1-10).

Fake de banco no padrao dos testes de performance: `get_pedidos` executa, em
ordem, KPIs por canal, serie diaria e quebra por marca (+ `refreshed_at` quando
ha `period`).
"""
from __future__ import annotations

from datetime import date

from app.deps.period import EffectivePeriod
from app.schemas.performance import PedidosResponse
from app.services import performance_service as perf_svc
from tests.test_canais_channel_rows import FakeMappingSession

TK, ML, SH = perf_svc.TIKTOK_ID, perf_svc.ML_ID, perf_svc.SHOPEE_ID


def _k(mkt, orders, canceled, gmv, delivered=0):
    return {"marketplace_id": mkt, "orders": orders, "canceled_orders": canceled,
            "delivered_orders": delivered, "gmv": gmv}


def _d(day, mkt, orders, canceled, gmv):
    return {"date": date(2026, 10, day), "marketplace_id": mkt, "orders": orders,
            "canceled_orders": canceled, "gmv": gmv}


def _b(brand, mkt, orders, canceled, gmv):
    return {"brand_key": brand, "marketplace_id": mkt, "orders": orders,
            "canceled_orders": canceled, "gmv": gmv}


def _run(kpis, daily, brands, marketplace="all"):
    db = FakeMappingSession([kpis, daily, brands])
    result = perf_svc.get_pedidos(db, 30, marketplace=marketplace)
    PedidosResponse.model_validate(result)  # o contrato aceita a resposta
    return result, db


def test_shopee_entra_nos_kpis_na_serie_e_nas_marcas():
    result, db = _run(
        [_k(TK, 100, 10, 10_000.0), _k(ML, 50, 5, 5_000.0), _k(SH, 80, 20, 4_000.0, delivered=70)],
        [_d(1, TK, 100, 10, 10_000.0), _d(1, ML, 50, 5, 5_000.0), _d(1, SH, 80, 20, 4_000.0)],
        [_b("kokeshi", TK, 100, 10, 10_000.0), _b("kokeshi", ML, 50, 5, 5_000.0), _b("kokeshi", SH, 80, 20, 4_000.0)],
    )
    assert db.captured_params[0]["mkt_ids"] == [TK, ML, SH]
    assert result["shopee"] == {"orders": 80, "canceled": 20, "gmv": 4_000.0, "cancel_rate_pct": 20.0, "delivered": 70}
    day = result["daily"][0]
    assert (day["shopee_orders"], day["shopee_canceled"]) == (80, 20)
    assert day["total_orders"] == 100 + 50 + 80  # pagos dos 3
    assert day["total_gmv"] == 19_000.0
    row = result["by_brand"][0]
    assert (row["shopee_orders"], row["shopee_canceled"], row["shopee_gmv"]) == (80, 20, 4_000.0)
    assert row["shopee_cancel_rate_pct"] == 20.0
    assert result["canais_sem_dado"] == [] and result["warnings"] == []


def test_total_e_a_soma_dos_3_canais_com_o_mesmo_denominador():
    result, _ = _run(
        [_k(TK, 100, 10, 10_000.0), _k(ML, 50, 5, 5_000.0), _k(SH, 80, 20, 4_000.0)],
        [], [],
    )
    k = result["kpis"]
    # contrato existente: total_orders bruto (pagos + cancelados) — o web desconta os cancelados
    assert k["total_orders"] == (100 + 10) + (50 + 5) + (80 + 20)
    assert k["total_gmv"] == 19_000.0
    assert k["avg_ticket"] == round(19_000.0 / (100 + 50 + 80), 2)
    assert k["cancel_rate_pct"] == round(35 / 265 * 100, 2)
    # liquido = total - cancelados de cada canal = soma dos pagos
    canc = result["tiktok"]["canceled"] + result["ml"]["canceled"] + result["shopee"]["canceled"]
    assert k["total_orders"] - canc == 230


def test_contraprova_shopee_isolada_devolve_so_a_shopee_e_nao_zero():
    result, db = _run(
        [_k(SH, 94_568, 18_191, 1_000_000.0)],
        [_d(1, SH, 94_568, 18_191, 1_000_000.0)],
        [_b("apice", SH, 94_568, 18_191, 1_000_000.0)],
        marketplace="shopee",
    )
    assert db.captured_params[0]["mkt_ids"] == [SH]
    assert result["kpis"]["total_orders"] == 94_568 + 18_191
    assert result["kpis"]["cancel_rate_pct"] == round(18_191 / (94_568 + 18_191) * 100, 2)
    assert result["shopee"]["orders"] == 94_568
    # canais fora do filtro: sem linha -> null, nunca 0
    assert result["tiktok"]["orders"] is None and result["ml"]["orders"] is None
    assert result["warnings"] == []


def test_marca_sem_linha_num_canal_vem_null_e_nao_zero():
    result, _ = _run(
        [_k(TK, 10, 1, 100.0), _k(SH, 5, 0, 50.0)],
        [_d(1, TK, 10, 1, 100.0), _d(2, SH, 5, 0, 50.0)],
        [_b("apice", TK, 10, 1, 100.0), _b("apice", SH, 5, 0, 50.0)],
    )
    row = result["by_brand"][0]
    assert row["ml_orders"] is None and row["ml_gmv"] is None and row["ml_cancel_rate_pct"] is None
    # serie: canal sem linha no dia -> null
    d1, d2 = result["daily"]
    assert d1["shopee_orders"] is None and d1["ml_orders"] is None and d1["tiktok_orders"] == 10
    assert d2["tiktok_orders"] is None and d2["shopee_orders"] == 5
    # canal pedido sem linha: campos null + aviso de parcial
    assert result["ml"] == {"orders": None, "canceled": None, "gmv": None, "cancel_rate_pct": None, "delivered": None}
    assert result["canais_sem_dado"] == ["ml"]
    assert len(result["warnings"]) == 1 and result["warnings"][0].startswith("sem_dado:")
    assert "Mercado Livre" in result["warnings"][0] and "parciais" in result["warnings"][0]
    # total soma so' os presentes
    assert result["kpis"]["total_gmv"] == 150.0
    assert result["kpis"]["total_orders"] == 11 + 5


def test_b1_10_apice_x_ml_sem_linha_devolve_null_e_nao_zero():
    result, _ = _run([], [], [], marketplace="ml")
    k = result["kpis"]
    assert k["total_orders"] is None and k["total_gmv"] is None
    assert k["avg_ticket"] is None and k["cancel_rate_pct"] is None
    assert result["ml"]["orders"] is None
    assert result["canais_sem_dado"] == ["ml"]
    assert result["warnings"][0].startswith("sem_dado: nenhum canal")


def test_zero_real_continua_zero():
    result, _ = _run(
        [_k(SH, 0, 0, 0.0)],
        [_d(1, SH, 0, 0, 0.0)],
        [_b("lescent", SH, 0, 0, 0.0)],
        marketplace="shopee",
    )
    assert result["shopee"]["orders"] == 0 and result["shopee"]["gmv"] == 0.0
    assert result["kpis"]["total_orders"] == 0 and result["kpis"]["total_gmv"] == 0.0
    assert result["daily"][0]["shopee_orders"] == 0
    assert result["by_brand"][0]["shopee_orders"] == 0
    assert result["warnings"] == []


def test_avg_ticket_null_sem_pedidos_pagos():
    # linha existe, mas so' com cancelados: ticket sem base e' null, nunca 0,0
    result, _ = _run([_k(SH, 0, 3, 0.0)], [], [], marketplace="shopee")
    assert result["kpis"]["avg_ticket"] is None
    assert result["kpis"]["cancel_rate_pct"] == 100.0
    assert result["shopee"]["cancel_rate_pct"] == 100.0


def test_shopee_cancelamento_zero_real_e_zero_tiktok_mantem_null():
    result, _ = _run([_k(TK, 10, 0, 1.0), _k(SH, 10, 0, 1.0)], [], [], marketplace="tiktok,shopee")
    assert result["shopee"]["cancel_rate_pct"] == 0.0
    assert result["tiktok"]["cancel_rate_pct"] is None  # regra existente: sem cobertura de cancelamento TikTok


def test_rota_com_periodo_consulta_refreshed_at_com_shopee():
    db = FakeMappingSession([[_k(SH, 1, 0, 10.0)], [], [], [{"refreshed_at": None}]])
    period = EffectivePeriod(start=date(2026, 10, 1), end=date(2026, 10, 31))
    result = perf_svc.get_pedidos(db, 31, marketplace="all", period=period)
    assert result["shopee"]["orders"] == 1
    assert len(db.captured_params) == 4  # kpis, serie, marcas, refreshed_at
