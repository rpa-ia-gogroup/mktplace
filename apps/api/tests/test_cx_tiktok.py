"""CX do TikTok via Open API: assinatura, junta por motivo/marca, marca sem permissao nao derruba as outras."""
from datetime import date

from pydantic import SecretStr

from app.config import settings
from app.services import cx_tiktok_service as svc
from app.services.tiktok_client import Cliente, TikTokErro, assinar


def test_assinatura_ignora_sign_e_token_e_ordena():
    a = assinar("/p", {"b": "2", "a": "1", "sign": "x", "access_token": "t"}, "{}", "s")
    b = assinar("/p", {"a": "1", "b": "2"}, "{}", "s")
    assert a == b and len(a) == 64


class Fake(Cliente):
    def __init__(self, tok, cipher=None):
        self.tok, self.cipher = tok, cipher

    def lojas(self):
        return [{"cipher": "C-" + self.tok}]

    def paginar(self, path, corpo, chave, **k):
        if self.tok == "sem":
            raise TikTokErro("x", 105005)
        if "returns" in path:
            return [{"return_reason_text": "Produto danificado", "refund_amount": {"refund_total": "30.5"},
                     "return_line_items": [{"seller_sku": "S1", "product_name": "Creme"}]}], False
        return [{"cancel_reason_text": "Não quero mais", "cancel_initiator": "BUYER", "cancel_line_items": []},
                {"cancel_reason_text": "Não quero mais", "cancel_initiator": "BUYER", "cancel_line_items": []}], False


def test_monta_por_motivo_e_marca_e_isola_marca_sem_permissao(monkeypatch):
    monkeypatch.setattr(settings, "tiktok_app_key", "k")
    monkeypatch.setattr(settings, "tiktok_app_secret", SecretStr("s"))
    svc._cipher.clear()
    toks = {"kokeshi": "ok", "apice": "sem"}
    d = svc.montar(7, ["apice", "kokeshi"], lambda c: toks[c], criar=Fake, hoje=date(2026, 11, 18))
    assert (d["inicio"], d["fim"]) == ("2026-11-11", "2026-11-17")
    ap = next(m for m in d["marcas"] if m["marca"] == "apice")
    ko = next(m for m in d["marcas"] if m["marca"] == "kokeshi")
    assert ap["estado"] == "sem_permissao"
    assert (ko["devolucoes"], ko["cancelamentos"], ko["reembolsado"], ko["cancelamentos_comprador"]) == (1, 2, 30.5, 2)
    top = d["motivos"][0]
    assert (top["tipo"], top["motivo"], top["quantidade"], top["autor"]) == ("Cancelamento", "Não quero mais", 2, "Comprador")
    dev = next(m for m in d["motivos"] if m["tipo"] == "Devolução")
    assert dev["skus"] == [{"marca": "kokeshi", "sku": "S1", "produto": "Creme", "quantidade": 1}]
    f = svc._filtrar(d, ["apice"])
    assert f["motivos"] == [] and [m["marca"] for m in f["marcas"]] == ["apice"]


def test_obter_nunca_espera_o_tiktok():
    svc._cache.clear(); svc._rodando.clear()
    disparos = []
    r = svc.obter(7, iniciar=disparos.append)
    assert r["carregando"] is True and disparos == [7]
    assert svc.obter(7, iniciar=disparos.append)["carregando"] is True and disparos == [7]  # ja' rodando: nao dispara de novo
    svc._rodando.clear()
    svc._cache[7] = (svc.time.time(), {"marcas": [{"marca": "kokeshi"}], "motivos": [], "dias": 7})
    assert svc.obter(7, iniciar=disparos.append)["marcas"] == [{"marca": "kokeshi"}] and disparos == [7]
    svc._cache[7] = (0, svc._cache[7][1])  # vencido: devolve o antigo e atualiza por tras
    assert svc.obter(7, iniciar=disparos.append)["marcas"] and disparos == [7, 7]
