"""Denavita pelo Bling DELA (conta 'denavita'): OAuth com state assinado, credenciais por conta e
marcas menores com e sem token. Tudo com dubles: nenhuma chamada de rede e nenhum token real."""
from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import get_db
from app.gate_sessao import decidir
from app.main import app
from app.routers import marcas_menores as rota_mm
from app.services import bling_token
from app.services import marcas_menores_service as svc
from app.sessao import SESSION_AUDIENCE, SESSION_COOKIE, SESSION_ISSUER
from tests.test_marcas_menores import YENZAH_SHOPEE, FakeBling, pedido

SEGREDO = "s" * 32
ADMIN = "admin@gocase.com"
AGORA = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)
HOJE = date(2026, 11, 16)
OUT_INI, OUT_FIM = date(2026, 10, 1), date(2026, 10, 31)
DEN_ML, DEN_SHOPEE, DEN_TIKTOK = 9001, 9002, 9003
CANCELADO_DEN = 77  # cada conta Bling tem os seus ids de situacao


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setattr(settings, "auth_secret", SecretStr(SEGREDO))
    monkeypatch.setattr(settings, "bling_client_id", "id-rituaria")
    monkeypatch.setattr(settings, "bling_client_secret", SecretStr("segredo-rituaria"))
    monkeypatch.setattr(settings, "bling_refresh_token_inicial", SecretStr("semente-rituaria"))
    monkeypatch.setattr(settings, "bling_denavita_client_id", "id-denavita")
    monkeypatch.setattr(settings, "bling_denavita_client_secret", SecretStr("segredo-denavita"))
    monkeypatch.setattr(settings, "bling_denavita_lojas", "")
    monkeypatch.setattr(settings, "bling_situacao_cancelado_id", 0)
    svc.limpar_cache()
    yield
    svc.limpar_cache()


# --- state assinado ------------------------------------------------------------------------

def test_state_assinado_volta_a_conta():
    s = bling_token.assinar_state("denavita", SEGREDO, AGORA)
    assert bling_token.ler_state(s, SEGREDO, AGORA + timedelta(minutes=14)) == "denavita"


def test_state_expirado_assinatura_errada_ou_malformado_e_invalido():
    s = bling_token.assinar_state("denavita", SEGREDO, AGORA)
    assert bling_token.ler_state(s, SEGREDO, AGORA + timedelta(minutes=16)) is None
    assert bling_token.ler_state(s, "o" * 32, AGORA) is None
    corpo, assinatura = s.split(".")
    adulterado = bling_token._b64(json.dumps({"conta": "denavita", "exp": 9999999999}).encode())
    assert bling_token.ler_state(f"{adulterado}.{assinatura}", SEGREDO, AGORA) is None
    for lixo in ("", "abc", "a.b.c", "....", f"{corpo}."):
        assert bling_token.ler_state(lixo, SEGREDO, AGORA) is None


def test_state_de_conta_nao_autorizavel_e_invalido_mesmo_assinado():
    """O token da Rituaria nunca muda pelo callback, nem com state assinado de verdade."""
    assert bling_token.ler_state(bling_token.assinar_state("rituaria", SEGREDO, AGORA), SEGREDO, AGORA) is None
    assert bling_token.ler_state(bling_token.assinar_state("outra", SEGREDO, AGORA), SEGREDO, AGORA) is None


# --- credenciais por conta e troca do code -------------------------------------------------

class Resp:
    def __init__(self, corpo, status=200):
        self.corpo, self.status_code = corpo, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code} corpo-da-fonte")

    def json(self):
        return self.corpo


def post_que_guarda(chamadas, corpo=None, status=200):
    def post(url, **kw):
        chamadas.append((url, kw))
        return Resp(corpo or {"access_token": "acesso-den", "refresh_token": "refresh-den", "expires_in": 3600}, status)
    return post


def test_troca_do_code_usa_o_app_da_denavita():
    chamadas = []
    linha = bling_token.trocar_code("code-1", "denavita", post=post_que_guarda(chamadas), agora=lambda: AGORA)
    url, kw = chamadas[0]
    assert url == settings.bling_token_url
    assert kw["auth"] == ("id-denavita", "segredo-denavita")
    assert kw["data"] == {"grant_type": "authorization_code", "code": "code-1"}
    assert linha == {"refresh_token": "refresh-den", "access_token": "acesso-den", "access_expires_at": AGORA + timedelta(seconds=3600)}


def test_troca_do_code_recusada_sai_sanitizada():
    with pytest.raises(bling_token.BlingIndisponivel) as e:
        bling_token.trocar_code("code-1", "denavita", post=post_que_guarda([], {"error": "x"}, 400), agora=lambda: AGORA)
    assert "corpo-da-fonte" not in str(e.value) and "code-1" not in str(e.value)


