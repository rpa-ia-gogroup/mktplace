"""
T-0074 — rotulo "em maturacao" do GMV TikTok (docs/tiktok_gmv_maturacao.md).

O GMV TikTok de um dia ainda pode CAIR ate ~D+30 (cancelamentos tardios). As
respostas de /daily, /monthly e /brands ganham um campo ADITIVO de estado.
Estes testes travam tres coisas:

1. a fronteira: dia >= hoje-35 (America/Sao_Paulo) esta em maturacao;
2. o rotulo nao muda numero nenhum (GMV identico ao que o SQL devolveu);
3. com o TikTok fora do escopo, os campos ficam None.
"""
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.routers import performance as rota
from app.services import performance_service as perf_svc

HOJE = date(2026, 11, 9)
DESDE = date(2026, 10, 5)  # HOJE - 35


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return None


class FakeSession:
    """Devolve as linhas da consulta principal; consultas auxiliares (ex.:
    refreshed_at) recebem conjunto vazio."""

    def __init__(self, rows):
        self.rows = rows

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "MAX(" in sql.upper() and "REFRESH" in sql.upper():
            return _Rows([])
        return _Rows(self.rows)


DAILY_ROWS = [
    {"date": date(2026, 10, 4), "marketplace_id": perf_svc.TIKTOK_ID, "gmv": 1000, "orders": 10, "ad_spend": None},
    {"date": date(2026, 10, 5), "marketplace_id": perf_svc.TIKTOK_ID, "gmv": 2000, "orders": 20, "ad_spend": None},
    {"date": date(2026, 11, 8), "marketplace_id": perf_svc.TIKTOK_ID, "gmv": 3000, "orders": 30, "ad_spend": None},
]


def test_fronteira_e_hoje_menos_35():
    assert perf_svc.tiktok_maturacao_desde(HOJE) == DESDE
    info = perf_svc.tiktok_maturacao_info([perf_svc.TIKTOK_ID], HOJE)
    assert info == {
        "em_maturacao_desde": DESDE,
        "janela_dias": 35,
        "motivo": "cancelamentos ate ~D+30; valor pode cair",
    }


def test_sem_tiktok_no_escopo_nao_ha_bloco():
    assert perf_svc.tiktok_maturacao_info([perf_svc.ML_ID, perf_svc.SHOPEE_ID], HOJE) is None


def test_default_usa_relogio_de_sao_paulo(monkeypatch):
    monkeypatch.setattr(perf_svc, "today_brt", lambda: HOJE)
    info = perf_svc.tiktok_maturacao_info([perf_svc.TIKTOK_ID])
    assert info["em_maturacao_desde"] == DESDE


def test_daily_marca_dias_e_preserva_valores():
    res = perf_svc.get_daily(FakeSession(DAILY_ROWS), "barbours", "tiktok", today=HOJE)
    por_dia = {r["date"]: r for r in res["data"]}
    assert por_dia[date(2026, 10, 4)]["tiktok_em_maturacao"] is False
    assert por_dia[date(2026, 10, 5)]["tiktok_em_maturacao"] is True  # fronteira inclusiva
    assert por_dia[date(2026, 11, 8)]["tiktok_em_maturacao"] is True
    # Nenhum numero muda.
    assert [r["tiktok_gmv"] for r in res["data"]] == [1000.0, 2000.0, 3000.0]
    assert [r["total_gmv"] for r in res["data"]] == [1000.0, 2000.0, 3000.0]
    assert res["tiktok_maturacao"]["em_maturacao_desde"] == DESDE


def test_daily_sem_tiktok_campos_none():
    rows = [{"date": date(2026, 11, 8), "marketplace_id": perf_svc.ML_ID, "gmv": 500, "orders": 5, "ad_spend": None}]
    res = perf_svc.get_daily(FakeSession(rows), "barbours", "ml", today=HOJE)
    assert res["tiktok_maturacao"] is None
    assert res["data"][0]["tiktok_em_maturacao"] is None
    assert res["data"][0]["ml_gmv"] == 500.0


def test_monthly_marca_meses_com_dia_em_maturacao():
    rows = [
        {"mes": date(2026, 9, 1), "brand_key": "barbours", "gmv": 100},
        {"mes": date(2026, 10, 1), "brand_key": "barbours", "gmv": 200},
        {"mes": date(2026, 11, 1), "brand_key": "barbours", "gmv": 300},
    ]
    res = perf_svc.get_monthly(FakeSession(rows), "tiktok", 6, today=HOJE)
    por_mes = {m["mes"]: m for m in res["data"]}
    assert por_mes["2026-09"]["tiktok_em_maturacao"] is False
    assert por_mes["2026-10"]["tiktok_em_maturacao"] is True
    assert por_mes["2026-11"]["tiktok_em_maturacao"] is True
    assert [m["barbours"] for m in res["data"]] == [100.0, 200.0, 300.0]
    assert res["tiktok_maturacao"]["janela_dias"] == 35


def test_brands_traz_bloco_quando_tiktok_no_escopo():
    res = perf_svc.get_brands(FakeSession([]), "all", 2026, 10, today=HOJE)
    assert res["tiktok_maturacao"]["em_maturacao_desde"] == DESDE
    res_ml = perf_svc.get_brands(FakeSession([]), "ml", 2026, 10, today=HOJE)
    assert res_ml["tiktok_maturacao"] is None


# ---------------------------------------------------------------------------
# Rota: o campo passa pelo response_model (aditivo, serializado como ISO)
# ---------------------------------------------------------------------------
@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(rota.router)
    monkeypatch.setattr(perf_svc, "today_brt", lambda: HOJE)
    holder = {"rows": []}
    app.dependency_overrides[get_db] = lambda: FakeSession(holder["rows"])
    return TestClient(app), holder


def test_rota_daily_serializa_maturacao(cliente):
    c, holder = cliente
    holder["rows"] = DAILY_ROWS
    r = c.get("/api/v1/performance/daily", params={"brand": "barbours", "marketplace": "tiktok"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tiktok_maturacao"] == {
        "em_maturacao_desde": "2026-10-05",
        "janela_dias": 35,
        "motivo": "cancelamentos ate ~D+30; valor pode cair",
    }
    assert [d["tiktok_em_maturacao"] for d in body["data"]] == [False, True, True]


def test_rota_monthly_serializa_maturacao(cliente):
    c, holder = cliente
    holder["rows"] = [{"mes": date(2026, 10, 1), "brand_key": "kokeshi", "gmv": 50}]
    r = c.get("/api/v1/performance/monthly", params={"marketplace": "tiktok"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tiktok_maturacao"]["em_maturacao_desde"] == "2026-10-05"
    assert body["data"][0]["tiktok_em_maturacao"] is True
    assert body["data"][0]["kokeshi"] == 50.0


def test_rota_monthly_sem_tiktok(cliente):
    c, holder = cliente
    holder["rows"] = [{"mes": date(2026, 10, 1), "brand_key": "kokeshi", "gmv": 50}]
    r = c.get("/api/v1/performance/monthly", params={"marketplace": "ml"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tiktok_maturacao"] is None
    assert body["data"][0]["tiktok_em_maturacao"] is None
