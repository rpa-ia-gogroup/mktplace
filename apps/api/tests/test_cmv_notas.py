"""CMV / RECEITA pelas notas no periodo do filtro, com estimativa dos dias sem nota.

Regra em `cmv_notas_service`: CMV % = CMV / receita com custo; cobertura < 98% =
parcial; dia incompleto (>= hoje - 2, ou NF < 70% do GMV) usa GMV x razao das
NFs dos 30 dias fechados; sem razao = receita sem custo; sem dado = None.
UMA consulta ao Data Mart cobrindo periodo, comparativo e janela da razao.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.routers import performance as perf_router
from app.services import cmv_notas_service as svc
from app.services import datamart_leitura
from app.services import performance_service as perf_svc

HOJE = date(2026, 11, 26)


def _nf(dia, plat, marca, cmv, rcc, rec):
    return {"dia": dia, "plataforma": plat, "marca": marca, "cmv": cmv, "receita_com_custo": rcc, "receita": rec}


def _dias(de, ate):
    d = de
    while d <= ate:
        yield d.isoformat()
        d += timedelta(days=1)


#: Historico na janela da razao (25/10..19/11): kokeshi ML com CMV 25% da receita com custo.
RAZAO = [_nf(d, "mercadolivre", "kokeshi", 250.0, 1000.0, 1000.0) for d in _dias(date(2026, 10, 25), date(2026, 11, 19))]


def test_janela_da_razao_e_intervalo_unico():
    assert svc.janela_razao(HOJE) == (date(2026, 10, 25), date(2026, 11, 23))  # 30 dias, ate hoje - 3
    # periodo 01-25/11, comparativo 07-31/10: a leitura cobre tudo numa consulta so'
    assert svc.intervalo_leitura([(date(2026, 11, 1), date(2026, 11, 25)), (date(2026, 10, 7), date(2026, 10, 31))], HOJE) == (
        date(2026, 10, 7), date(2026, 11, 25))


def test_dias_fechados_usam_a_nota_e_recentes_a_estimativa():
    nf = [
        _nf("2026-11-20", "mercadolivre", "kokeshi", 300.0, 1000.0, 1000.0),   # fechado e completo: nota
        _nf("2026-11-21", "mercadolivre", "kokeshi", 100.0, 400.0, 400.0),     # fechado, NF 40% do GMV: estima
        _nf("2026-11-25", "mercadolivre", "kokeshi", 50.0, 100.0, 100.0),      # 2 ultimos dias: estima
    ] + RAZAO
    gmv = {("2026-11-20", "ml", "kokeshi"): 1000.0, ("2026-11-21", "ml", "kokeshi"): 1000.0,
           ("2026-11-25", "ml", "kokeshi"): 2000.0}
    chamadas = []
    r = svc.get_cmv_notas(lambda q, p: chamadas.append(p) or nf, lambda de, ate: gmv, ["ml"], None,
                          date(2026, 11, 20), date(2026, 11, 25), HOJE)
    assert len(chamadas) == 1 and chamadas[0]["plataformas"] == ["mercadolivre"]
    assert "by_samia" in chamadas[0]["marcas"] and "denavita" not in chamadas[0]["marcas"]
    # razao = ultimos 3 dias FECHADOS: 21/11 fica fora (NF 40% do GMV); entram 20, 19 e 18/11
    razao = (300 + 250 + 250) / 3000
    # 20/11 nota (300/1000) + 21/11 estimado (1000 x razao) + 25/11 estimado (2000 x razao)
    assert abs(r["cmv"] - (300 + 3000 * razao)) < 0.01 and r["receita_com_custo"] == 4000
    assert r["cmv_pct"] == round((300 + 3000 * razao) / 4000 * 100, 2)
    assert r["estimado_pct"] == 0.75 and r["dias_estimados"] == ["2026-11-21", "2026-11-25"]
    assert r["parcial"] is False and r["ultima_nf"] == "2026-11-25"


def test_razao_dos_3_dias_fechados_e_reserva_de_30_dias():
    nf = [_nf("2026-11-23", "shopee", "kokeshi", 40.0, 100.0, 100.0),   # 3 ultimos fechados: 40%
          _nf("2026-11-22", "shopee", "kokeshi", 40.0, 100.0, 100.0),
          _nf("2026-11-21", "shopee", "kokeshi", 40.0, 100.0, 100.0),
          _nf("2026-11-01", "shopee", "kokeshi", 10.0, 100.0, 100.0),   # mais antigo: fora da razao de 3 dias
          # apice: so' dias incompletos (NF < 70% do GMV) na janela -> reserva = 30 dias inteiros
          _nf("2026-11-10", "shopee", "apice", 30.0, 100.0, 100.0),
          _nf("2026-11-11", "shopee", "apice", 10.0, 100.0, 100.0)]
    gmv = {("2026-11-10", "shopee", "apice"): 1000.0, ("2026-11-11", "shopee", "apice"): 1000.0}
    r = svc.razoes(svc.indexar_nf(nf), gmv, HOJE)
    assert r[("shopee", "kokeshi")] == 0.4
    assert r[("shopee", "apice")] == 0.2
    assert ("ml", "kokeshi") not in r      # sem nota: sem razao (nunca 0)


def test_sem_razao_vira_receita_sem_custo_nunca_zero_e_parcial():
    # kokeshi ML tem historico (25%); apice ML nao tem nota em 30 dias
    gmv = {("2026-11-24", "ml", "kokeshi"): 1000.0, ("2026-11-24", "ml", "apice"): 100.0}
    r = svc.get_cmv_notas(lambda q, p: RAZAO, lambda de, ate: gmv, ["ml"], None,
                          date(2026, 11, 24), date(2026, 11, 25), HOJE)
    # apice sem razao: o GMV entra so' na receita (cobertura 1000/1100), nunca como custo zero
    assert r["cmv_pct"] == 25.0 and r["cobertura"] == 0.9091 and r["parcial"] is True
    # sem nada: sem dado
    vazio = svc.get_cmv_notas(lambda q, p: [], lambda de, ate: {}, ["shopee"], None,
                              date(2026, 11, 20), date(2026, 11, 25), HOJE)
    assert vazio["cmv_pct"] is None and vazio["receita"] is None and vazio["por_canal"] == []


def test_sem_gmv_na_torre_fica_a_nota_e_comparativo_na_mesma_leitura():
    nf = [_nf("2026-11-25", "tiktokshop", "yenzah", 30.0, 100.0, 100.0),
          _nf("2026-10-10", "tiktokshop", "yenzah", 20.0, 100.0, 100.0)]
    chamadas = []
    r = svc.get_cmv_notas(lambda q, p: chamadas.append(p) or nf, lambda de, ate: {}, ["tiktok"], ["yenzah"],
                          date(2026, 11, 24), date(2026, 11, 25), HOJE, (date(2026, 10, 1), date(2026, 10, 15)))
    assert len(chamadas) == 1 and chamadas[0]["de"] == date(2026, 10, 1) and chamadas[0]["marcas"] == ["yenzah"]
    assert r["cmv_pct"] == 30.0 and r["estimado_pct"] is None   # marca menor: nota, sem estimativa
    assert r["anterior_cmv_pct"] == 20.0 and r["compare_date_from"] == "2026-10-01"


client = TestClient(app)
ROTA = "/api/v1/performance/cmv-notas"


def test_rota_segue_o_filtro_e_503_sem_vazar(monkeypatch):
    chamadas = []

    def consultar(sql, params, **kw):
        chamadas.append((params, kw))
        return RAZAO
    monkeypatch.setattr(datamart_leitura, "consultar", consultar)
    monkeypatch.setattr(perf_router, "today_brt", lambda: HOJE)
    monkeypatch.setattr(perf_router, "_require_db", lambda db: object())
    monkeypatch.setattr(perf_svc, "gmv_dia_marca_canal", lambda *a, **k: {})
    r = client.get(ROTA, params={"channels": "ml", "date_from": "2026-11-01", "date_to": "2026-11-23", "compare": "true"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["date_from"] == "2026-11-01" and body["cmv_pct"] == 25.0
    # comparativo 01-23/10 sem nota: sem comparacao, nunca 0
    assert body["compare_date_from"] == "2026-10-01" and body["anterior_cmv_pct"] is None
    assert chamadas[-1][1] == {"timeout_metabase": svc.TIMEOUT_METABASE_S, "ttl_s": svc.TTL_S}

    def quebra(sql, params, **kw):
        raise RuntimeError("senha=xyz")
    monkeypatch.setattr(datamart_leitura, "consultar", quebra)
    r = client.get(ROTA, params={"channels": "ml", "date_from": "2026-11-01", "date_to": "2026-11-23"})
    assert r.status_code == 503 and "xyz" not in r.text
