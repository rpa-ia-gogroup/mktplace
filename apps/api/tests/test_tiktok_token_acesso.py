# tests/test_tiktok_token_acesso.py — access_token vivo do TikTok por chave pessoal. Sem banco nem rede.
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.database import get_db
from app.routers import tiktok_token_acesso as rota

VENCE = datetime(2026, 12, 1, tzinfo=timezone.utc)


def test_acessos_e_liberado():
    cfg = "Ana@gocase.com:kokeshi|lescent; bia@gobeaute.com.br:*"
    assert rota.acessos(cfg) == {"ana@gocase.com": {"kokeshi", "lescent"}, "bia@gobeaute.com.br": {"*"}}
    assert rota.liberado("ana@gocase.com", "kokeshi", cfg)
    assert not rota.liberado("ana@gocase.com", "apice", cfg)
    assert rota.liberado("BIA@gobeaute.com.br", "apice", cfg)
    assert not rota.liberado("ana@gocase.com", "kokeshi", "")  # vazia = ninguem
    assert rota.liberado("qualquer@gocase.com", "apice", "*:*")  # qualquer chave valida
    assert rota.liberado("x@gocase.com", "kokeshi", "*:kokeshi") and not rota.liberado("x@gocase.com", "apice", "*:kokeshi")


@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(rota.router)
    app.dependency_overrides[get_db] = lambda: object()
    monkeypatch.setattr(settings, "tiktok_token_acesso", "ana@gocase.com:kokeshi")
    monkeypatch.setattr(settings, "allowed_email_domains", "gocase.com,gobeaute.com.br")
    rota._limite.limpar()

    def validar(db, chave, agora):
        return SimpleNamespace(id=7, nome="automacao", dono_email="ana@gocase.com") if chave == "torre_pat_ok" else None

    monkeypatch.setattr(rota.chaves_pessoais, "validar", validar)
    monkeypatch.setattr(rota.tiktok_token, "obter_access_token", lambda armazem, conta: "tok-vivo")

    class Armazem:
        def __init__(self, db):
            pass

        def ler(self, conta):
            return {"access_expires_at": VENCE, "refresh_token": "NUNCA-SAI"}

    monkeypatch.setattr(rota.tiktok_token, "ArmazemPg", Armazem)
    return TestClient(app)


def _get(c, marca, chave="torre_pat_ok"):
    return c.get(f"/api/v1/tiktok/token/{marca}", headers={"Authorization": f"Bearer {chave}"} if chave else {})


def test_entrega_so_o_access_token(cliente):
    r = _get(cliente, "kokeshi")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json() == {"marca": "kokeshi", "access_token": "tok-vivo", "expira_em": VENCE.isoformat()}
    assert "NUNCA-SAI" not in r.text


def test_sem_chave_ou_chave_errada_e_401(cliente):
    assert _get(cliente, "kokeshi", None).status_code == 401
    assert _get(cliente, "kokeshi", "torre_pat_errada").status_code == 401


def test_marca_fora_da_lista_e_403(cliente):
    assert _get(cliente, "apice").status_code == 403


def test_limite_por_chave(cliente):
    codigos = [_get(cliente, "kokeshi").status_code for _ in range(31)]
    assert codigos[-1] == 429 and codigos[0] == 200
