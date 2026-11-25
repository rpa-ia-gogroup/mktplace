"""Denavita pelo TikTok do Data Mart (fonte provisoria, T-0119): tudo com dubles, nenhuma query real.

A conta do Bling da Denavita segue sem autorizacao. O TikTok dela vem de `gold.tiktok_brand_daily`
(`brand = 'denavita'`); a Shopee dela fica pendente (ausente, nunca 0) e o total das demais marcas
declara que e' parcial.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import marcas_menores_service as svc
from tests.test_marcas_menores import YENZAH_SHOPEE, YENZAH_TIKTOK, FakeBling, pedido

HOJE = date(2026, 11, 16)
OUT_INI, OUT_FIM = date(2026, 10, 1), date(2026, 10, 31)

#: Linhas da gold (grao marca x dia), ja' agregadas por dia como a consulta devolve.
#: Outubro fecha em R$ 43.763,45 e 412 pedidos (o medido); setembro e' o periodo anterior.
LINHAS = [
    {"dia": date(2026, 9, 20), "gmv": Decimal("30000.00"), "pedidos": 280},
    {"dia": date(2026, 9, 21), "gmv": Decimal("28522.28"), "pedidos": 263},
    {"dia": date(2026, 10, 2), "gmv": Decimal("10000.00"), "pedidos": 100},
    {"dia": date(2026, 10, 5), "gmv": Decimal("20000.45"), "pedidos": 200},
    {"dia": date(2026, 10, 30), "gmv": Decimal("13763.00"), "pedidos": 112},
]

BLING_OUT = {
    YENZAH_SHOPEE: [pedido(1, "2026-10-03", 100.0)],
    YENZAH_TIKTOK: [pedido(2, "2026-10-04", 10.0)],
}


class FakeDataMart:
    """Devolve as linhas da janela pedida e guarda cada consulta (SQL e parametros)."""

    def __init__(self, linhas=None, erro: Exception | None = None):
        self.linhas = LINHAS if linhas is None else linhas
        self.erro = erro
        self.chamadas: list[tuple[str, dict]] = []

    def __call__(self, sql, params):
        self.chamadas.append((sql, dict(params)))
        if self.erro is not None:
            raise self.erro
        return [dict(l) for l in self.linhas if params["inicio"] <= l["dia"] <= params["fim"]]


@pytest.fixture(autouse=True)
def _limpo():
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def _marcas(r):
    return {m["id"]: m for m in r["marcas"]}


def _out(dm, bling=None):
    return svc.get_marcas_menores(FakeBling(bling or BLING_OUT), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm)


def test_a_denavita_outubro_e_a_soma_das_linhas_com_status_provisorio_e_aviso():
    dm = FakeDataMart()
    r = _out(dm)
    d = _marcas(r)["denavita"]
    assert d["total"] == pytest.approx(43763.45)
    assert d["pedidos"] == 412
    assert d["status"] == "parcial_fonte_provisoria"
    assert "gold.tiktok_brand_daily" in d["aviso"] and "Shopee pendente" in d["aviso"]
    assert "Bling sem autorização" in d["aviso"]
    assert d["motivo"] is None
    # So' TikTok: a Shopee da Denavita fica ausente, nunca 0.
    assert [(p["plataforma"], round(p["faturamento"], 2)) for p in d["por_plataforma"]] == [("TIKTOK", 43763.45)]
    assert d["pedidos_por_plataforma"] == {"TIKTOK": 412}
    assert "SHOPEE" not in d["por_plataforma_anterior"] and "SHOPEE" not in d["pedidos_por_plataforma"]
    # Periodo anterior (mesma duracao, colado antes): setembro.
    assert d["total_anterior"] == pytest.approx(58522.28)
    assert d["por_plataforma_anterior"] == {"TIKTOK": pytest.approx(58522.28)}
    assert d["pedidos_por_plataforma_anterior"] == {"TIKTOK": 543}


def test_a_consulta_e_parametrizada_e_sempre_filtra_a_denavita_e_a_janela():
    dm = FakeDataMart()
    _out(dm)
    assert len(dm.chamadas) == 1  # atual + anterior numa consulta so'
    sql, params = dm.chamadas[0]
    assert "gold.tiktok_brand_daily" in sql
    assert ":brand" in sql and ":inicio" in sql and ":fim" in sql
    assert "denavita" not in sql and "2026-" not in sql  # nada de valor colado no SQL
    assert params == {"brand": "denavita", "inicio": date(2026, 8, 31), "fim": OUT_FIM}


def test_b_dia_sem_linha_fica_fora_da_serie():
    r = _out(FakeDataMart())
    serie = _marcas(r)["denavita"]["serie"]
    assert [s["data"] for s in serie] == [date(2026, 10, 2), date(2026, 10, 5), date(2026, 10, 30)]
    assert all(s["faturamento"] > 0 for s in serie)  # nenhum dia inventado com 0
    assert serie[0]["por_plataforma"] == {"TIKTOK": 10000.0}
    assert serie[0]["pedidos_por_plataforma"] == {"TIKTOK": 100}


def test_b_janela_sem_linha_e_sem_dado_nao_zero():
    r = _out(FakeDataMart(linhas=[]))
    d = _marcas(r)["denavita"]
    assert d["total"] is None and d["pedidos"] is None and d["serie"] == [] and d["por_plataforma"] == []
    assert d["status"] == "parcial_fonte_provisoria"  # a fonte respondeu: so' nao houve venda


def test_b_linha_com_gmv_nulo_nao_vira_zero():
    linhas = [{"dia": date(2026, 10, 2), "gmv": None, "pedidos": None}, {"dia": date(2026, 10, 3), "gmv": Decimal("5.5"), "pedidos": 1}]
    d = _marcas(_out(FakeDataMart(linhas=linhas)))["denavita"]
    assert [s["data"] for s in d["serie"]] == [date(2026, 10, 3)] and d["total"] == 5.5


@pytest.mark.parametrize("erro", [RuntimeError("datamart indisponivel"), Exception("OperationalError host=x senha=y")])
def test_c_data_mart_com_erro_devolve_none_com_motivo_e_as_outras_marcas_intactas(erro):
    r = _out(FakeDataMart(erro=erro))
    m = _marcas(r)
    d = m["denavita"]
    assert d["total"] is None and d["pedidos"] is None and d["serie"] == [] and d["por_plataforma"] == []
    assert d["status"] == "fonte_indisponivel"
    assert "Data Mart indisponível" in d["motivo"]
    assert "senha" not in d["motivo"] and "host" not in d["motivo"]  # o texto da excecao nunca sai
    assert m["yenzah"]["total"] == 110.0 and m["yenzah"]["status"] == "ok"
    assert r["disponivel"] is True and r["consolidado"]["total"] == 110.0  # ausencia da Denavita nao vira 0 nem derruba


def test_c_engine_none_pelo_caminho_real_tambem_e_indisponivel(monkeypatch):
    from app import database
    from app.config import settings
    from app.services import datamart_leitura

    monkeypatch.setattr(database, "datamart_engine", None)
    monkeypatch.setattr(settings, "metabase_api_key", "")  # sem reserva pelo Metabase: nenhuma rede
    datamart_leitura.limpar_cache()
    r = svc.get_marcas_menores(FakeBling(BLING_OUT), OUT_INI, OUT_FIM, HOJE, consultar_dm=svc.consultar_datamart)
    d = _marcas(r)["denavita"]
    assert d["total"] is None and "Data Mart indisponível" in d["motivo"]
    assert _marcas(r)["yenzah"]["total"] == 110.0


def test_c_sem_consulta_injetada_nao_toca_o_data_mart():
    """Chamada direta ao servico (rotina, testes do Bling) nao depende do Data Mart."""
    r = svc.get_marcas_menores(FakeBling(BLING_OUT), OUT_INI, OUT_FIM, HOJE)
    d = _marcas(r)["denavita"]
    assert d["total"] is None and d["status"] == "fonte_indisponivel" and d["motivo"]


def test_d_total_das_demais_marcas_declara_parcial():
    r = _out(FakeDataMart())
    c = r["consolidado"]
    assert c["parcial"] is True
    assert "Denavita" in c["aviso"] and "Shopee" in c["aviso"]
    assert c["total"] == pytest.approx(43763.45 + 110.0)  # a Denavita (TikTok) entra no total, declarado parcial
    assert c["pedidos_por_plataforma"] == {"SHOPEE": 1, "TIKTOK": 413}
    # Data Mart fora: segue parcial (a Denavita inteira falta), com o motivo.
    fora = _out(FakeDataMart(erro=RuntimeError("x")))["consolidado"]
    assert fora["parcial"] is True and "Denavita" in fora["aviso"]


def test_bling_fora_nao_consulta_o_data_mart():
    class Quebra(FakeBling):
        def get(self, caminho, params=None):
            from app.services.bling_token import BlingIndisponivel

            raise BlingIndisponivel("Bling indisponível agora.")

    dm = FakeDataMart()
    r = svc.get_marcas_menores(Quebra(), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm)
    assert r["disponivel"] is False and dm.chamadas == []


def test_produtos_da_denavita_sem_dado_com_o_motivo_certo():
    r = svc.get_produtos(FakeBling(BLING_OUT, {1: [], 2: []}), OUT_INI, OUT_FIM, HOJE)
    d = {m["id"]: m for m in r["marcas"]}["denavita"]
    assert d["produtos"] == [] and d["receita_itens"] is None and d["gmv_pedidos"] is None  # nunca 0
    assert d["status"] == "aguardando_autorizacao"
    assert "Bling" in d["motivo"] and "sem autorização" in d["motivo"]


def test_rota_entrega_aviso_motivo_e_parcial_depois_do_response_model(monkeypatch):
    from app.database import get_db
    from app.routers import marcas_menores as rota

    monkeypatch.setattr(rota, "cliente_bling", lambda db: FakeBling(BLING_OUT, {1: [], 2: []}))
    monkeypatch.setattr(svc, "consultar_datamart", FakeDataMart())
    app.dependency_overrides[get_db] = lambda: None
    try:
        c = TestClient(app)
        r = c.get("/api/v1/performance/marcas-menores?date_from=2026-10-01&date_to=2026-10-31")
        assert r.status_code == 200, r.text
        corpo = r.json()
        d = _marcas(corpo)["denavita"]
        assert d["status"] == "parcial_fonte_provisoria" and "gold.tiktok_brand_daily" in d["aviso"]
        assert round(d["total"], 2) == 43763.45
        assert corpo["consolidado"]["parcial"] is True and corpo["consolidado"]["aviso"]
        p = c.get("/api/v1/performance/marcas-menores/produtos?date_from=2026-10-01&date_to=2026-10-31")
        assert p.status_code == 200, p.text
        pd = {m["id"]: m for m in p.json()["marcas"]}["denavita"]
        # sem sessao de banco (override acima) a rota nao acha o token: o motivo e' o dela, nao um texto fixo
        assert pd["status"] == "aguardando_autorizacao" and pd["motivo"] == "Bling da Denavita: banco indisponível."
    finally:
        app.dependency_overrides.pop(get_db, None)
