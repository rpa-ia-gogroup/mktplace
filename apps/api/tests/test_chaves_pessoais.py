# tests/test_chaves_pessoais.py — chaves pessoais (torre_pat_): servico, rotas e gate. SQLite em memoria, sem rede.
import logging
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import get_db
from app.gate_sessao import GateDeSessao
from app.main import app as app_main
from app.services import chaves_pessoais as svc
from app.sessao import SESSION_AUDIENCE, SESSION_COOKIE, SESSION_ISSUER

SEGREDO = "s" * 32
CHAVE_SERVICO = "k" * 32
ADMIN = "admin@gocase.com"
AGORA = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)

DDL = """
CREATE TABLE audit.torre_chave_pessoal (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, dono_email TEXT NOT NULL,
    hash_chave TEXT NOT NULL UNIQUE, criada_por TEXT NOT NULL, criada_em TIMESTAMP NOT NULL,
    expira_em TIMESTAMP NOT NULL, revogada_em TIMESTAMP NULL, ultimo_uso_em TIMESTAMP NULL)
"""


@pytest.fixture
def Sessao():
    eng = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(eng, "connect")
    def _anexa(conn, _):
        conn.execute("ATTACH DATABASE ':memory:' AS audit")

    with eng.begin() as c:
        c.execute(text(DDL))
    return sessionmaker(bind=eng)


@pytest.fixture
def db(Sessao):
    s = Sessao()
    yield s
    s.close()


def _todas(db):
    return [dict(r) for r in db.execute(text("SELECT * FROM audit.torre_chave_pessoal")).mappings()]


# ---------------------------------------------------------------- servico

def test_chave_tem_formato_e_banco_guarda_so_o_hash(db):
    chave, linha = svc.criar(db, nome="Simulador", dono_email="n@gocase.com", criada_por=ADMIN, dias=90, agora=AGORA)
    assert svc.formato_valido(chave) and chave.startswith("torre_pat_")
    assert "chave" not in linha and "hash_chave" not in linha
    [gravada] = _todas(db)
    assert gravada["hash_chave"] == svc.hash_chave(chave)
    assert chave not in str(gravada)


def test_valida_e_marca_ultimo_uso(db):
    chave, linha = svc.criar(db, nome="Sim", dono_email="n@gocase.com", criada_por=ADMIN, dias=90, agora=AGORA)
    dono = svc.validar(db, chave, AGORA + timedelta(days=1))
    assert (dono.nome, dono.dono_email) == ("Sim", "n@gocase.com")
    assert svc.listar(db)[0]["ultimo_uso_em"] is not None


def test_revogada_nao_vale(db):
    chave, linha = svc.criar(db, nome="Sim", dono_email="n@gocase.com", criada_por=ADMIN, dias=90, agora=AGORA)
    assert svc.revogar(db, linha["id"], AGORA) is True
    assert svc.revogar(db, linha["id"], AGORA) is False
    assert svc.validar(db, chave, AGORA) is None


def test_vencida_nao_vale(db):
    chave, _ = svc.criar(db, nome="Sim", dono_email="n@gocase.com", criada_por=ADMIN, dias=1, agora=AGORA)
    assert svc.validar(db, chave, AGORA + timedelta(hours=23)) is not None
    assert svc.validar(db, chave, AGORA + timedelta(days=1, seconds=1)) is None


def test_invalida_e_prefixo_errado_nao_valem(db):
    chave, _ = svc.criar(db, nome="Sim", dono_email="n@gocase.com", criada_por=ADMIN, dias=90, agora=AGORA)
    corpo = chave.removeprefix("torre_pat_")
    for ruim in (svc.gerar(), "torre_key_" + corpo, "Torre_pat_" + corpo, corpo, chave + "x", chave[:-1], "", None):
        assert svc.validar(db, ruim, AGORA) is None, ruim


# ---------------------------------------------------------------- rotas

def _sessao(email):
    agora = int(time.time())
    return jwt.encode({"email": email, "name": "X", "iss": SESSION_ISSUER, "aud": SESSION_AUDIENCE,
                       "iat": agora, "exp": agora + 300}, SEGREDO, algorithm="HS256")


@pytest.fixture
def cli(Sessao, monkeypatch):
    monkeypatch.setattr(settings, "auth_secret", SecretStr(SEGREDO))
    monkeypatch.setattr(settings, "torre_service_key", SecretStr(CHAVE_SERVICO))
    monkeypatch.setattr(settings, "torre_admin_emails", f" {ADMIN.upper()} ,outro@gocase.com")
    monkeypatch.setattr(settings, "torre_auth_mode", "off")

    def _db():
        s = Sessao()
        try:
            yield s
        finally:
            s.close()

    app_main.dependency_overrides[get_db] = _db
    yield TestClient(app_main)
    app_main.dependency_overrides.pop(get_db, None)


