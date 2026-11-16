"""Clique na barra da evolucao (ML e Shopee): atrasados de UM dia de vencimento.

Impede: regra da lista divergir da taxa; falha virar "nenhum pedido"; marca
sem fonte virar lista vazia; dia aberto ou fora da janela ser aceito; numero do
pedido sair com a chave desligada; flag desligada abrir a rota.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.routers import ml_ldr as rota
from app.services import expedicao_atrasados_dia_service as svc
from app.services import ml_ldr_service as ml
from app.services import shopee_ldr_dm_service as shopee

AGORA = datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc)
PEDIDOS = [
    {"brand": "barbours", "order_id": "2000001", "status": "shipped",
     "prazo": "2026-11-12T23:59:00-03:00", "coletado_em": "2026-11-13T10:00:00-03:00"},
    {"brand": "kokeshi", "order_id": "2000002", "status": "ready_to_ship",
     "prazo": "2026-11-12T14:00:00-03:00", "coletado_em": None},
    {"brand": "kokeshi", "order_id": "2000003", "status": "shipped",
     "prazo": "2026-11-12T14:00:00-03:00", "coletado_em": "2026-11-13T09:00:00-03:00"},
]


def _fonte(pedidos=PEDIDOS, erro=False):
    chamadas = []

    def consultar(sql, params):
        chamadas.append((sql, params))
        if erro:
            raise RuntimeError("postgresql://u:senha-SECRETA@h/db")
        return [{"pedidos": pedidos}]
    return consultar, chamadas


def test_lista_usa_a_mesma_regra_da_taxa():
    assert ml.SQL_ATRASADOS_DIA_ML.startswith(ml._CTE_ML) and ml._ATRASADO_ML in ml.SQL_LDR_ML
    assert ml._ATRASADO_ML in ml.SQL_ATRASADOS_DIA_ML
    assert shopee.SQL_ATRASADOS_DIA_SHOPEE.startswith(shopee._CTE_SHOPEE)
    assert shopee._ATRASADO_SHOPEE in shopee.SQL_LDR_SHOPEE_DM and shopee._ATRASADO_SHOPEE in shopee.SQL_ATRASADOS_DIA_SHOPEE
    # Nada do comprador sai da consulta.
    for sql in (ml.SQL_ATRASADOS_DIA_ML, shopee.SQL_ATRASADOS_DIA_SHOPEE):
        assert "buyer" not in sql and "address" not in sql and "phone" not in sql


def test_um_dia_por_consulta_e_contagens(monkeypatch):
    monkeypatch.setattr(settings, "expedicao_numero_pedido_publico", True)
    consultar, chamadas = _fonte()
    r = svc.obter_atrasados_dia("mercadolivre", vencimento=date(2026, 11, 12), consultar=consultar, agora=AGORA)
    assert chamadas[0][1]["inicio"] == chamadas[0][1]["fim"] == date(2026, 11, 12)
    assert chamadas[0][1]["logisticas"] == list(ml.LOGISTICAS_COM_COLETA)
    assert (r["availability"], r["list_total"], r["still_waiting"]) == ("available", 3, 1)
    assert r["brands"][0] == {"brand": "kokeshi", "missed": 2, "still_waiting": 1}
    assert r["orders"][0]["order_id"] == "2000001" and set(r["orders"][0]) == {
        "brand", "order_id", "status", "deadline_at", "collected_at"}


def test_filtro_de_marca_e_pagina(monkeypatch):
    consultar, _ = _fonte(PEDIDOS * 100)
    r = svc.obter_atrasados_dia("mercadolivre", vencimento=date(2026, 11, 12), brands=["kokeshi"],
                                pagina=1, consultar=consultar, agora=AGORA)
    assert r["list_total"] == 200 and not r["has_more"] and r["all_brands"] == ["barbours", "kokeshi"]
    r2 = svc.obter_atrasados_dia("mercadolivre", vencimento=date(2026, 11, 12), pagina=2,
                                 consultar=consultar, agora=AGORA)
    assert len(r2["orders"]) == 100 and not r2["has_more"]


def test_numero_do_pedido_segue_a_chave(monkeypatch):
    monkeypatch.setattr(settings, "expedicao_numero_pedido_publico", False)
    consultar, _ = _fonte()
    r = svc.obter_atrasados_dia("shopee", vencimento=date(2026, 11, 12), consultar=consultar, agora=AGORA)
    assert all(p["order_id"] is None for p in r["orders"])


def test_falha_e_marca_sem_fonte_nao_viram_lista_vazia():
    consultar, chamadas = _fonte(erro=True)
    r = svc.obter_atrasados_dia("shopee", vencimento=date(2026, 11, 12), consultar=consultar, agora=AGORA)
    assert r["availability"] == "unavailable" and r["unavailable_reason"] == "source_error"
    assert "SECRETA" not in str(r)
    consultar, chamadas = _fonte()
    r = svc.obter_atrasados_dia("shopee", vencimento=date(2026, 11, 12), brands=["kokeshi"],
                                consultar=consultar, agora=AGORA)
    assert r["unavailable_reason"] == "brand_without_source" and chamadas == []


@pytest.mark.parametrize("canal,dia,ok", [
    ("mercadolivre", date(2026, 11, 15), True),
    ("mercadolivre", date(2026, 11, 16), False),  # hoje: dia aberto
    ("mercadolivre", date(2026, 11, 2), False),   # antes do inicio da serie
    ("shopee", date(2026, 10, 12), True),
    ("shopee", date(2026, 10, 11), False),        # fora dos 35 dias
])
def test_validar_dia(canal, dia, ok):
    if ok:
        svc.validar_dia(canal, dia, AGORA)
    else:
        with pytest.raises(ValueError):
            svc.validar_dia(canal, dia, AGORA)


@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(rota.router)
    app.include_router(rota.router_shopee)
    monkeypatch.setattr(settings, "expedicao_performance_api_enabled", True)
    monkeypatch.setattr(svc, "validar_dia", lambda canal, dia: None if dia < date(2099, 1, 1) else (_ for _ in ()).throw(ValueError()))
    chamadas = []
    monkeypatch.setattr(svc, "obter_atrasados_dia",
                        lambda canal, **kw: chamadas.append((canal, kw)) or {"availability": "available"})
    return TestClient(app), chamadas


def test_rotas(cliente, monkeypatch):
    c, chamadas = cliente
    assert c.get("/api/v1/expedicao/ml/ldr/pedidos", params={"vencimento": "2026-11-12", "brands": "kokeshi"}).status_code == 200
    assert c.get("/api/v1/expedicao/shopee/ldr/pedidos", params={"vencimento": "2026-11-12", "page": 2}).status_code == 200
    assert chamadas[0] == ("mercadolivre", {"vencimento": date(2026, 11, 12), "brands": ["kokeshi"], "pagina": 1})
    assert chamadas[1][0] == "shopee" and chamadas[1][1]["pagina"] == 2
    assert c.get("/api/v1/expedicao/ml/ldr/pedidos", params={"vencimento": "<x>"}).status_code == 422
    assert c.get("/api/v1/expedicao/ml/ldr/pedidos", params={"vencimento": "2099-01-01"}).status_code == 422
    assert c.get("/api/v1/expedicao/ml/ldr/pedidos").status_code == 422
    assert c.get("/api/v1/expedicao/shopee/ldr/pedidos", params={"vencimento": "2026-11-12", "page": 0}).status_code == 422
    monkeypatch.setattr(settings, "expedicao_performance_api_enabled", False)
    assert c.get("/api/v1/expedicao/shopee/ldr/pedidos", params={"vencimento": "2026-11-12"}).status_code == 404
