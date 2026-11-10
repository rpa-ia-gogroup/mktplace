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
    {"data": "2026-11-09", "marca": "Denavita", "plataforma": "AMAZON", "faturamento": 5000},  # canal fora
    {"data": "2026-11-09", "marca": "Denavita", "plataforma": "MAGALU", "faturamento": 5000},  # canal fora
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
    assert pedidos == [(date(2026, 11, 9), date(2026, 11, 9)), (date(2026, 11, 8), date(2026, 11, 8))]  # dia + o anterior
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
    assert len(n) == 2  # periodo + anterior, uma vez so' dentro da hora
    t[0] = 3601
    svc.get_marcas_menores(*args, fonte=f, agora=lambda: t[0])
    assert len(n) == 4


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
            visto.setdefault("json", json)  # a 1a chamada e' o periodo pedido
            visto.update(url=url, headers=headers)
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


def test_so_tres_canais_na_quebra_e_no_total():
    r = svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE, fonte=lambda a, b: LINHAS)
    m = _marcas(r)
    assert m["denavita"]["total"] == 160.5  # AMAZON e MAGALU nao entram
    assert {p["plataforma"] for mm in r["marcas"] for p in mm["por_plataforma"]} <= {"MELI", "SHOPEE", "TIKTOK"}
    assert r["consolidado"]["total"] == 167.5  # 160.5 + 7 (Aua TikTok)
    assert [p["plataforma"] for p in r["consolidado"]["por_plataforma"]] == ["MELI", "SHOPEE", "TIKTOK"]


def test_periodo_anterior_para_a_variacao_e_sem_base_nao_e_zero():
    ant = [{"data": "2026-10-25", "marca": "Denavita", "plataforma": "MELI", "faturamento": 80}]

    def fonte(a, b):
        return LINHAS if b == date(2026, 11, 9) else ant  # anterior de 11/01..11/09 (9 dias) = 10/23..10/31

    r = svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE, fonte=fonte)
    assert r["consolidado"]["total_anterior"] == 80
    m = _marcas(r)
    assert m["denavita"]["total_anterior"] == 80 and m["aua"]["total_anterior"] is None
    svc.limpar_cache()
    sem = svc.get_marcas_menores(date(2026, 11, 1), date(2026, 11, 9), HOJE, fonte=lambda a, b: LINHAS if b == date(2026, 11, 9) else [])
    assert sem["consolidado"]["total_anterior"] is None


def test_produtos_denavita_tiktok_do_data_mart():
    pedidos = []

    def consultar(sql, params):
        pedidos.append((sql, params))
        return [{"sku": "1", "produto": "Sérum", "quantidade": 10, "receita": 500.0}, {"sku": "2", "produto": None, "quantidade": None, "receita": 20}]

    r = svc.get_produtos_denavita_tiktok(consultar, date(2026, 11, 1), date(2026, 11, 9))
    assert "brand = 'denavita'" in pedidos[0][0] and "fct_tiktok_product_daily" in pedidos[0][0]
    assert r["produtos"][0] == {"sku": "1", "produto": "Sérum", "quantidade": 10.0, "receita": 500.0}
    assert r["produtos"][1]["quantidade"] is None and r["produtos"][1]["produto"] == "2"  # sem quantidade: None, nunca 0


def test_produtos_base_fora_do_ar_e_indisponivel():
    def quebra(sql, params):
        raise RuntimeError("senha-no-texto")

    r = svc.get_produtos_denavita_tiktok(quebra, date(2026, 11, 1), date(2026, 11, 9))
    assert r["disponivel"] is False and "senha" not in r["motivo"] and r["produtos"] == []


def test_rota_produtos(monkeypatch):
    from app.services import datamart_leitura

    monkeypatch.setattr(datamart_leitura, "consultar", lambda sql, params: [{"sku": "1", "produto": "X", "quantidade": 3, "receita": 9}])
    resp = TestClient(app).get("/api/v1/performance/marcas-menores/produtos?date_from=2026-11-01&date_to=2026-11-09")
    assert resp.status_code == 200 and resp.json()["produtos"][0]["quantidade"] == 3
