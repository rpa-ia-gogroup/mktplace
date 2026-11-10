"""Marcas menores pelo Avoe: tudo com mock, nenhuma chamada de rede."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import settings
from app.main import app
from app.services import marcas_menores_service as svc

HOJE = date(2026, 11, 10)
LINHAS = [
    {"data": "2026-11-08", "marca": "Denavita", "plataforma": "SHOPEE", "faturamento": 100},
    {"data": "2026-11-08", "marca": "Denavita", "plataforma": "MELI", "faturamento": 50.5},
    {"data": "2026-11-09", "marca": "Denavita", "plataforma": "MELI", "faturamento": 10},
    {"data": "2026-11-09", "marca": "AUÁ", "plataforma": "TIKTOK", "faturamento": 7},
    {"data": "2026-11-09", "marca": "By Samia", "plataforma": "SHEIN", "faturamento": None},  # sem valor
    {"data": "2026-11-09", "marca": "Kokeshi", "plataforma": "MELI", "faturamento": 999},  # fora do escopo
]


@pytest.fixture(autouse=True)
def _limpo():
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def _marcas(r):
    return {m["id"]: m for m in r["marcas"]}


def test_filtra_as_4_marcas_soma_quebra_e_serie():
    r = svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE, fonte=lambda a, b: LINHAS)
    m = _marcas(r)
    assert set(m) == {"denavita", "yenzah", "aua", "by-samia"}
    assert m["denavita"]["total"] == 160.5
    assert [(p["plataforma"], p["faturamento"]) for p in m["denavita"]["por_plataforma"]] == [("MELI", 60.5), ("SHOPEE", 100.0)]
    assert [(d["data"], d["faturamento"]) for d in m["denavita"]["serie"]] == [(date(2026, 11, 8), 150.5), (date(2026, 11, 9), 10.0)]
    assert m["aua"]["total"] == 7 and m["aua"]["label"] == "Auá"


def test_ausencia_nao_vira_zero():
    r = svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE, fonte=lambda a, b: LINHAS)
    m = _marcas(r)
    assert m["yenzah"]["total"] is None and m["yenzah"]["serie"] == []
    assert m["by-samia"]["total"] is None  # linha sem faturamento e' sem dado


def test_hoje_recorta_em_ontem_e_avisa():
    pedidos = []
    r = svc.get_marcas_menores(HOJE, HOJE, HOJE, fonte=lambda a, b: pedidos.append((a, b)) or LINHAS)
    assert pedidos == [(date(2026, 11, 9), date(2026, 11, 9))]
    assert r["ajustado"] is True and r["dado_ate"] == date(2026, 11, 9)
    assert _marcas(r)["denavita"]["total"] == 10  # so' o dia 9


def test_periodo_ate_ontem_nao_e_ajustado():
    r = svc.get_marcas_menores(date(2026, 11, 8), date(2026, 11, 9), HOJE, fonte=lambda a, b: LINHAS)
    assert r["ajustado"] is False


def test_cache_de_1h():
    n = []
    t = [0.0]
    f = lambda a, b: n.append(1) or LINHAS
    args = (date(2026, 11, 1), date(2026, 11, 9), HOJE)
    svc.get_marcas_menores(*args, fonte=f, agora=lambda: t[0])
    t[0] = 3599
    svc.get_marcas_menores(*args, fonte=f, agora=lambda: t[0])
    assert len(n) == 1
    t[0] = 3601
    svc.get_marcas_menores(*args, fonte=f, agora=lambda: t[0])
    assert len(n) == 2


def test_erro_da_fonte_e_indisponivel_sem_vazar_texto():
    def quebra(a, b):
        raise svc.AvoeIndisponivel("Fonte do Avoe indisponível agora.")

    r = svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE, fonte=quebra)
    assert r["disponivel"] is False and r["motivo"] and r["marcas"] == []
    assert svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE, fonte=quebra)["disponivel"] is False


def test_sem_chave_nao_chama_a_rede(monkeypatch):
    monkeypatch.setattr(settings, "avoe_api_key", SecretStr(""))
    r = svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert r["disponivel"] is False and "configurada" in r["motivo"]


def test_http_com_chave_manda_header_e_corpo(monkeypatch):
    visto = {}

    class R:
        def raise_for_status(self): ...
        def json(self): return {"result": {"linhas": LINHAS}}

    class C:
        def __init__(self, **k): ...
        def __enter__(self): return self
        def __exit__(self, *a): ...
        def post(self, url, headers, json):
            visto.update(url=url, headers=headers, json=json)
            return R()

    monkeypatch.setattr(settings, "avoe_api_key", SecretStr("chave-de-teste"))
    monkeypatch.setattr(svc.httpx, "Client", C)
    r = svc.get_marcas_menores(date(2026, 11, 8), date(2026, 11, 9), HOJE)
    assert r["disponivel"] is True
    assert visto["headers"] == {"x-api-key": "chave-de-teste"}
    assert visto["json"] == {"tool": "consultar_faturamento", "args": {"data_inicio": "2026-11-08", "data_fim": "2026-11-09"}}


def test_http_erro_vira_indisponivel(monkeypatch):
    class C:
        def __init__(self, **k): ...
        def __enter__(self): return self
        def __exit__(self, *a): ...
        def post(self, *a, **k): raise RuntimeError("segredo-no-texto")

    monkeypatch.setattr(settings, "avoe_api_key", SecretStr("chave-de-teste"))
    monkeypatch.setattr(svc.httpx, "Client", C)
    r = svc.get_marcas_menores(date(2026, 11, 8), date(2026, 11, 9), HOJE)
    assert r["disponivel"] is False and "segredo" not in r["motivo"]


def test_rota(monkeypatch):
    monkeypatch.setattr(svc, "consultar_avoe", lambda a, b: LINHAS)
    resp = TestClient(app).get("/api/v1/performance/marcas-menores?date_from=2026-11-01&date_to=2026-11-09")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["disponivel"] is True and len(body["marcas"]) == 4
