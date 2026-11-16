# tests/test_auth_permitido.py — GET /auth/permitido (login do Next pergunta a API). Sem rede.
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import settings
from app.main import app

CHAVE = "k" * 32


@pytest.fixture
def cli(monkeypatch):
    monkeypatch.setattr(settings, "torre_service_key", SecretStr(CHAVE))
    monkeypatch.setattr(settings, "allowed_email_domains", "gocase.com,Larissa@Gmail.com")
    monkeypatch.setattr(settings, "torre_auth_mode", "enforce")
    monkeypatch.setattr(settings, "auth_secret", SecretStr("s" * 32))
    return TestClient(app)


def _get(cli, email, chave=CHAVE):
    return cli.get("/auth/permitido", params={"email": email}, headers={"x-torre-service-key": chave} if chave else {})


def test_dominio_e_email_avulso_liberados(cli):
    assert _get(cli, "Joao@Gocase.com").json() == {"permitido": True}
    assert _get(cli, "larissa@gmail.com").json() == {"permitido": True}


def test_fora_da_lista_barrado_sem_listar_nada(cli):
    for e in ("outra@gmail.com", "x@gocase.com.evil.com", "semarroba"):
        r = _get(cli, e)
        assert r.status_code == 200 and r.json() == {"permitido": False}, e
        assert "gocase" not in r.text and "larissa" not in r.text.lower()


def test_sem_chave_de_servico_ou_errada_401(cli):
    assert _get(cli, "joao@gocase.com", chave=None).status_code == 401
    assert _get(cli, "joao@gocase.com", chave="x" * 32).status_code == 401


def test_chave_de_servico_curta_no_servidor_nao_vale(cli, monkeypatch):
    monkeypatch.setattr(settings, "torre_service_key", SecretStr("curta"))
    assert _get(cli, "joao@gocase.com", chave="curta").status_code == 401
