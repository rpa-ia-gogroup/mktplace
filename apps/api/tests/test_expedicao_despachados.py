"""Pace de despacho (`/api/v1/expedicao/despachados`).

Impede: fim de semana/feriado entrar nos 2 dias uteis; dia sem dado virar zero;
FBS, Full, amostra e gocase entrarem; Kokeshi contada nas duas fontes; varias
consultas ao Data Mart; excecao vazar.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.routers import expedicao as rota
from app.services import expedicao_despachados_service as svc

# Segunda-feira 09/11/2026, 10:00 BRT -> ultimos 2 dias uteis: quinta 05 e sexta 06.
SEGUNDA = datetime(2026, 11, 9, 13, 0, tzinfo=timezone.utc)
QUI, SEX, SAB = date(2026, 11, 5), date(2026, 11, 6), date(2026, 11, 7)


def L(canal, marca, dia, n):
    return {"canal": canal, "marca": marca, "dia": dia, "despachados": n}


def _fonte(linhas):
    chamadas = []

    def consultar(sql, params):
        chamadas.append((sql, params))
        return linhas
    return consultar, chamadas


class _Db:
    """Dubla `db.execute(...).mappings()` do export da Kokeshi."""

    def __init__(self, linhas):
        self.linhas = linhas

    def execute(self, *_a, **_k):
        return self

    def mappings(self):
        return self.linhas


def _conta(r, canal, marca):
    return next(c for c in r["contas"] if c["channel"] == canal and c["brand"] == marca)


def test_dois_ultimos_dias_uteis_com_fim_de_semana_no_meio():
    assert svc.dias_uteis_fechados(SEGUNDA) == [QUI, SEX]


def test_feriado_nacional_nao_e_dia_util():
    # Segunda 23/11/2026; sexta 20/11 e' feriado -> quarta 18 e quinta 19.
    agora = datetime(2026, 11, 23, 13, 0, tzinfo=timezone.utc)
    assert svc.dias_uteis_fechados(agora) == [date(2026, 11, 18), date(2026, 11, 19)]


def test_media_dos_dois_dias_e_fim_de_semana_ignorado():
    consultar, chamadas = _fonte([
        L("shopee", "apice", QUI, 100), L("shopee", "apice", SEX, 50),
        L("shopee", "apice", SAB, 999),  # fora dos 2 dias uteis
    ])
    r = svc.obter_despachados(channel="shopee", consultar=consultar, agora=SEGUNDA)
    assert _conta(r, "shopee", "apice")["media_2du"] == 75.0
    assert r["totais"][0]["media_2du"] == 75.0
    assert len(chamadas) == 1  # uma consulta so' ao Data Mart


def test_dia_sem_dado_no_canal_nao_vira_zero():
    # Sexta ainda nao ingerida: so' a quinta entra na media.
    consultar, _ = _fonte([L("shopee", "apice", QUI, 100)])
    r = svc.obter_despachados(channel="shopee", consultar=consultar, agora=SEGUNDA)
    c = _conta(r, "shopee", "apice")
    assert c["dias"][1]["despachados"] is None
    assert c["media_2du"] == 100.0


def test_conta_sem_linha_em_dia_com_dado_do_canal_e_zero_de_verdade():
    consultar, _ = _fonte([L("shopee", "apice", QUI, 100), L("shopee", "apice", SEX, 100),
                           L("shopee", "lescent", QUI, 40)])
    r = svc.obter_despachados(channel="shopee", consultar=consultar, agora=SEGUNDA)
    c = _conta(r, "shopee", "lescent")
    assert [d["despachados"] for d in c["dias"]] == [40, 0]
    assert c["media_2du"] == 20.0


def test_sem_nenhum_dado_media_e_null():
    consultar, _ = _fonte([])
    r = svc.obter_despachados(consultar=consultar, agora=SEGUNDA)
    assert r["availability"] == "available" and r["contas"] == []
    assert all(t["media_2du"] is None for t in r["totais"])


def test_escopo_so_do_vendedor_fbs_full_amostra_gocase_ficam_fora():
    consultar, chamadas = _fonte([])
    svc.obter_despachados(consultar=consultar, agora=SEGUNDA)
    sql, p = chamadas[0]
    assert "fulfilled_by_shopee" in sql and "is_sample_order" in sql
    assert "fulfillment" not in p["logisticas_ml"] and "self_service" in p["logisticas_ml"]
    assert "gocase" in p["marcas_fora"] and "gocase" not in p["marcas_tiktok"]
    # TikTok: coleta pelo log de status (indice), nunca varrendo line_items.
    assert "new_status = 'IN_TRANSIT'" in sql and "line_items" not in sql


def test_so_o_canal_pedido_entra_na_consulta():
    consultar, chamadas = _fonte([])
    svc.obter_despachados(channel="shopee", consultar=consultar, agora=SEGUNDA)
    assert "tiktok" not in chamadas[0][0] and "ml_shipments" not in chamadas[0][0]


def test_kokeshi_sem_linha_no_datamart_vem_do_export():
    consultar, _ = _fonte([L("shopee", "apice", QUI, 10), L("shopee", "apice", SEX, 10)])
    db = _Db([{"marca": "kokeshi", "dia": QUI, "despachados": 30},
              {"marca": "kokeshi", "dia": SEX, "despachados": 50}])
    r = svc.obter_despachados(channel="shopee", db=db, consultar=consultar, agora=SEGUNDA)
    assert _conta(r, "shopee", "kokeshi")["media_2du"] == 40.0


def test_kokeshi_no_datamart_nao_soma_com_o_export():
    consultar, _ = _fonte([L("shopee", "kokeshi", QUI, 30), L("shopee", "kokeshi", SEX, 50)])
    db = _Db([{"marca": "kokeshi", "dia": QUI, "despachados": 30},
              {"marca": "kokeshi", "dia": SEX, "despachados": 50}])
    r = svc.obter_despachados(channel="shopee", db=db, consultar=consultar, agora=SEGUNDA)
    assert _conta(r, "shopee", "kokeshi")["media_2du"] == 40.0
    assert r["totais"][0]["media_2du"] == 40.0  # nao 80


def test_filtro_de_marca_nao_muda_o_dia_publicado_do_canal():
    consultar, _ = _fonte([L("shopee", "apice", QUI, 100), L("shopee", "apice", SEX, 100),
                           L("shopee", "lescent", QUI, 40)])
    r = svc.obter_despachados(channel="shopee", brands=["lescent"], consultar=consultar, agora=SEGUNDA)
    assert [c["brand"] for c in r["contas"]] == ["lescent"]
    assert r["contas"][0]["dias"][1]["despachados"] == 0


def test_falha_da_fonte_vira_indisponivel_sem_vazar_texto():
    def quebra(sql, params):
        raise RuntimeError("postgresql://u:senha-SECRETA@h/db")
    r = svc.obter_despachados(consultar=quebra, agora=SEGUNDA)
    assert r["availability"] == "unavailable" and "SECRETA" not in repr(r)


def test_rota_canal_invalido_422_sem_eco():
    app = FastAPI()
    app.include_router(rota.router)
    app.dependency_overrides[get_db] = lambda: None
    r = TestClient(app).get("/api/v1/expedicao/despachados?channel=<script>")
    assert r.status_code == 422 and "script" not in r.text
