"""PRODUTOS-GAP — quais SKUs explicam a queda contra ontem/semana passada, no mesmo corte de hora."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import datamart_leitura
from app.services import hoje_por_hora_service as hph
from app.services import produtos_gap_service as S

BRT = timezone(timedelta(hours=-3))
AGORA = datetime(2026, 11, 25, 15, 41, tzinfo=BRT)
FONTES = {2: datetime(2026, 11, 25, 15, 26, tzinfo=BRT),   # ML  -> corte 15
          3: datetime(2026, 11, 25, 14, 50, tzinfo=BRT),   # Shopee -> corte 14
          1: datetime(2026, 11, 25, 15, 35, tzinfo=BRT)}   # TikTok -> corte 15


class _R:
    def __init__(self, linhas=(), escalar=None):
        self.linhas, self.escalar = list(linhas), escalar

    def scalar(self):
        return self.escalar

    def __iter__(self):
        return iter(self.linhas)


class Sessao:
    def __init__(self, fontes=FONTES, existe=True):
        self.fontes, self.existe = fontes, existe

    def execute(self, sql, params=None):
        if "to_regclass" in str(sql):
            return _R(escalar=self.existe)
        return _R([(m, f) for m, f in self.fontes.items() if m in params["m"]])


def v(canal, sku, janela, pecas, receita, nome=None):
    return {"canal": canal, "sku": sku, "nome": nome or f"Produto {sku}", "janela": janela,
            "pecas": pecas, "receita": receita}


class Consulta:
    def __init__(self, linhas):
        self.linhas, self.chamadas = linhas, []

    def __call__(self, sql, params):
        self.chamadas.append((sql, params))
        return self.linhas


@pytest.fixture(autouse=True)
def sem_estoque(monkeypatch):
    # Estoque desligado por padrao; os testes de estoque ligam.
    monkeypatch.setattr(S.settings, "ml_full_stock_api_enabled", False, raising=False)
    monkeypatch.setattr(S.settings, "shopee_fbs_stock_enabled", False, raising=False)


def gap(linhas, marca="kokeshi", canais=None, comparar="ontem", limite=10, sessao=None):
    c = Consulta(linhas)
    r = S.get_produtos_gap(sessao or Sessao(), c, marca, canais, comparar, limite, agora=AGORA)
    return r, c


def test_uma_consulta_so_com_o_corte_de_cada_canal():
    r, c = gap([v("ml", "A", "hoje", 1, 10), v("shopee", "A", "hoje", 1, 10), v("tiktok", "A", "hoje", 1, 10)])
    assert len(c.chamadas) == 1, "uma vaga na fila do Metabase"
    sql, p = c.chamadas[0]
    assert (p["corte_ml"], p["corte_shopee"], p["corte_tiktok"]) == (15, 14, 15)
    assert p["hoje"] == date(2026, 11, 25) and p["comp"] == date(2026, 11, 24)
    assert sql.count("UNION ALL") == 2
    assert {e["canal"]: e["corte_hora"] for e in r["canais"]} == {"ml": 15, "shopee": 14, "tiktok": 15}
    datamart_leitura.renderizar(sql, p)  # a reserva pelo Metabase escreve todos os parametros


def test_semana_passada_e_so_um_canal():
    r, c = gap([v("ml", "A", "hoje", 1, 10)], canais=["ml"], comparar="semana_passada")
    sql, p = c.chamadas[0]
    assert p["comp"] == date(2026, 11, 18) and "UNION ALL" not in sql and "corte_shopee" not in p
    assert r["dia_comparado"] == "2026-11-18" and [e["canal"] for e in r["canais"]] == ["ml"]


def test_ranking_diferenca_preco_e_totais():
    linhas = [
        v("ml", "A", "hoje", 10, 500), v("ml", "A", "comp", 20, 1500),       # -1000, preco 50 vs 75
        v("ml", "B", "hoje", 5, 100), v("ml", "B", "comp", 5, 400),          # -300
        v("ml", "C", "hoje", 4, 800),                                          # novo: +800, sem comparado
        v("ml", "D", "comp", 3, 90),                                           # zero hoje (medido): -90
        v("ml", "E", "hoje", 2, 60), v("ml", "E", "comp", 1, 30),            # +30
    ]
    r, _ = gap(linhas, canais=["ml"], limite=2)
    assert [i["sku"] for i in r["maiores_quedas"]] == ["A", "B"], "ordenado pelo maior gap em R$, respeita o limite"
    a = r["maiores_quedas"][0]
    assert (a["receita_hoje"], a["receita_comparado"], a["diferenca_rs"], a["diferenca_pct"]) == (500, 1500, -1000, -66.7)
    assert (a["preco_medio_hoje"], a["preco_medio_comparado"], a["variacao_preco_pct"]) == (50, 75, -33.3)
    assert [i["sku"] for i in r["maiores_altas"]] == ["C", "E"]
    c = r["maiores_altas"][0]
    assert c["diferenca_pct"] is None and c["preco_medio_comparado"] is None and c["variacao_preco_pct"] is None, "sem base = ausencia"
    assert r["total"] == {"receita_hoje": 1460, "receita_comparado": 2020, "diferenca_rs": -560, "diferenca_pct": -27.7}
    assert r["skus_considerados"] == 5
    # D vendeu ontem e nada hoje: zero medido (o canal tem dado), fora do top 2 so' pelo limite.
    r2, _ = gap(linhas, canais=["ml"], limite=10)
    d = next(i for i in r2["maiores_quedas"] if i["sku"] == "D")
    assert d["pecas_hoje"] == 0 and d["receita_hoje"] == 0 and d["preco_medio_hoje"] is None


def test_altas_no_maximo_cinco():
    linhas = [v("ml", f"S{i}", "hoje", 1, 10 + i) for i in range(8)]
    r, _ = gap(linhas, canais=["ml"])
    assert len(r["maiores_altas"]) == 5 and r["maiores_quedas"] == []


def test_soma_do_mesmo_sku_entre_canais_com_detalhe_por_canal():
    r, _ = gap([v("ml", "A", "hoje", 1, 100), v("ml", "A", "comp", 2, 300),
                v("shopee", "A", "hoje", 1, 50), v("shopee", "A", "comp", 1, 90)])
    [a] = r["maiores_quedas"]
    assert (a["receita_hoje"], a["receita_comparado"], a["diferenca_rs"]) == (150, 390, -240)
    assert {p["canal"]: p["diferenca_rs"] for p in a["por_canal"]} == {"ml": -200, "shopee": -40}


def test_canal_sem_dado_fica_fora_dos_totais_e_e_dito():
    # Apice nao tem ML; TikTok sem nenhum pedido nos dois dias; Shopee com dado.
    r, c = gap([v("shopee", "A", "hoje", 1, 10), v("shopee", "A", "comp", 1, 40)], marca="apice")
    est = {e["canal"]: e for e in r["canais"]}
    assert est["ml"]["estado"] == "sem_dado" and "Mercado Livre" in est["ml"]["motivo"]
    assert est["tiktok"]["estado"] == "sem_dado" and est["tiktok"]["corte_hora"] is None
    assert est["shopee"]["estado"] == "medido"
    assert "corte_ml" not in c.chamadas[0][1], "canal sem loja nem e' consultado"
    assert r["total"]["diferenca_rs"] == -30
    assert any("fora dos totais" in m for m in r["limitacoes"])


def test_linha_de_canal_sem_dado_nao_entra():
    r, _ = gap([v("shopee", "A", "hoje", 1, 10)], canais=["ml"])
    assert r["disponivel"] is False and r["total"] is None and r["maiores_quedas"] == [] and r["skus_considerados"] is None


def test_sem_fato_por_hora_nao_ha_corte_nem_consulta():
    r, c = gap([], sessao=Sessao(existe=False))
    assert c.chamadas == [] and r["disponivel"] is False and r["total"] is None
    assert all(e["estado"] == "sem_dado" for e in r["canais"])


def test_corte_zero_a_meia_noite():
    manha = datetime(2026, 11, 25, 0, 20, tzinfo=BRT)
    c = Consulta([])
    r = S.get_produtos_gap(Sessao({2: datetime(2026, 11, 24, 23, 40, tzinfo=BRT)}), c, "kokeshi", ["ml"], "ontem", 10, agora=manha)
    assert c.chamadas == [] and r["canais"][0]["motivo"].startswith("Nenhuma hora")


def test_estoque_classificacao_e_vendedor_ao_lado_do_full(monkeypatch):
    monkeypatch.setattr(S.settings, "ml_full_stock_api_enabled", True, raising=False)
    monkeypatch.setattr(S.settings, "shopee_fbs_stock_enabled", True, raising=False)
    ml = SimpleNamespace(inventarios=[SimpleNamespace(sku="A", disponivel=0, classificacao_torre="RUPTURA_CANDIDATA"),
                                      SimpleNamespace(sku="B", disponivel=None, classificacao_torre="SEM_LEITURA")])
    row = lambda sku, full, vend, cls: SimpleNamespace(item_sku=sku, full_stock_saleable=full, seller_stock_total=vend, classificacao_torre=cls)
    sh = SimpleNamespace(produtos=[row("A", 0, 36000, "RUPTURA_CANDIDATA"), row("A", 3, 100, "SUFICIENTE"), row("Z", 9, None, "SUFICIENTE")])
    monkeypatch.setattr(S.ml_stock, "get_ml_full_estoque_block", lambda *a, **k: ml)
    monkeypatch.setattr(S.fbs_stock, "get_estoque_full_block", lambda *a, **k: sh)
    r, _ = gap([v("ml", "A", "comp", 5, 500), v("ml", "B", "comp", 5, 400), v("ml", "C", "comp", 5, 300),
                v("shopee", "A", "comp", 5, 500)], canais=None)
    por = {i["sku"]: {e["canal"]: e for e in i["estoque"]} for i in r["maiores_quedas"]}
    assert por["A"]["ml"]["full_vendavel"] == 0 and por["A"]["ml"]["classificacao"] == "RUPTURA_CANDIDATA"
    # varias linhas do mesmo SKU: soma o Full, soma o vendedor, pior classificacao
    assert por["A"]["shopee"]["full_vendavel"] == 3
    assert por["A"]["shopee"]["estoque_vendedor_fora_do_full"] == 36100
    assert por["A"]["shopee"]["classificacao"] == "RUPTURA_CANDIDATA"
    assert por["B"]["ml"]["estado"] == "sem_dado" and por["B"]["ml"]["full_vendavel"] is None, "sem leitura nao vira 0"
    assert por["C"]["ml"]["estado"] == "sem_dado" and por["C"]["ml"]["classificacao"] is None, "SKU fora da fotografia"
    assert "shopee" not in por["C"] and "shopee" not in por["B"], "so' o canal em que o SKU vendeu"


def test_estoque_desligado_vira_limitacao_e_sem_dado():
    r, _ = gap([v("ml", "A", "comp", 5, 500)], canais=["ml"])
    assert r["maiores_quedas"][0]["estoque"][0]["estado"] == "sem_dado"
    assert any("Estoque Full do ML" in m for m in r["limitacoes"])


def test_sem_dado_pessoal_nas_chaves():
    r, _ = gap([v("ml", "A", "hoje", 1, 10), v("ml", "A", "comp", 2, 20)], canais=["ml"])
    chaves = set(r["maiores_quedas"][0]) | set(r)
    assert not chaves & {"buyer_id", "comprador", "cpf", "buyer_nickname"}


def test_rota_valida_a_entrada_antes_de_qualquer_banco():
    from fastapi.testclient import TestClient

    from app.main import app

    cli = TestClient(app)
    base = "/api/v1/performance/produtos-gap"
    for params in ({}, {"brand": "azbuy"}, {"brand": "kokeshi", "canal": "site"},
                   {"brand": "kokeshi", "comparar": "mes"}, {"brand": "kokeshi", "limite": 0},
                   {"brand": "kokeshi", "limite": 51}):
        assert cli.get(base, params=params).status_code == 422, params