def _como(cli, email):
    cli.cookies.set(SESSION_COOKIE, _sessao(email))
    return cli


def test_nao_admin_barrado_nas_rotas_de_admin(cli):
    for c in (cli, _como(cli, "comum@gocase.com")):
        esperado = 401 if SESSION_COOKIE not in c.cookies else 403
        assert c.get("/api/v1/chaves").status_code == esperado
        assert c.post("/api/v1/chaves", json={"nome": "x", "dono_email": "a@gocase.com"}).status_code == esperado
        assert c.post("/api/v1/chaves/1/revogar").status_code == esperado


def test_chave_de_servico_nao_e_admin(cli):
    r = cli.get("/api/v1/chaves", headers={"x-torre-service-key": CHAVE_SERVICO})
    assert r.status_code == 401


def test_fluxo_admin_e_validar_sem_vazar_chave_nem_hash(cli, caplog):
    caplog.set_level(logging.INFO)
    adm = _como(cli, ADMIN)
    r = adm.post("/api/v1/chaves", json={"nome": "Simulador", "dono_email": "Nathalia@gocase.com"})
    assert r.status_code == 201
    criada = r.json()
    chave, h = criada["chave"], svc.hash_chave(criada["chave"])
    assert criada["dono_email"] == "nathalia@gocase.com" and criada["criada_por"] == ADMIN
    expira = datetime.fromisoformat(criada["expira_em"]) - datetime.fromisoformat(criada["criada_em"])
    assert expira == timedelta(days=90)

    lista = adm.get("/api/v1/chaves")
    assert lista.status_code == 200 and len(lista.json()["chaves"]) == 1
    assert chave not in lista.text and h not in lista.text and "hash" not in lista.text

    sem = cli.post("/api/v1/chaves/validar", json={"chave": chave})
    assert sem.status_code == 401
    v = cli.post("/api/v1/chaves/validar", json={"chave": chave}, headers={"x-torre-service-key": CHAVE_SERVICO})
    assert v.status_code == 200
    assert v.json()["nome"] == "Simulador" and v.json()["dono_email"] == "nathalia@gocase.com"
    assert isinstance(v.json()["expira_em"], int)
    assert chave not in v.text and h not in v.text

    assert adm.post(f"/api/v1/chaves/{criada['id']}/revogar").status_code == 200
    assert adm.post(f"/api/v1/chaves/{criada['id']}/revogar").status_code == 404
    v2 = cli.post("/api/v1/chaves/validar", json={"chave": chave}, headers={"x-torre-service-key": CHAVE_SERVICO})
    assert v2.status_code == 401

    assert "Simulador" in caplog.text
    assert chave not in caplog.text and h not in caplog.text


def test_dono_fora_do_dominio_e_prazo_fora_da_faixa(cli):
    adm = _como(cli, ADMIN)
    assert adm.post("/api/v1/chaves", json={"nome": "x", "dono_email": "a@gmail.com"}).status_code == 422
    assert adm.post("/api/v1/chaves", json={"nome": "x", "dono_email": "a@gocase.com", "dias": 0}).status_code == 422
    assert adm.post("/api/v1/chaves", json={"nome": "x", "dono_email": "a@gocase.com", "dias": 366}).status_code == 422


# ---------------------------------------------------------------- gate (Bearer na API REST)

CHAVE_BOA = "torre_pat_" + "A" * 43


def _validador(chave):
    return SimpleNamespace(id=7, nome="Sim", dono_email="n@gocase.com") if chave == CHAVE_BOA else None


@pytest.fixture
def gate(monkeypatch):
    monkeypatch.setattr(settings, "torre_auth_mode", "enforce")
    monkeypatch.setattr(settings, "auth_secret", SecretStr(SEGREDO))
    monkeypatch.setattr(settings, "torre_service_key", SecretStr(CHAVE_SERVICO))
    app = FastAPI()

    @app.get("/api/v1/x")
    def x(request: Request):
        return {"ator": getattr(request.state, "ator", None)}

    app.add_middleware(GateDeSessao, validar_chave=_validador)
    return TestClient(app)


def test_gate_aceita_chave_pessoal_como_bearer(gate, caplog):
    caplog.set_level(logging.INFO)
    r = gate.get("/api/v1/x", headers={"Authorization": f"Bearer {CHAVE_BOA}"})
    assert r.status_code == 200 and r.json() == {"ator": "n@gocase.com"}
    assert "nome=Sim" in caplog.text and CHAVE_BOA not in caplog.text


def test_gate_nega_chave_invalida_e_bearer_que_nao_e_chave(gate):
    for h in (f"Bearer torre_pat_{'B' * 43}", f"Bearer x{CHAVE_BOA}", "Bearer eyJ.a.b", f"Basic {CHAVE_BOA}"):
        assert gate.get("/api/v1/x", headers={"Authorization": h}).status_code == 401, h