class ArmazemMem:
    def __init__(self, linhas=None):
        self.linhas = dict(linhas or {})
        self.sementes = []

    def ler(self, conta):
        return self.linhas.get(conta)

    def trocar(self, conta, semente, fn):
        self.sementes.append((conta, semente))
        if semente and conta not in self.linhas:
            self.linhas[conta] = {"refresh_token": semente, "access_token": None, "access_expires_at": None}
        novo = fn(self.linhas.get(conta))
        self.linhas[conta] = novo
        return novo


def test_refresh_da_denavita_usa_o_app_dela_e_nunca_a_semente_da_rituaria():
    arm = ArmazemMem({"denavita": {"refresh_token": "refresh-den", "access_token": None, "access_expires_at": None}})
    chamadas = []
    assert bling_token.obter_access_token(arm, "denavita", post=post_que_guarda(chamadas), agora=lambda: AGORA) == "acesso-den"
    assert chamadas[0][1]["auth"] == ("id-denavita", "segredo-denavita")
    assert arm.sementes == [("denavita", "")]
    assert "rituaria" not in arm.linhas  # o token da Rituaria nao foi tocado


def test_denavita_sem_token_aguarda_autorizacao_sem_chamar_o_bling():
    arm, chamadas = ArmazemMem(), []
    with pytest.raises(bling_token.BlingIndisponivel, match="aguardando autorização"):
        bling_token.obter_access_token(arm, "denavita", post=post_que_guarda(chamadas), agora=lambda: AGORA)
    assert chamadas == [] and arm.linhas == {}


def test_rituaria_segue_com_o_app_dela():
    arm, chamadas = ArmazemMem(), []
    bling_token.obter_access_token(arm, post=post_que_guarda(chamadas), agora=lambda: AGORA)
    assert chamadas[0][1]["auth"] == ("id-rituaria", "segredo-rituaria")
    assert arm.sementes == [("rituaria", "semente-rituaria")]


# --- rotas: callback (publico, state assinado) e link (admin) -------------------------------

DDL = """CREATE TABLE audit.bling_oauth_token (conta TEXT PRIMARY KEY, refresh_token TEXT NOT NULL,
access_token TEXT NULL, access_expires_at TIMESTAMP NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"""


@pytest.fixture
def db():
    eng = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(eng, "connect")
    def _anexa(conn, _):
        conn.execute("ATTACH DATABASE ':memory:' AS audit")
        conn.create_function("now", 0, lambda: "2026-11-25 12:00:00")

    with eng.begin() as c:
        c.execute(text(DDL))
        c.execute(text("INSERT INTO audit.bling_oauth_token (conta, refresh_token, access_token) VALUES ('rituaria', 'r-rit', 'a-rit')"))
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


