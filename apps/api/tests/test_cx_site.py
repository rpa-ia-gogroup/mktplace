"""CX do site (DTC) — `GET /api/v1/cx/site`.

O que estes testes existem para impedir:
  1. carga parada (Judge.me desde 26/10) virar "zero reviews";
  2. fonte caida derrubar os outros blocos ou vazar o texto da excecao;
  3. taxa de reenvio/reembolso sair sem faturamento (vira motivo, nao zero);
  4. marca fora da fonte (Apice no reenvio, Rituaria nas reviews) sumir sem motivo;
  5. PII nas consultas (nome, e-mail, pedido, comentario);
  6. entrada fora da allowlist ecoada; flag desligada abrir a rota.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.routers import cx_site as rota
from app.services import cx_site_service as svc

URL = "/api/v1/cx/site"
SEGREDO = "postgresql://usuario:senha-NAO-PODE-VAZAR@host/db"
AGORA = datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc)  # 12:00 em Sao Paulo
CARGA_EM_DIA = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)
CARGA_PARADA = datetime(2026, 10, 26, 4, 50, tzinfo=timezone.utc)

ROTAS = {
    "nps": svc.SQL_NPS, "nps_carga": svc.SQL_NPS_CARGA,
    "reenvio": svc.SQL_REENVIO, "reenvio_carga": svc.SQL_REENVIO_CARGA,
    "faturamento": svc.SQL_FATURAMENTO_SITE,
    "reviews": svc.SQL_REVIEWS, "reviews_carga": svc.SQL_REVIEWS_CARGA,
}


def _produto(marca, pid, nome, n, media, baixas):
    return {"marca": marca, "produto_id": pid, "produto": nome, "reviews": n,
            "soma": media * n, "baixas": baixas}


class Fonte:
    def __init__(self, falhas=(), sobrepor=None):
        self.falhas = set(falhas)
        self.dados = {
            "nps": [
                {"marca": "kokeshi", "respostas": 100, "promotores": 70, "detratores": 10},
                {"marca": "barbours", "respostas": 50, "promotores": 20, "detratores": 15},
            ],
            "nps_carga": [{"carregado_em": CARGA_EM_DIA}],
            "reenvio": [
                {"marca": "barbours", "reenvios": 10, "reembolsos": 5, "valor_reenvio": 1000,
                 "valor_reembolso": 500, "sem_valor": 2},
                {"marca": "kokeshi", "reenvios": 4, "reembolsos": 0, "valor_reenvio": 300,
                 "valor_reembolso": 0, "sem_valor": 0},
            ],
            "reenvio_carga": [{"carregado_em": CARGA_EM_DIA}],
            "faturamento": [{"marca": "barbours", "faturamento": 100000}],
            "reviews": [
                _produto("kokeshi", 1, "Sérum A", 40, 4.8, 1),
                _produto("kokeshi", 2, "Máscara B", 20, 3.0, 10),
                _produto("barbours", 3, "Pomada C", 12, 4.5, 1),
                _produto("barbours", 4, "Raro D", 3, 1.0, 3),  # abaixo do minimo: fora do ranking
                _produto("barbours", None, None, 5, 5.0, 0),  # sem produto: so' no total
            ],
            "reviews_carga": [{"carregado_em": CARGA_PARADA,
                               "ultima_review_em": datetime(2026, 10, 26, 4, 0, tzinfo=timezone.utc)}],
        }
        self.dados.update(sobrepor or {})
        self.chamadas = []

    def __call__(self, sql, params):
        nome = next(n for n, s in ROTAS.items() if s == sql)
        self.chamadas.append((nome, params))
        if nome in self.falhas:
            raise RuntimeError(f"falhou em {SEGREDO}")
        return self.dados[nome]


def _montar(**kw):
    fonte = kw.pop("fonte", None) or Fonte()
    return svc.montar_cx_site(consultar=fonte, agora=AGORA, **kw), fonte


# ---------------------------------------------------------------------------
# Safra e parametros
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("fim,dias,esperado", [
    (date(2026, 11, 6), 30, (date(2026, 10, 1), date(2026, 10, 31))),
    (date(2026, 11, 6), 90, (date(2026, 8, 1), date(2026, 10, 31))),
    (date(2026, 11, 30), 30, (date(2026, 11, 1), date(2026, 11, 30))),  # mes que acabou de fechar
    (date(2026, 1, 10), 90, (date(2025, 10, 1), date(2025, 12, 31))),
])
def test_safra_e_de_meses_fechados(fim, dias, esperado):
    assert svc.calcular_safra(svc.Janela(inicio=fim, fim=fim, dias=dias)) == esperado


def test_cobertura_por_fonte_e_parametros():
    resp, fonte = _montar()
    p = dict(fonte.chamadas)
    assert p["nps"]["marcas"] == ["apice", "barbours", "kokeshi", "lescent", "rituaria"]
    assert p["nps"]["inicio"] == date(2026, 10, 8) and p["nps"]["fim"] == date(2026, 11, 6)
    assert "apice" not in p["reenvio"]["marcas"]
    assert "rituaria" not in p["reviews"]["marcas"]
    assert p["reviews"]["inicio_ts"].isoformat() == "2026-10-08T00:00:00-03:00"
    assert [f.marca for f in resp.reenvio_reembolso.fora] == ["apice"]
    assert [f.marca for f in resp.reviews.fora] == ["rituaria"]


def test_consultas_nao_leem_pii():
    for sql in ROTAS.values():
        baixo = sql.lower()
        for campo in ("reviewer", "email", "comentario", "body", "numero_pedido", "pedido_ref", "ip_address"):
            assert campo not in baixo


# ---------------------------------------------------------------------------
# NPS
# ---------------------------------------------------------------------------
def test_nps_promotores_menos_detratores():
    nps = _montar()[0].nps
    assert nps.estado == "dado"
    assert nps.respostas == 150
    assert nps.nps == round((90 - 25) / 150 * 100, 1)
    assert [m.marca for m in nps.marcas] == ["barbours", "kokeshi"]  # pior primeiro
    assert nps.marcas[1].nps == 60.0
    assert nps.neutros_pct == round(35 / 150 * 100, 2)


# ---------------------------------------------------------------------------
# Reenvio / reembolso
# ---------------------------------------------------------------------------
def test_taxa_so_com_marcas_que_tem_faturamento():
    rr = _montar()[0].reenvio_reembolso
    assert rr.estado == "dado"
    assert (rr.reenvios, rr.reembolsos, rr.sem_valor) == (14, 5, 2)
    assert rr.valor_reenvio == 1300
    assert rr.taxa_reenvio_pct == 1.0 and rr.taxa_reembolso_pct == 0.5
    koke = next(m for m in rr.marcas if m.marca == "kokeshi")
    assert koke.faturamento is None and koke.taxa_reenvio_pct is None


def test_faturamento_caido_vira_motivo_e_nao_zero():
    rr = _montar(fonte=Fonte(falhas={"faturamento"}))[0].reenvio_reembolso
    assert rr.estado == "dado" and rr.reenvios == 14
    assert rr.taxa_reenvio_pct is None and rr.motivo_sem_taxa == svc.MOTIVO_SEM_FATURAMENTO


def test_so_apice_no_filtro_e_sem_fonte_sem_consultar():
    resp, fonte = _montar(brands=["apice"])
    assert resp.reenvio_reembolso.estado == "sem_fonte"
    assert "Ápice" in resp.reenvio_reembolso.motivo_indisponivel
    assert not any(n.startswith("reenvio") for n, _ in fonte.chamadas)


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------
def test_reviews_ranking_com_minimo_e_frescor_visivel():
    rv = _montar()[0].reviews
    assert rv.estado == "dado"
    assert rv.reviews == 80  # inclui o produto raro e a linha sem produto
    assert [p.produto for p in rv.piores] == ["Máscara B", "Pomada C", "Sérum A"]
    assert rv.melhores == []  # todos os elegiveis ja' estao nos piores
    assert rv.piores[0].baixas_pct == 50.0
    assert rv.aviso_frescor and "26/10" in rv.aviso_frescor


def test_carga_parada_sem_linhas_e_sem_fonte_nunca_zero():
    rv = _montar(fonte=Fonte(sobrepor={"reviews": []}))[0].reviews
    assert rv.estado == "sem_fonte"
    assert rv.reviews is None and "26/10" in rv.motivo_indisponivel


def test_carga_em_dia_sem_linhas_e_vazio_legitimo():
    fonte = Fonte(sobrepor={"reviews": [], "reviews_carga": [{"carregado_em": CARGA_EM_DIA}]})
    rv = _montar(fonte=fonte)[0].reviews
    assert rv.estado == "vazio_legitimo" and rv.aviso_frescor is None


# ---------------------------------------------------------------------------
# Isolamento
# ---------------------------------------------------------------------------
def test_uma_fonte_caida_nao_derruba_as_outras_nem_vaza_segredo():
    resp, _ = _montar(fonte=Fonte(falhas={"nps", "reviews_carga"}))
    assert resp.nps.estado == "erro" and resp.nps.nps is None
    assert resp.reenvio_reembolso.estado == "dado"
    assert resp.reviews.estado == "dado" and resp.reviews.atualizado_em is None
    assert "senha" not in resp.model_dump_json()


# ---------------------------------------------------------------------------
# Rota
# ---------------------------------------------------------------------------
@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(rota.router)
    monkeypatch.setattr(settings, "cx_api_enabled", True)
    chamadas = []
    original = svc.montar_cx_site

    def falso(*, brands=None, dias=30):
        chamadas.append((brands, dias))
        return original(brands=brands, dias=dias, consultar=Fonte(), agora=AGORA)

    monkeypatch.setattr(svc, "montar_cx_site", falso)
    return TestClient(app), chamadas


def test_flag_desligada_e_404(cliente, monkeypatch):
    c, chamadas = cliente
    monkeypatch.setattr(settings, "cx_api_enabled", False)
    assert c.get(URL).status_code == 404 and chamadas == []


def test_rota_repassa_filtros(cliente):
    c, chamadas = cliente
    r = c.get(URL, params={"brands": "Kokeshi", "dias": "90"})
    assert r.status_code == 200
    assert chamadas == [(["kokeshi"], 90)]
    assert r.json()["janela"]["dias"] == 90


@pytest.mark.parametrize("params", [{"brands": "<script>"}, {"dias": "7"}, {"dias": "abc"}])
def test_entrada_invalida_e_422_sem_eco(cliente, params):
    c, chamadas = cliente
    r = c.get(URL, params=params)
    assert r.status_code == 422 and chamadas == []
    assert "<script>" not in r.text and "abc" not in r.text
