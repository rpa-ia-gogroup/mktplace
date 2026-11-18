"""Token do app da Torre no TikTok Shop: renova so' perto de vencer, grava o refresh novo, nunca vaza token."""
from datetime import datetime, timedelta, timezone
import json

import pytest
from pydantic import SecretStr

from app.config import settings
from app.services import tiktok_token as tt

AGORA = datetime(2026, 11, 18, 15, tzinfo=timezone.utc)


class Mem:
    def __init__(self, linha=None):
        self.linha, self.trocas = linha, 0

    def ler(self, conta):
        return self.linha

    def trocar(self, conta, fn):
        self.trocas += 1
        self.linha = fn(self.linha)
        return self.linha


class Resp:
    def __init__(self, j):
        self._j = j

    def raise_for_status(self):
        pass

    def json(self):
        return self._j


@pytest.fixture(autouse=True)
def app_configurado(monkeypatch):
    monkeypatch.setattr(settings, "tiktok_app_key", "k")
    monkeypatch.setattr(settings, "tiktok_app_secret", SecretStr("s"))


def _linha(vence_em):
    return {"access_token": "A1", "access_expires_at": AGORA + vence_em, "refresh_token": "R1",
            "refresh_expires_at": None, "open_id": "o", "seller_name": "Loja"}


def test_token_longe_de_vencer_nao_renova():
    m = Mem(_linha(timedelta(days=3)))
    assert tt.obter_access_token(m, "kokeshi", get=lambda *a, **k: pytest.fail("nao devia chamar"), agora=lambda: AGORA) == "A1"
    assert m.trocas == 0


def test_perto_de_vencer_renova_e_guarda_refresh_novo():
    chamadas = []
    novo = {"code": 0, "data": {"access_token": "A2", "refresh_token": "R2",
                                "access_token_expire_in": int((AGORA + timedelta(days=7)).timestamp()),
                                "refresh_token_expire_in": 4916899002}}

    def get(url, params, timeout):
        chamadas.append(params)
        return Resp(novo)

    m = Mem(_linha(timedelta(hours=5)))
    assert tt.obter_access_token(m, "kokeshi", get=get, agora=lambda: AGORA) == "A2"
    assert chamadas[0]["refresh_token"] == "R1" and chamadas[0]["grant_type"] == "refresh_token"
    assert m.linha["refresh_token"] == "R2"
    assert m.linha["access_expires_at"] == AGORA + timedelta(days=7)


def test_erro_do_tiktok_nao_vaza_token_e_mantem_o_antigo():
    m = Mem(_linha(timedelta(hours=1)))
    with pytest.raises(tt.TikTokIndisponivel) as e:
        tt.obter_access_token(m, "kokeshi", get=lambda *a, **k: Resp({"code": 36004004, "message": "R1 invalido"}), agora=lambda: AGORA)
    assert "R1" not in str(e.value) and "A1" not in str(e.value)
    assert m.linha["refresh_token"] == "R1"


def test_loja_sem_linha_e_nao_autorizada():
    with pytest.raises(tt.TikTokIndisponivel, match="não autorizada"):
        tt.obter_access_token(Mem(None), "denavita", agora=lambda: AGORA)


def test_carga_le_o_json_mais_novo_de_cada_marca(tmp_path):
    from tools.tiktok_tokens_carregar import ler_pasta

    def resp(tok):
        return json.dumps({"code": 0, "data": {"access_token": tok, "refresh_token": "r", "access_token_expire_in": 1795628155,
                                               "refresh_token_expire_in": 4916899002, "seller_name": "X"}})
    (tmp_path / "20261118-140000_kokeshi.json").write_text(resp("velho"))
    (tmp_path / "20261118-150000_kokeshi.json").write_text(resp("novo"))
    (tmp_path / "20261118-150000_apice.json").write_text(json.dumps({"code": 36004003, "message": "erro"}))
    linhas = ler_pasta(tmp_path)
    assert list(linhas) == ["kokeshi"] and linhas["kokeshi"]["access_token"] == "novo"
