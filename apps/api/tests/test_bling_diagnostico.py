"""Diagnostico admin do Bling da Denavita: canais, mapa de lojas e pedidos por loja e semana. Tudo com dubles."""
from __future__ import annotations

import json
from datetime import date

import pytest
from pydantic import SecretStr

from app.config import settings
from app.gate_sessao import decidir
from app.routers import bling_diagnostico as rota
from app.services import bling_diagnostico_service as diag
from app.services import marcas_menores_service as svc
from app.sessao import SESSION_COOKIE
from tests.test_bling_denavita import ADMIN, SEGREDO, _sessao, cli, db  # noqa: F401  (fixtures)

DE, ATE = date(2026, 10, 15), date(2026, 11, 25)
ML, SHOPEE_VELHA, TIKTOK, SHOPEE_NOVA = 9001, 9002, 9003, 9005

CANAIS = [
    {"id": ML, "tipo": "MercadoLivre", "descricao": "Mercado Livre Denavita", "situacao": "Ativo"},
    {"id": SHOPEE_VELHA, "tipo": "Shopee", "descricao": "Shopee", "situacao": "Inativo"},
    {"id": TIKTOK, "tipo": "TikTokShop", "descricao": "TikTok Shop", "situacao": "Ativo"},
    # Canal novo com outro nome: nem "shopee" nem "mercadolivre" no tipo/descricao -> o mapeamento nao o pega.
    {"id": SHOPEE_NOVA, "tipo": "Marketplace", "descricao": "Loja Nova XYZ", "situacao": "Ativo"},
]


def _pedido(i, dia, total, loja):
    return {
        "id": i, "numero": str(i), "data": dia, "total": total, "situacao": {"id": 9}, "loja": {"id": loja},
        # dado pessoal que NUNCA pode sair
        "contato": {"nome": "Fulano de Tal", "numeroDocumento": "123.456.789-00", "email": "fulano@exemplo.com"},
    }


PEDIDOS = (
    [_pedido(100 + i, f"2026-10-{15 + i:02d}", 50.0, ML) for i in range(0, 10)]
    + [_pedido(200, "2026-10-16", 80.0, SHOPEE_VELHA), _pedido(201, "2026-10-22", 80.0, SHOPEE_VELHA)]
    + [_pedido(300, "2026-10-20", 30.0, TIKTOK)]
    + [_pedido(400, "2026-10-28", 90.0, SHOPEE_NOVA), _pedido(401, "2026-11-10", 90.0, SHOPEE_NOVA)]
)


class FakeDiag:
    """Conta da Denavita: canais e a lista de pedidos de TODAS as lojas (sem idLoja), paginada."""

    def __init__(self, canais=CANAIS, pedidos=PEDIDOS):
        self.canais, self.pedidos, self.chamadas = canais, pedidos, []

    def get(self, caminho, params=None):
        self.chamadas.append((caminho, params))
        if caminho == "/canais-venda":
            return {"data": self.canais}
        assert caminho == "/pedidos/vendas" and "idLoja" not in params, "o diagnostico le' SEM filtro de loja"
        ini, fim = params["dataInicial"], params["dataFinal"]
        todos = [p for p in self.pedidos if ini <= p["data"] <= fim]
        pg, lim = params["pagina"], params["limite"]
        return {"data": todos[(pg - 1) * lim: pg * lim]}


@pytest.fixture(autouse=True)
def _limpo(monkeypatch):
    monkeypatch.setattr(settings, "auth_secret", SecretStr(SEGREDO))
    monkeypatch.setattr(settings, "bling_denavita_lojas", "")
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def test_canais_com_a_plataforma_que_o_mapeamento_deu_e_o_mapa_atual():
    r = diag.diagnosticar(FakeDiag(), DE, ATE)
    por_id = {c["id"]: c for c in r["canais"]}
    assert por_id[ML]["plataforma"] == "MELI" and por_id[SHOPEE_VELHA]["plataforma"] == "SHOPEE"
    assert por_id[TIKTOK]["plataforma"] is None, "TikTok do Bling nunca entra (o dela vem do Data Mart)"
    assert por_id[SHOPEE_NOVA]["plataforma"] is None and por_id[SHOPEE_NOVA]["descricao"] == "Loja Nova XYZ"
    assert por_id[SHOPEE_VELHA]["situacao"] == "Inativo" and por_id[SHOPEE_VELHA]["tipo"] == "Shopee"
    assert r["mapa_atual"] == {str(ML): "MELI", str(SHOPEE_VELHA): "SHOPEE"} and r["erro_mapa"] is None


