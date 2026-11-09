"""CURVA-ABC-1 -- curva ABC do /full (planilha 'Sortimento Gobeaute').

Protege: duplicata da fonte (vale o maior faturamento e a lista volta),
formato inesperado, sem credencial = indisponivel sem tocar a rede, cache de
1 h (vencido serve o antigo), ponte de GTIN (o direto vence) e a rota.
Dados ficticios; nenhuma chamada real ao Google.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services import full_curva_abc_service as svc

CAB = ["Empresa", "SKU Único", "Chave Auxiliar", "Curva", "Faturamento", "%"]
LINHAS = [
    CAB,
    ["Apice", "20690", "AP-20690", "AA", "6.074.200,18", "7,41"],
    ["Apice", "20690", "AP-20690", "C", "1.200,00", "0,01"],      # duplicata: vale a AA
    ["Barbour's", "BB02027", "BB-BB02027", "A", "900,00", "1"],
    ["Rituária", "RT01002", "RT-RT01002", "B", "800,00", "1"],
    ["Lescent", "LC02002", "LS-LC02002", "X", "10,00", "0"],       # curva invalida: fora
    ["", "", "", "", "", ""],
]
AGORA = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)


def test_interpreta_marca_normalizada_e_duplicata_pelo_maior_faturamento():
    p = svc.interpretar(LINHAS, AGORA)
    assert p.curvas == {("apice", "20690"): "AA", ("barbours", "BB02027"): "A", ("rituaria", "RT01002"): "B"}
    assert p.duplicadas == [("apice", "20690")]


def test_formato_inesperado_nao_vira_curva():
    with pytest.raises(svc.FormatoInesperado):
        svc.interpretar([["Empresa", "Codigo", "Classe"]], AGORA)
    with pytest.raises(svc.FormatoInesperado):
        svc.interpretar([], AGORA)


def test_sem_credencial_e_indisponivel_sem_rede(monkeypatch):
    monkeypatch.delenv(svc.ENV_CREDENCIAL, raising=False)
    cache = svc._Cache()
    planilha, motivo = svc.obter_planilha(cache=cache)
    assert planilha is None and motivo == svc.MOTIVO_SEM_CREDENCIAL
    r = svc.get_curva_abc(None, obter=lambda: (planilha, motivo))
    assert r["status"] == "unavailable" and r["motivo"] == svc.MOTIVO_SEM_CREDENCIAL


def test_credencial_ilegivel_tambem_e_indisponivel(monkeypatch):
    monkeypatch.setenv(svc.ENV_CREDENCIAL, "{nao e json")
    planilha, motivo = svc.obter_planilha(cache=svc._Cache())
    assert planilha is None and motivo == svc.MOTIVO_SEM_CREDENCIAL


def test_cache_de_1h_e_vencido_serve_o_antigo_e_atualiza():
    t = [1000.0]
    leituras = []

    def ler():
        leituras.append(t[0])
        return LINHAS

    cache = svc._Cache()
    p1, m1 = svc.obter_planilha(cache=cache, ler=ler, relogio=lambda: t[0], em_segundo_plano=False)
    assert p1 is not None and m1 is None and len(leituras) == 1
    t[0] += 1800  # meia hora: cache vale
    svc.obter_planilha(cache=cache, ler=ler, relogio=lambda: t[0], em_segundo_plano=False)
    assert len(leituras) == 1
    t[0] += svc.CACHE_SEGUNDOS  # vencido: le de novo
    svc.obter_planilha(cache=cache, ler=ler, relogio=lambda: t[0], em_segundo_plano=False)
    assert len(leituras) == 2


def test_leitura_falhando_mantem_a_planilha_anterior_e_sem_nada_e_indisponivel():
    t = [1000.0]
    cache = svc._Cache()

    def quebra():
        raise RuntimeError("rede")

    p, m = svc.obter_planilha(cache=cache, ler=quebra, relogio=lambda: t[0], em_segundo_plano=False)
    assert p is None and m == svc.MOTIVO_LEITURA
    t[0] += svc.CACHE_SEGUNDOS
    svc.obter_planilha(cache=cache, ler=lambda: LINHAS, relogio=lambda: t[0], em_segundo_plano=False)
    t[0] += svc.CACHE_SEGUNDOS
    p, m = svc.obter_planilha(cache=cache, ler=quebra, relogio=lambda: t[0], em_segundo_plano=False)
    assert p is not None, "a planilha anterior segue valendo"


class _R:
    def __init__(self, linhas):
        self._l = linhas

    def mappings(self):
        return self

    def all(self):
        return self._l


class _Sessao:
    def __init__(self, ponte):
        self.ponte, self.comandos = ponte, []

    def execute(self, stmt, params=None):
        self.comandos.append(stmt)
        return _R(self.ponte if stmt is svc.SQL_PONTE else [])


def test_ponte_de_gtin_soma_o_sku_do_canal_e_o_direto_vence():
    planilha = svc.interpretar(LINHAS, AGORA)
    s = _Sessao([
        {"brand": "barbours", "seller_sku": "10009", "source_sku": "BB02027"},   # pela ponte
        {"brand": "apice", "seller_sku": "20690", "source_sku": "BB02027"},      # direto vence
        {"brand": "kokeshi", "seller_sku": "40125", "source_sku": "KS99999"},    # sem curva
    ])
    r = svc.get_curva_abc(s, obter=lambda: (planilha, None))
    assert r["status"] == "ok"
    assert r["curva_por_sku"]["barbours|10009"] == "A"
    assert r["curva_por_sku"]["apice|20690"] == "AA"
    assert "kokeshi|40125" not in r["curva_por_sku"], "sem ponte = sem curva, nunca C"
    assert r["pela_ponte_gtin"] == 1 and r["duplicadas"] == ["apice|20690"]
    assert s.comandos[0] is svc.SQL_SOMENTE_LEITURA


def test_somente_leitura_e_sem_escrita_no_modulo():
    src = open(svc.__file__, encoding="utf-8").read().upper()
    for escrita in ("INSERT ", "UPDATE ", "DELETE ", "DROP ", "TRUNCATE ", "ALTER ", "CREATE "):
        assert escrita not in src, escrita
    assert "SPREADSHEETS.READONLY" in src


def test_rota_sem_credencial_responde_200_indisponivel(monkeypatch):
    from fastapi.testclient import TestClient
    from app.database import get_db
    from app.main import app

    monkeypatch.delenv(svc.ENV_CREDENCIAL, raising=False)
    monkeypatch.setattr(svc, "_cache", svc._Cache())
    app.dependency_overrides[get_db] = lambda: None
    try:
        r = TestClient(app).get("/api/v1/performance/full-curva-abc")
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert r.status_code == 200
    assert r.json()["status"] == "unavailable"
    assert r.json()["motivo"] == svc.MOTIVO_SEM_CREDENCIAL
