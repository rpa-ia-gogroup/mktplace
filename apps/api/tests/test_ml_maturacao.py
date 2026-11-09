"""
T-0077 — rotulo "em maturacao" do GMV Mercado Livre (docs/ml_gmv_maturacao.md).

O GMV ML de um dia ainda pode CAIR ate ~D+35 (cancelamentos e reembolsos
parciais tardios, medidos na T-0075). /daily, /monthly e /brands ganham campos
ADITIVOS no mesmo formato do TikTok (T-0074). Estes testes travam:

1. a fronteira: dia >= hoje-35 (America/Sao_Paulo) esta em maturacao;
2. o rotulo nao muda numero nenhum;
3. com o ML fora do escopo, os campos ficam None;
4. o rotulo do TikTok continua independente do ML.
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
INFO = {
    "em_maturacao_desde": DESDE,
    "janela_dias": 35,
    "motivo": "cancelamentos ate ~D+35; valor pode cair",
}


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
    def __init__(self, rows):
        self.rows = rows

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "MAX(" in sql.upper() and "REFRESH" in sql.upper():
            return _Rows([])
        return _Rows(self.rows)


def _linha(d, mkt, gmv):
    return {"date": d, "marketplace_id": mkt, "gmv": gmv, "orders": 1, "ad_spend": None}


DAILY_ROWS = [
    _linha(date(2026, 10, 4), perf_svc.ML_ID, 1000),
    _linha(date(2026, 10, 5), perf_svc.ML_ID, 2000),
    _linha(date(2026, 11, 8), perf_svc.ML_ID, 3000),
]


def test_fronteira_e_hoje_menos_35():
    assert perf_svc.ml_maturacao_desde(HOJE) == DESDE
    assert perf_svc.ml_maturacao_info([perf_svc.ML_ID], HOJE) == INFO


def test_sem_ml_no_escopo_nao_ha_bloco():
    assert perf_svc.ml_maturacao_info([perf_svc.TIKTOK_ID, perf_svc.SHOPEE_ID], HOJE) is None


def test_default_usa_relogio_de_sao_paulo(monkeypatch):
    monkeypatch.setattr(perf_svc, "today_brt", lambda: HOJE)
    assert perf_svc.ml_maturacao_info([perf_svc.ML_ID])["em_maturacao_desde"] == DESDE


def test_daily_marca_dias_e_preserva_valores():
    res = perf_svc.get_daily(FakeSession(DAILY_ROWS), "barbours", "ml", today=HOJE)
    assert [r["ml_em_maturacao"] for r in res["data"]] == [False, True, True]
    assert [r["ml_gmv"] for r in res["data"]] == [1000.0, 2000.0, 3000.0]
    assert [r["total_gmv"] for r in res["data"]] == [1000.0, 2000.0, 3000.0]
    assert res["ml_maturacao"] == INFO
    # TikTok fora do escopo: o rotulo dele continua None
    assert res["tiktok_maturacao"] is None
    assert {r["tiktok_em_maturacao"] for r in res["data"]} == {None}


def test_daily_sem_ml_campos_none():
    rows = [_linha(date(2026, 11, 8), perf_svc.TIKTOK_ID, 500)]
    res = perf_svc.get_daily(FakeSession(rows), "barbours", "tiktok", today=HOJE)
    assert res["ml_maturacao"] is None
    assert res["data"][0]["ml_em_maturacao"] is None
    assert res["data"][0]["tiktok_em_maturacao"] is True


def test_daily_todos_os_canais_traz_os_dois_rotulos():
    res = perf_svc.get_daily(FakeSession(DAILY_ROWS), "barbours", "all", today=HOJE)
    assert res["ml_maturacao"] == INFO
    assert res["tiktok_maturacao"]["em_maturacao_desde"] == DESDE


def test_monthly_marca_meses_com_dia_em_maturacao():
    rows = [
        {"mes": date(2026, 9, 1), "brand_key": "barbours", "gmv": 100},
        {"mes": date(2026, 10, 1), "brand_key": "barbours", "gmv": 200},
        {"mes": date(2026, 11, 1), "brand_key": "barbours", "gmv": 300},
    ]
    res = perf_svc.get_monthly(FakeSession(rows), "ml", 6, today=HOJE)
    por_mes = {m["mes"]: m for m in res["data"]}
    assert por_mes["2026-09"]["ml_em_maturacao"] is False
    assert por_mes["2026-10"]["ml_em_maturacao"] is True
    assert por_mes["2026-11"]["ml_em_maturacao"] is True
    assert [m["barbours"] for m in res["data"]] == [100.0, 200.0, 300.0]
    assert res["ml_maturacao"] == INFO
    assert res["tiktok_maturacao"] is None


def test_brands_traz_bloco_quando_ml_no_escopo():
    assert perf_svc.get_brands(FakeSession([]), "all", 2026, 10, today=HOJE)["ml_maturacao"] == INFO
    assert perf_svc.get_brands(FakeSession([]), "tiktok", 2026, 10, today=HOJE)["ml_maturacao"] is None


# ---------------------------------------------------------------------------
# Rota: o campo passa pelo response_model
# ---------------------------------------------------------------------------
@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(rota.router)
    monkeypatch.setattr(perf_svc, "today_brt", lambda: HOJE)
    holder = {"rows": []}
    app.dependency_overrides[get_db] = lambda: FakeSession(holder["rows"])
    return TestClient(app), holder


def test_rota_daily_serializa_maturacao_ml(cliente):
    c, holder = cliente
    holder["rows"] = DAILY_ROWS
    r = c.get("/api/v1/performance/daily", params={"brand": "barbours", "marketplace": "ml"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ml_maturacao"] == {
        "em_maturacao_desde": "2026-10-05",
        "janela_dias": 35,
        "motivo": "cancelamentos ate ~D+35; valor pode cair",
    }
    assert [d["ml_em_maturacao"] for d in body["data"]] == [False, True, True]


def test_rota_monthly_serializa_maturacao_ml(cliente):
    c, holder = cliente
    holder["rows"] = [{"mes": date(2026, 10, 1), "brand_key": "kokeshi", "gmv": 50}]
    body = c.get("/api/v1/performance/monthly", params={"marketplace": "ml"}).json()
    assert body["ml_maturacao"]["em_maturacao_desde"] == "2026-10-05"
    assert body["data"][0]["ml_em_maturacao"] is True
    assert body["data"][0]["kokeshi"] == 50.0


def test_rota_monthly_sem_ml(cliente):
    c, holder = cliente
    holder["rows"] = [{"mes": date(2026, 10, 1), "brand_key": "kokeshi", "gmv": 50}]
    body = c.get("/api/v1/performance/monthly", params={"marketplace": "tiktok"}).json()
    assert body["ml_maturacao"] is None
    assert body["data"][0]["ml_em_maturacao"] is None