@pytest.fixture
def cli(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(settings, "torre_admin_emails", ADMIN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _tokens(db):
    return {r[0]: r[1:] for r in db.execute(text("SELECT conta, refresh_token, access_token FROM audit.bling_oauth_token")).all()}


def test_callback_grava_a_denavita_sem_token_na_resposta_nem_no_log(cli, db, monkeypatch, caplog):
    chamadas = []
    monkeypatch.setattr(bling_token, "trocar_code", lambda code, conta: (chamadas.append((code, conta)), {
        "refresh_token": "refresh-den", "access_token": "acesso-den", "access_expires_at": AGORA})[1])
    state = bling_token.assinar_state("denavita", SEGREDO, datetime.now(timezone.utc))
    with caplog.at_level("INFO"):
        r = cli.get("/api/v1/bling/oauth/callback", params={"code": "code-1", "state": state})
    assert r.status_code == 200 and "Denavita autorizada" in r.text
    assert chamadas == [("code-1", "denavita")]
    assert _tokens(db) == {"rituaria": ("r-rit", "a-rit"), "denavita": ("refresh-den", "acesso-den")}
    do_app = " | ".join(rec.getMessage() for rec in caplog.records if rec.name.startswith("app"))
    for segredo in ("refresh-den", "acesso-den", "code-1"):
        assert segredo not in r.text and segredo not in do_app


def test_log_de_acesso_do_uvicorn_nao_grava_o_code():
    import logging
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("1.2.3.4", "GET", "/api/v1/bling/oauth/callback?code=c-9&state=s", "1.1", 200), None)
    for f in logging.getLogger("uvicorn.access").filters:
        f.filter(rec)
    assert "c-9" not in rec.getMessage() and "/api/v1/bling/oauth/callback" in rec.getMessage()


def test_callback_com_state_invalido_expirado_ou_da_rituaria_nao_troca_nada(cli, db, monkeypatch):
    monkeypatch.setattr(bling_token, "trocar_code", lambda *a: pytest.fail("nao deveria trocar o code"))
    agora = datetime.now(timezone.utc)
    for state in ("forjado.xyz", bling_token.assinar_state("denavita", SEGREDO, agora - timedelta(minutes=20)),
                  bling_token.assinar_state("rituaria", SEGREDO, agora), bling_token.assinar_state("denavita", "o" * 32, agora)):
        r = cli.get("/api/v1/bling/oauth/callback", params={"code": "code-1", "state": state})
        assert r.status_code == 400 and "inválido ou expirado" in r.text
    assert cli.get("/api/v1/bling/oauth/callback", params={"state": bling_token.assinar_state("denavita", SEGREDO, agora)}).status_code == 400
    assert _tokens(db) == {"rituaria": ("r-rit", "a-rit")}


def test_callback_com_bling_recusando_o_code_responde_erro_curto(cli, db, monkeypatch):
    def recusa(code, conta):
        raise bling_token.BlingIndisponivel("Não foi possível renovar o acesso ao Bling.")
    monkeypatch.setattr(bling_token, "trocar_code", recusa)
    r = cli.get("/api/v1/bling/oauth/callback", params={"code": "c", "state": bling_token.assinar_state("denavita", SEGREDO, datetime.now(timezone.utc))})
    assert r.status_code == 502 and "Não deu para autorizar" in r.text
    assert "denavita" not in _tokens(db)


def test_callback_e_publico_no_gate_e_o_link_nao():
    base = dict(metodo="GET", cookie_sessao=None, chave_servico=None, modo="enforce", segredo=SEGREDO,
                dominios=("gocase.com",), chave_servico_esperada="")
    assert decidir(caminho="/api/v1/bling/oauth/callback", **base).liberar
    assert not decidir(caminho="/api/v1/bling/oauth/link", **base).liberar


def _sessao(email):
    agora = int(time.time())
    return jwt.encode({"email": email, "name": "X", "iss": SESSION_ISSUER, "aud": SESSION_AUDIENCE,
                       "iat": agora, "exp": agora + 300}, SEGREDO, algorithm="HS256")


def test_link_so_para_admin_com_state_assinado(cli):
    assert cli.get("/api/v1/bling/oauth/link?conta=denavita").status_code == 401
    cli.cookies.set(SESSION_COOKIE, _sessao("outro@gocase.com"))
    assert cli.get("/api/v1/bling/oauth/link?conta=denavita").status_code == 403
    cli.cookies.set(SESSION_COOKIE, _sessao(ADMIN))
    assert cli.get("/api/v1/bling/oauth/link?conta=rituaria").status_code == 400
    r = cli.get("/api/v1/bling/oauth/link?conta=denavita")
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=id-denavita&state=")
    from urllib.parse import parse_qs, urlparse
    state = parse_qs(urlparse(url).query)["state"][0]
    assert bling_token.ler_state(state, SEGREDO, datetime.now(timezone.utc)) == "denavita"


# --- marcas menores com e sem o Bling da Denavita ------------------------------------------

class FakeBlingDenavita(FakeBling):
    """Conta da Denavita: canais proprios e o seu id de 'Cancelado'."""

    def get(self, caminho, params=None):
        if caminho == "/canais-venda":
            self.chamadas.append((caminho, params))
            return {"data": [{"id": DEN_ML, "descricao": "Mercado Livre Denavita", "tipo": "MercadoLivre"},
                             {"id": DEN_SHOPEE, "descricao": "Shopee", "tipo": "Shopee"},
                             {"id": DEN_TIKTOK, "descricao": "TikTok Shop", "tipo": "TikTokShop"}]}
        if caminho == "/situacoes/modulos/98310":
            self.chamadas.append((caminho, params))
            return {"data": [{"id": 9, "nome": "Atendido"}, {"id": CANCELADO_DEN, "nome": "Cancelado"}]}
        return super().get(caminho, params)


DEN = {
    DEN_ML: [pedido(11, "2026-10-03", 200.0), pedido(12, "2026-10-04", 999.0, CANCELADO_DEN), pedido(13, "2026-09-20", 50.0)],
    DEN_SHOPEE: [pedido(14, "2026-10-05", 30.0)],
    DEN_TIKTOK: [pedido(15, "2026-10-05", 5000.0)],  # TikTok vem do Data Mart: o do Bling nunca entra
}
RIT = {YENZAH_SHOPEE: [pedido(1, "2026-10-03", 100.0)]}


def dm(sql, params):
    linhas = [{"dia": date(2026, 10, 2), "gmv": Decimal("70.00"), "pedidos": 2}]
    return [l for l in linhas if params["inicio"] <= l["dia"] <= params["fim"]]


def dm_fora(sql, params):
    raise RuntimeError("senha=x host=y")


def _den(r):
    return {m["id"]: m for m in r["marcas"]}["denavita"]


def test_com_token_ml_e_shopee_pelo_bling_dela_e_tiktok_pelo_data_mart():
    fake_den = FakeBlingDenavita(DEN)
    r = svc.get_marcas_menores(FakeBling(RIT), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm, cli_denavita=fake_den)
    d = _den(r)
    assert d["status"] == "ok" and "Bling da Denavita" in d["aviso"] and d["motivo"] is None
    assert {p["plataforma"]: p["faturamento"] for p in d["por_plataforma"]} == {"MELI": 200.0, "SHOPEE": 30.0, "TIKTOK": 70.0}
    assert d["total"] == 300.0  # o cancelado (id da conta dela) e o TikTok do Bling ficam fora
    assert d["pedidos_por_plataforma"] == {"MELI": 1, "SHOPEE": 1, "TIKTOK": 2}
    assert d["por_plataforma_anterior"] == {"MELI": 50.0}
    assert r["consolidado"]["parcial"] is False and r["consolidado"]["aviso"] is None
    assert {p["idLoja"] for c, p in fake_den.chamadas if c == "/pedidos/vendas"} == {DEN_ML, DEN_SHOPEE}
    assert _den(r)["total"] + 100.0 == r["consolidado"]["total"]


def test_lojas_pela_setting_dispensam_canais_venda(monkeypatch):
    monkeypatch.setattr(settings, "bling_denavita_lojas", f"{DEN_SHOPEE}:SHOPEE, lixo, {DEN_ML}:meli")
    fake_den = FakeBlingDenavita(DEN)
    d = _den(svc.get_marcas_menores(FakeBling(RIT), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm, cli_denavita=fake_den))
    assert d["total"] == 300.0
    assert all(c != "/canais-venda" for c, _ in fake_den.chamadas)


def test_com_token_e_data_mart_fora_parcial_sem_o_tiktok():
    r = svc.get_marcas_menores(FakeBling(RIT), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm_fora, cli_denavita=FakeBlingDenavita(DEN))
    d = _den(r)
    assert d["status"] == "ok" and d["total"] == 230.0 and "TikTok dela está fora" in d["aviso"]
    assert r["consolidado"]["parcial"] is True and "sem o TikTok da Denavita" in r["consolidado"]["aviso"]


def test_sem_token_segue_como_hoje_com_aviso_nunca_zero():
    r = svc.get_marcas_menores(FakeBling(RIT), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm, cli_denavita=None)
    d = _den(r)
    assert d["status"] == svc.STATUS_FONTE_PROVISORIA and d["aviso"] == svc.AVISO_DENAVITA
    assert {p["plataforma"] for p in d["por_plataforma"]} == {"TIKTOK"}
    assert r["consolidado"]["parcial"] is True
    sem_nada = _den(svc.get_marcas_menores(FakeBling(RIT), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm_fora))
    assert sem_nada["total"] is None and sem_nada["status"] == svc.STATUS_FONTE_INDISPONIVEL


def test_bling_da_denavita_fora_volta_ao_caminho_provisorio_e_as_outras_intactas():
    class Quebrado:
        def get(self, caminho, params=None):
            raise bling_token.BlingIndisponivel("Bling aguardando autorização.")
    r = svc.get_marcas_menores(FakeBling(RIT), OUT_INI, OUT_FIM, HOJE, consultar_dm=dm, cli_denavita=Quebrado())
    assert _den(r)["status"] == svc.STATUS_FONTE_PROVISORIA and _den(r)["total"] == 70.0
    assert {m["id"]: m for m in r["marcas"]}["yenzah"]["total"] == 100.0


def test_rota_so_cria_o_cliente_da_denavita_com_token_gravado(db, monkeypatch):
    assert rota_mm.cliente_bling_denavita(None) is None
    assert rota_mm.cliente_bling_denavita(db) is None  # sem linha da Denavita
    db.execute(text("INSERT INTO audit.bling_oauth_token (conta, refresh_token) VALUES ('denavita', 'r')"))
    db.commit()
    assert rota_mm.cliente_bling_denavita(db) is not None
    monkeypatch.setattr(settings, "bling_denavita_client_id", "")
    assert rota_mm.cliente_bling_denavita(db) is None  # app da Denavita sem credencial no Render