def test_pedidos_por_loja_e_semana_incluindo_loja_fora_do_mapa():
    r = diag.diagnosticar(FakeDiag(), DE, ATE)
    lojas = {l["loja_id"]: l for l in r["lojas"]}
    assert lojas[ML]["pedidos"] == 10 and lojas[ML]["valor"] == 500.0 and lojas[ML]["no_mapa"] is True
    shopee = lojas[SHOPEE_VELHA]
    assert shopee["pedidos"] == 2 and shopee["ultimo_pedido"] == "2026-10-22", "a Shopee mapeada para em 22/10"
    sem = {x["semana"]: x["pedidos"] for x in shopee["por_semana"]}
    assert sem["2026-10-12"] == 1 and sem["2026-10-19"] == 1 and sem["2026-10-26"] == 0 and sem["2026-11-09"] == 0
    nova = lojas[SHOPEE_NOVA]
    assert nova["no_mapa"] is False and nova["plataforma"] is None and nova["pedidos"] == 2
    assert nova["canal"] == {"tipo": "Marketplace", "descricao": "Loja Nova XYZ", "situacao": "Ativo"}
    assert {x["semana"]: x["pedidos"] for x in nova["por_semana"]}["2026-10-26"] == 1
    assert sorted(r["fora_do_mapa"]) == sorted([SHOPEE_NOVA, TIKTOK])
    assert r["pedidos_lidos"] == len(PEDIDOS) and r["truncado"] is False
    assert [s["semana"] for s in shopee["por_semana"]][0] == "2026-10-12" and len(shopee["por_semana"]) == 7


def test_loja_conhecida_sem_pedido_aparece_com_zero_e_pedido_sem_loja_vira_none():
    pedidos = [_pedido(1, "2026-11-02", 10.0, ML), {"id": 2, "data": "2026-11-03", "total": 5.0}]
    r = diag.diagnosticar(FakeDiag(pedidos=pedidos), DE, ATE)
    lojas = {l["loja_id"]: l for l in r["lojas"]}
    assert lojas[SHOPEE_VELHA]["pedidos"] == 0 and lojas[SHOPEE_VELHA]["ultimo_pedido"] is None, "zero medido, nao ausente"
    assert lojas[None]["pedidos"] == 1 and lojas[None]["no_mapa"] is False


def test_sem_dado_pessoal_nem_token_na_resposta():
    texto = json.dumps(diag.diagnosticar(FakeDiag(), DE, ATE), ensure_ascii=False)
    for proibido in ("Fulano", "123.456", "fulano@", "numeroDocumento", "contato", "token", "Bearer"):
        assert proibido not in texto


def test_truncado_quando_bate_no_teto_de_paginas(monkeypatch):
    monkeypatch.setattr(svc, "MAX_PAGINAS", 2)
    monkeypatch.setattr(svc, "LIMITE", 3)
    r = diag.diagnosticar(FakeDiag(), DE, ATE)
    assert r["pedidos_lidos"] == 6 and r["truncado"] is True


def test_mapa_novo_entra_sem_reinicio_com_atualizar():
    """A rotina chama `lojas_denavita(atualizar=True)`: um canal Shopee criado depois entra no ciclo seguinte."""
    f = FakeDiag(canais=CANAIS[:3])
    assert set(svc.lojas_denavita(f)) == {ML, SHOPEE_VELHA}
    f.canais = CANAIS[:3] + [{"id": 9009, "tipo": "Shopee", "descricao": "Shopee Nova", "situacao": "Ativo"}]
    assert set(svc.lojas_denavita(f)) == {ML, SHOPEE_VELHA}, "sem atualizar, vale a memoria"
    assert set(svc.lojas_denavita(f, atualizar=True)) == {ML, SHOPEE_VELHA, 9009}


# ---------------------------------------------------------------- rota

URL = f"/api/v1/bling/diagnostico/denavita?de={DE}&ate={ATE}"


def test_rota_so_admin_e_fora_dos_caminhos_publicos(cli, monkeypatch):  # noqa: F811
    base = dict(metodo="GET", cookie_sessao=None, chave_servico=None, modo="enforce", segredo=SEGREDO,
                dominios=("gocase.com",), chave_servico_esperada="")
    assert not decidir(caminho="/api/v1/bling/diagnostico/denavita", **base).liberar
    assert cli.get(URL).status_code == 401
    cli.cookies.set(SESSION_COOKIE, _sessao("outro@gocase.com"))
    assert cli.get(URL).status_code == 403
    cli.cookies.set(SESSION_COOKIE, _sessao(ADMIN))
    monkeypatch.setattr(rota, "cliente_denavita", lambda db: (FakeDiag(), None))
    r = cli.get(URL)
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["periodo"] == {"de": str(DE), "ate": str(ATE)} and corpo["fora_do_mapa"]
    assert "Fulano" not in r.text


def test_rota_valida_o_periodo_e_diz_por_que_nao_tem_cliente(cli, monkeypatch):  # noqa: F811
    cli.cookies.set(SESSION_COOKIE, _sessao(ADMIN))
    assert cli.get("/api/v1/bling/diagnostico/denavita?de=2026-11-25&ate=2026-11-01").status_code == 422
    assert cli.get("/api/v1/bling/diagnostico/denavita?de=2026-01-01&ate=2026-11-01").status_code == 422
    assert cli.get("/api/v1/bling/diagnostico/denavita").status_code == 422
    monkeypatch.setattr(rota, "cliente_denavita", lambda db: (None, "Bling da Denavita: conta ainda sem autorização (sem token gravado)."))
    r = cli.get(URL)
    assert r.status_code == 503 and "sem autorização" in r.json()["detail"]
