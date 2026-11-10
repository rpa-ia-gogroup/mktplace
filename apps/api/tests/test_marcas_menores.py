"""Marcas menores pelo Bling v3: tudo com mock, nenhuma chamada de rede e nenhum token real."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import settings
from app.main import app
from app.services import bling_client, bling_token
from app.services import marcas_menores_service as svc
from app.services.bling_client import BlingCliente
from app.services.bling_token import BlingIndisponivel

HOJE = date(2026, 11, 10)
CANCELADO = 15
YENZAH_SHOPEE, YENZAH_TIKTOK, AUA_SHOPEE = 206340048, 206282652, 206338388


def pedido(id_, dia, total, sit=9):
    return {"id": id_, "data": dia, "total": total, "situacao": {"id": sit}}


class FakeBling:
    """Responde por caminho; guarda as chamadas. `pedidos` = {(idLoja): [pedidos]} filtrados por data."""

    def __init__(self, pedidos=None, itens=None):
        self.pedidos = pedidos or {}
        self.itens = itens or {}
        self.chamadas: list[tuple] = []

    def get(self, caminho, params=None):
        self.chamadas.append((caminho, params))
        if caminho == "/situacoes/modulos":
            return {"data": [{"id": 1, "nome": "Compras"}, {"id": 98310, "nome": "Vendas"}]}
        if caminho == "/situacoes/modulos/98310":
            return {"data": [{"id": 9, "nome": "Atendido"}, {"id": CANCELADO, "nome": "Cancelado"}]}
        if caminho == "/pedidos/vendas":
            ini, fim = params["dataInicial"], params["dataFinal"]
            todos = [p for p in self.pedidos.get(params["idLoja"], []) if ini <= p["data"] <= fim]
            pg = params["pagina"]
            return {"data": todos[(pg - 1) * params["limite"] : pg * params["limite"]]}
        if caminho.startswith("/pedidos/vendas/"):
            return {"data": {"itens": self.itens[int(caminho.rsplit("/", 1)[1])]}}
        raise AssertionError(caminho)


@pytest.fixture(autouse=True)
def _limpo():
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def _marcas(r):
    return {m["id"]: m for m in r["marcas"]}


DADOS = {
    YENZAH_SHOPEE: [pedido(1, "2026-11-08", 100.0), pedido(2, "2026-11-09", 50.5), pedido(3, "2026-11-09", 999.0, CANCELADO)],
    YENZAH_TIKTOK: [pedido(4, "2026-11-09", 10.0)],
    AUA_SHOPEE: [pedido(5, "2026-11-09", 7.0)],
}


def test_marca_sai_do_canal_total_quebra_serie_e_cancelado_fora():
    r = svc.get_marcas_menores(FakeBling(DADOS), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    m = _marcas(r)
    assert [x["id"] for x in r["marcas"]] == ["denavita", "yenzah", "aua", "by-samia"]
    assert m["yenzah"]["total"] == 160.5  # 100 + 50,5 + 10; o cancelado de 999 fica fora
    assert [(p["plataforma"], p["faturamento"]) for p in m["yenzah"]["por_plataforma"]] == [("SHOPEE", 150.5), ("TIKTOK", 10.0)]
    assert [(d["data"], d["faturamento"]) for d in m["yenzah"]["serie"]] == [(date(2026, 11, 8), 100.0), (date(2026, 11, 9), 60.5)]
    assert m["aua"]["total"] == 7.0
    assert r["consolidado"]["total"] == 167.5


def test_ausencia_nao_vira_zero_e_denavita_aguarda_autorizacao():
    r = svc.get_marcas_menores(FakeBling(DADOS), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    m = _marcas(r)
    assert m["by-samia"]["total"] is None and m["by-samia"]["serie"] == [] and m["by-samia"]["status"] == "ok"
    assert m["denavita"]["total"] is None and m["denavita"]["status"] == "aguardando_autorizacao"


def test_hoje_conta_e_nao_e_recortado():
    fake = FakeBling({YENZAH_SHOPEE: [pedido(1, "2026-11-10", 30.0)]})
    r = svc.get_marcas_menores(fake, HOJE, HOJE, HOJE)
    assert r["periodo"] == {"inicio": HOJE, "fim": HOJE}
    assert _marcas(r)["yenzah"]["total"] == 30.0


def test_periodo_anterior_e_sem_base_nao_e_zero():
    dados = {**DADOS, YENZAH_SHOPEE: DADOS[YENZAH_SHOPEE] + [pedido(9, "2026-10-25", 80.0)]}
    r = svc.get_marcas_menores(FakeBling(dados), date(2026, 11, 1), date(2026, 11, 9), HOJE)  # anterior: 10/23..10/31
    assert r["consolidado"]["total_anterior"] == 80.0
    m = _marcas(r)
    assert m["yenzah"]["total_anterior"] == 80.0 and m["aua"]["total_anterior"] is None
    svc.limpar_cache()
    sem = svc.get_marcas_menores(FakeBling(DADOS), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert sem["consolidado"]["total_anterior"] is None


def test_paginacao_ate_a_ultima_pagina():
    muitos = [pedido(i, "2026-11-09", 1.0) for i in range(1, 251)]  # 3 paginas de 100
    fake = FakeBling({YENZAH_SHOPEE: muitos})
    r = svc.get_marcas_menores(fake, date(2026, 11, 9), date(2026, 11, 9), HOJE)
    assert _marcas(r)["yenzah"]["total"] == 250.0
    paginas = [p["pagina"] for c, p in fake.chamadas if c == "/pedidos/vendas" and p["idLoja"] == YENZAH_SHOPEE and p["dataInicial"] == "2026-11-09"]
    assert paginas == [1, 2, 3]


def test_cache_da_lista_por_15_min():
    fake = FakeBling(DADOS)
    t = [0.0]
    args = (fake, date(2026, 11, 1), date(2026, 11, 9), HOJE)
    svc.get_marcas_menores(*args, agora=lambda: t[0])
    n = len(fake.chamadas)
    t[0] = 899
    svc.get_marcas_menores(*args, agora=lambda: t[0])
    assert len(fake.chamadas) == n
    t[0] = 901
    svc.get_marcas_menores(*args, agora=lambda: t[0])
    assert len(fake.chamadas) > n


def test_cancelado_id_vem_da_api_ou_do_setting(monkeypatch):
    fake = FakeBling(DADOS)
    svc.get_marcas_menores(fake, date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert sum(1 for c, _ in fake.chamadas if c == "/situacoes/modulos") == 1  # descoberto 1 vez
    svc.limpar_cache()
    monkeypatch.setattr(settings, "bling_situacao_cancelado_id", 77)
    fake2 = FakeBling({YENZAH_SHOPEE: [pedido(1, "2026-11-09", 5.0, 77), pedido(2, "2026-11-09", 3.0)]})
    r = svc.get_marcas_menores(fake2, date(2026, 11, 9), date(2026, 11, 9), HOJE)
    assert _marcas(r)["yenzah"]["total"] == 3.0
    assert all(c != "/situacoes/modulos" for c, _ in fake2.chamadas)


def test_sem_situacao_cancelado_fica_indisponivel_em_vez_de_chutar():
    class SemCancelado(FakeBling):
        def get(self, caminho, params=None):
            if caminho == "/situacoes/modulos/98310":
                return {"data": [{"id": 9, "nome": "Atendido"}]}
            return super().get(caminho, params)

    r = svc.get_marcas_menores(SemCancelado(DADOS), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert r["disponivel"] is False and "Cancelado" in r["motivo"] and r["marcas"] == []


def test_erro_do_bling_e_indisponivel_sem_vazar_texto():
    class Quebra(FakeBling):
        def get(self, caminho, params=None):
            raise BlingIndisponivel("Bling indisponível agora.")

    r = svc.get_marcas_menores(Quebra(), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert r["disponivel"] is False and r["motivo"]


# ---- produtos -----------------------------------------------------------

ITENS = {
    1: [{"codigo": "A", "descricao": "Sérum", "quantidade": 2, "valor": 50.0, "desconto": 10.0}],
    2: [{"codigo": "A", "descricao": "Sérum", "quantidade": 1, "valor": 50.0, "desconto": 0}, {"codigo": "B", "descricao": "Óleo", "quantidade": 3, "valor": 10.0, "desconto": 0}],
    4: [{"codigo": "B", "descricao": "Óleo", "quantidade": 1, "valor": 12.0}],
    5: [{"codigo": "C", "descricao": "Kit", "quantidade": None, "valor": 7.0}],
}


def test_receita_do_item_valor_x_quantidade_menos_desconto():
    assert svc.receita_do_item({"valor": 50.0, "quantidade": 2, "desconto": 10.0}) == 90.0
    assert svc.receita_do_item({"valor": 12.0, "quantidade": 1}) == 12.0
    assert svc.receita_do_item({"quantidade": 1}) is None


def test_produtos_por_marca_com_quantidade_e_receita_dos_itens():
    r = svc.get_produtos(FakeBling(DADOS, ITENS), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert r["completo"] is True and r["pedidos_total"] == 4  # cancelado fora
    m = {x["id"]: x for x in r["marcas"]}
    yen = {p["sku"]: p for p in m["yenzah"]["produtos"]}
    assert yen["A"]["quantidade"] == 3.0 and yen["A"]["receita"] == 140.0  # (2*50-10) + 50
    assert yen["B"]["quantidade"] == 4.0 and yen["B"]["receita"] == 42.0
    assert [p["sku"] for p in m["yenzah"]["produtos"]] == ["A", "B"]  # por receita
    assert m["denavita"]["status"] == "aguardando_autorizacao" and m["denavita"]["produtos"] == []
    aua = m["aua"]["produtos"][0]
    assert aua["quantidade"] is None and aua["receita"] is None  # item sem quantidade: sem dado, nunca 0


def test_produtos_le_poucos_detalhes_por_vez_e_aquece_o_cache():
    fake = FakeBling(DADOS, ITENS)
    r1 = svc.get_produtos(fake, date(2026, 11, 1), date(2026, 11, 9), HOJE, limite_detalhes=2)
    assert r1["completo"] is False and r1["pedidos_lidos"] == 2 and r1["pedidos_total"] == 4
    r2 = svc.get_produtos(fake, date(2026, 11, 1), date(2026, 11, 9), HOJE, limite_detalhes=2)
    assert r2["completo"] is True and r2["pedidos_lidos"] == 4
    detalhes = [c for c, _ in fake.chamadas if c.startswith("/pedidos/vendas/")]
    assert len(detalhes) == len(set(detalhes)) == 4  # cada pedido uma vez so'


# ---- cliente HTTP -------------------------------------------------------

class R:
    def __init__(self, status=200, corpo=None, headers=None):
        self.status_code, self._c, self.headers = status, corpo or {"data": []}, headers or {}

    def json(self):
        return self._c


def cliente(respostas, invalidar=lambda: None):
    fila, chamadas, dormidas = list(respostas), [], []

    def get(url, params=None, headers=None, timeout=None):
        chamadas.append((url, headers["Authorization"]))
        return fila.pop(0)

    return BlingCliente(lambda: "tok", invalidar, get, dormidas.append, lambda: 1000.0 + len(chamadas) * 10), chamadas, dormidas


def test_retry_no_429_respeita_retry_after():
    c, chamadas, dormidas = cliente([R(429, headers={"Retry-After": "2"}), R(200, {"data": [1]})])
    assert c.get("/x") == {"data": [1]}
    assert len(chamadas) == 2 and 2.0 in dormidas


def test_429_sem_fim_vira_indisponivel():
    c, _, _ = cliente([R(429)] * 4)
    with pytest.raises(BlingIndisponivel):
        c.get("/x")


def test_401_renova_uma_vez():
    n = []
    c, chamadas, _ = cliente([R(401), R(200)], invalidar=lambda: n.append(1))
    c.get("/x")
    assert n == [1] and len(chamadas) == 2
    c2, _, _ = cliente([R(401), R(401)])
    with pytest.raises(BlingIndisponivel):
        c2.get("/x")


def test_espaca_as_chamadas(monkeypatch):
    monkeypatch.setattr(bling_client, "_ultimo", [0.0])
    dormidas = []
    relogio = lambda: 5.0  # parado: tudo "acabou de acontecer"
    c = BlingCliente(lambda: "t", get=lambda *a, **k: R(), dormir=dormidas.append, relogio=relogio)
    c.get("/a")
    c.get("/b")
    assert dormidas and all(abs(d - bling_client.INTERVALO_S) < 1e-9 for d in dormidas)


# ---- token --------------------------------------------------------------

class Armazem:
    def __init__(self, linha=None):
        self.linha, self.trocas = linha, 0

    def ler(self, conta):
        return None if self.linha is None else dict(self.linha)

    def trocar(self, conta, semente, fn):
        if self.linha is None and semente:
            self.linha = {"refresh_token": semente, "access_token": None, "access_expires_at": None}
        novo = fn(None if self.linha is None else dict(self.linha))
        self.linha = novo
        self.trocas += 1
        return novo


AGORA = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def configurado(monkeypatch):
    monkeypatch.setattr(settings, "bling_client_id", "id-teste")
    monkeypatch.setattr(settings, "bling_client_secret", SecretStr("segredo-teste"))
    monkeypatch.setattr(settings, "bling_refresh_token_inicial", SecretStr("semente-teste"))


def post_ok(chamadas):
    def post(url, auth, data, headers, timeout):
        chamadas.append((url, auth, data))

        class Resp:
            def raise_for_status(self): ...
            def json(self): return {"access_token": "acesso-novo", "refresh_token": f"refresh-{len(chamadas)}", "expires_in": 21600}

        return Resp()

    return post


def test_token_valido_nao_troca(configurado):
    arm = Armazem({"refresh_token": "r", "access_token": "vivo", "access_expires_at": AGORA + timedelta(hours=1)})
    assert bling_token.obter_access_token(arm, post=post_ok([]), agora=lambda: AGORA) == "vivo"
    assert arm.trocas == 0


def test_token_vencido_troca_e_grava_o_refresh_novo(configurado):
    chamadas = []
    arm = Armazem({"refresh_token": "velho", "access_token": "x", "access_expires_at": AGORA - timedelta(minutes=1)})
    assert bling_token.obter_access_token(arm, post=post_ok(chamadas), agora=lambda: AGORA) == "acesso-novo"
    assert chamadas[0][2] == {"grant_type": "refresh_token", "refresh_token": "velho"}
    assert chamadas[0][1] == ("id-teste", "segredo-teste")
    assert arm.linha["refresh_token"] == "refresh-1" and arm.linha["access_expires_at"] == AGORA + timedelta(hours=6)


def test_tabela_vazia_usa_a_semente(configurado):
    chamadas = []
    arm = Armazem(None)
    bling_token.obter_access_token(arm, post=post_ok(chamadas), agora=lambda: AGORA)
    assert chamadas[0][2]["refresh_token"] == "semente-teste"
    assert arm.linha["refresh_token"] == "refresh-1"  # a semente nao e' reaproveitada


def test_quem_espera_o_lock_acha_o_token_ja_renovado(configurado):
    chamadas = []

    class Concorrente(Armazem):
        def trocar(self, conta, semente, fn):  # outro worker renovou antes de a linha ser travada
            self.linha = {"refresh_token": "r2", "access_token": "do-outro", "access_expires_at": AGORA + timedelta(hours=5)}
            return super().trocar(conta, semente, fn)

    arm = Concorrente({"refresh_token": "r", "access_token": None, "access_expires_at": None})
    assert bling_token.obter_access_token(arm, post=post_ok(chamadas), agora=lambda: AGORA) == "do-outro"
    assert chamadas == []  # nenhuma segunda troca (refresh rotativo)


def test_sem_credenciais_ou_sem_token_nao_chama_a_rede(monkeypatch):
    monkeypatch.setattr(settings, "bling_client_id", "")
    with pytest.raises(BlingIndisponivel, match="configurado"):
        bling_token.obter_access_token(Armazem(None), post=post_ok([]), agora=lambda: AGORA)
    monkeypatch.setattr(settings, "bling_client_id", "id")
    monkeypatch.setattr(settings, "bling_client_secret", SecretStr("s"))
    monkeypatch.setattr(settings, "bling_refresh_token_inicial", SecretStr(""))
    with pytest.raises(BlingIndisponivel, match="autorização"):
        bling_token.obter_access_token(Armazem({"refresh_token": "", "access_token": None, "access_expires_at": None}), post=post_ok([]), agora=lambda: AGORA)


def test_erro_na_troca_nao_vaza_token(configurado):
    def post(*a, **k):
        raise RuntimeError("refresh-secreto-no-texto")

    with pytest.raises(BlingIndisponivel) as e:
        bling_token.obter_access_token(Armazem({"refresh_token": "refresh-secreto", "access_token": None, "access_expires_at": None}), post=post, agora=lambda: AGORA)
    assert "secreto" not in str(e.value)


def test_invalidar_zera_so_o_acesso(configurado):
    arm = Armazem({"refresh_token": "r", "access_token": "a", "access_expires_at": AGORA + timedelta(hours=1)})
    bling_token.invalidar(arm)
    assert arm.linha["access_token"] is None and arm.linha["refresh_token"] == "r"


# ---- rotas --------------------------------------------------------------

def test_rotas(monkeypatch):
    from app.database import get_db
    from app.routers import marcas_menores as rota

    fake = FakeBling(DADOS, ITENS)
    monkeypatch.setattr(rota, "cliente_bling", lambda db: fake)
    app.dependency_overrides[get_db] = lambda: None
    try:
        c = TestClient(app)
        r = c.get("/api/v1/performance/marcas-menores?date_from=2026-11-01&date_to=2026-11-09")
        assert r.status_code == 200, r.text
        assert r.json()["disponivel"] is True and len(r.json()["marcas"]) == 4
        p = c.get("/api/v1/performance/marcas-menores/produtos?date_from=2026-11-01&date_to=2026-11-09")
        assert p.status_code == 200 and p.json()["marcas"][1]["produtos"][0]["sku"] == "A"
    finally:
        app.dependency_overrides.pop(get_db, None)
