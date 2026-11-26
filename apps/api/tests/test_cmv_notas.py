"""CMV do mes ate ontem pelas notas (card CMV / RECEITA da Gerencial).

CMV % = CMV / receita COM custo; receita sem custo vira cobertura; < 98% = parcial;
sem dado = None, nunca 0. Uma consulta so', no Data Mart.
"""
from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from app.main import app
from app.routers import performance as perf_router
from app.services import cmv_notas_service as svc
from app.services import datamart_leitura

HOJE = date(2026, 11, 26)


def _l(plat, cmv, rcc, rec, ate="2026-11-25"):
    return {"plataforma": plat, "cmv": cmv, "receita_com_custo": rcc, "receita": rec,
            "ate": ate, "carregado": "2026-11-26T10:01"}


LINHAS = [
    _l("shopee", 2_241_039.86, 8_215_180.27, 8_220_370.27),
    _l("mercadolivre", 1_389_375.20, 5_457_123.81, 6_049_435.82),
    _l("tiktokshop", 4_788_979.34, 13_688_922.51, 13_692_856.67, ate="2026-11-24"),
]


def test_cmv_sobre_receita_com_custo_cobertura_e_parcial():
    chamadas = []
    r = svc.get_cmv_notas(lambda q, p: chamadas.append(p) or LINHAS, ["tiktok", "ml", "shopee"], None, HOJE)
    assert len(chamadas) == 1
    p = chamadas[0]
    assert p["mes"] == date(2026, 11, 1) and p["plataformas"] == ["tiktokshop", "mercadolivre", "shopee"]
    assert "by_samia" in p["marcas"] and "denavita" not in p["marcas"]  # mesmo escopo do filtro da Gerencial
    por = {c["canal"]: c for c in r["por_canal"]}
    assert por["shopee"]["cmv_pct"] == 27.28 and por["shopee"]["parcial"] is False
    assert por["tiktok"]["cmv_pct"] == 34.98
    # ML: 25,46% sobre a receita COM custo (22,97% seria sobre a receita toda); 90,2% de cobertura = parcial
    assert por["ml"]["cmv_pct"] == 25.46 and por["ml"]["cobertura"] == 0.9021 and por["ml"]["parcial"] is True
    assert r["cmv_pct"] == 30.77 and r["cobertura"] == 0.9785 and r["parcial"] is True
    assert r["mes"] == "2026-11" and r["ate"] == "2026-11-25" and r["carregado_em"] == "2026-11-26T10:01"


def test_recorte_de_marca_canal_e_mes():
    chamadas = []
    r = svc.get_cmv_notas(lambda q, p: chamadas.append(p) or [LINHAS[0]], ["shopee"], ["kokeshi", "by-samia"],
                          HOJE, date(2026, 10, 31))
    assert chamadas[0]["marcas"] == ["kokeshi", "by_samia"] and chamadas[0]["plataformas"] == ["shopee"]
    assert chamadas[0]["mes"] == date(2026, 10, 1) and r["mes"] == "2026-10"
    assert [c["canal"] for c in r["por_canal"]] == ["shopee"]


def test_sem_dado_nunca_zero():
    r = svc.get_cmv_notas(lambda q, p: [], ["ml"], None, HOJE)
    assert r["cmv_pct"] is None and r["cobertura"] is None and r["parcial"] is False and r["ate"] is None
    # receita sem nenhum custo: sem CMV %, cobertura 0
    r = svc.get_cmv_notas(lambda q, p: [_l("mercadolivre", None, None, 500.0)], ["ml"], None, HOJE)
    assert r["cmv_pct"] is None and r["cobertura"] is None
    # so' TikTok... fora do mapa nao consulta
    chamadas = []
    svc.get_cmv_notas(lambda q, p: chamadas.append(p) or [], [], None, HOJE)
    assert chamadas == []


client = TestClient(app)
ROTA = "/api/v1/performance/cmv-notas"


def test_rota_valida_e_503_sem_vazar(monkeypatch):
    chamadas = []

    def consultar(sql, params, **kw):
        chamadas.append((params, kw))
        return LINHAS
    monkeypatch.setattr(datamart_leitura, "consultar", consultar)
    monkeypatch.setattr(perf_router, "today_brt", lambda: HOJE)
    r = client.get(ROTA, params={"channels": "ml,shopee", "brands": "kokeshi,by-samia"})
    assert r.status_code == 200, r.text
    assert chamadas[-1][0]["plataformas"] == ["mercadolivre", "shopee"]
    assert chamadas[-1][1]["ttl_s"] == svc.TTL_S
    assert [c["canal"] for c in r.json()["por_canal"]] == ["ml", "shopee"]
    assert client.get(ROTA, params={"brands": "gocase"}).status_code == 422
    assert client.get(ROTA, params={"channels": "amazonx"}).status_code == 422

    def quebra(sql, params, **kw):
        raise RuntimeError("senha=xyz")
    monkeypatch.setattr(datamart_leitura, "consultar", quebra)
    r = client.get(ROTA)
    assert r.status_code == 503 and "xyz" not in r.text
