# tests/test_metabase_client.py — /api/dataset corta em 2000 linhas: truncado vai pela exportacao. Sem rede.
import json

import pytest

from app import metabase_client as mb

COLS = {"cols": [{"name": "sku"}, {"name": "receita"}]}


class _Resp:
    def __init__(self, corpo):
        self.corpo = corpo

    def raise_for_status(self):
        pass

    def json(self):
        return self.corpo


def _cliente(respostas, chamadas):
    class Cliente:
        def __init__(self, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers, json=None, data=None):
            chamadas.append((url, data))
            return _Resp(respostas.pop(0))

    return Cliente


def test_resultado_inteiro_nao_chama_a_exportacao(monkeypatch):
    chamadas = []
    monkeypatch.setattr(mb.httpx, "Client", _cliente([{"data": {**COLS, "rows": [["A", 1]]}}], chamadas))
    assert mb.query("select 1") == [{"sku": "A", "receita": 1}]
    assert len(chamadas) == 1


def test_resultado_truncado_busca_tudo_pela_exportacao(monkeypatch):
    chamadas = []
    cortado = {"data": {**COLS, "rows": [["A", 1]], "rows_truncated": 2000}}
    inteiro = [{"receita": 1, "sku": "A"}, {"receita": 2, "sku": "MLPREBIOTICA"}]
    monkeypatch.setattr(mb.httpx, "Client", _cliente([cortado, inteiro], chamadas))
    assert mb.query("select 1") == [{"sku": "A", "receita": 1}, {"sku": "MLPREBIOTICA", "receita": 2}]
    url, data = chamadas[1]
    assert url.endswith("/api/dataset/json") and data["format_rows"] == "false"
    assert json.loads(data["query"])["native"]["query"] == "select 1"


def test_erro_na_exportacao_nao_vira_resultado_vazio(monkeypatch):
    cortado = {"data": {**COLS, "rows": [], "rows_truncated": 2000}}
    monkeypatch.setattr(mb.httpx, "Client", _cliente([cortado, {"error": "x"}], []))
    with pytest.raises(RuntimeError):
        mb.query("select 1")
