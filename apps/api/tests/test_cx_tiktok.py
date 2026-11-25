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
    svc._cipher.clear(); svc._dias.clear()
    toks = {"kokeshi": "ok", "apice": "sem"}
    d = svc.montar(1, ["apice", "kokeshi"], lambda c: toks[c], criar=Fake, hoje=date(2026, 11, 18))
    assert (d["inicio"], d["fim"]) == ("2026-11-17", "2026-11-17")
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


def test_cache_por_dia_so_busca_o_que_falta(monkeypatch):
    monkeypatch.setattr(settings, "tiktok_app_key", "k")
    monkeypatch.setattr(settings, "tiktok_app_secret", SecretStr("s"))
    svc._cipher.clear(); svc._dias.clear()
    chamadas = []

    class Conta(Fake):
        def paginar(self, path, corpo, chave, **k):
            chamadas.append(corpo["create_time_ge"])
            return super().paginar(path, corpo, chave, **k)

    hoje = date(2026, 11, 18)
    d7 = svc.montar(7, ["kokeshi"], lambda c: "ok", criar=Conta, hoje=hoje)
    assert len(chamadas) == 14 and d7["marcas"][0]["devolucoes"] == 7  # 7 dias x 2 rotas
    chamadas.clear()
    d7b = svc.montar(7, ["kokeshi"], lambda c: "ok", criar=Conta, hoje=hoje)
    assert chamadas == [] and d7b["marcas"][0]["cancelamentos"] == 14  # tudo do cache
    svc.montar(10, ["kokeshi"], lambda c: "ok", criar=Conta, hoje=hoje)
    assert len(chamadas) == 6  # so' os 3 dias novos x 2 rotas


def test_pedidos_do_data_mart_entram_so_nas_marcas_com_dado():
    d = {"inicio": "2026-11-11", "fim": "2026-11-17",
         "marcas": [{"marca": "kokeshi", "estado": "dado"}, {"marca": "apice", "estado": "erro"}]}
    pedidos = []
    svc._anotar_pedidos(d, lambda sql, p: pedidos.append(p) or [{"marca": "kokeshi", "pedidos": 1000, "faturamento": 50000.5}])
    assert pedidos[0]["marcas"] == ["kokeshi"]
    assert d["marcas"][0]["pedidos"] == 1000 and d["marcas"][0]["faturamento"] == 50000.5
    assert "pedidos" not in d["marcas"][1]
    svc._anotar_pedidos(d, lambda sql, p: (_ for _ in ()).throw(RuntimeError("x")))  # falha nao derruba


def test_agregado_vai_e_volta_do_json_e_parcial_aparece_enquanto_le():
    from collections import Counter
    from datetime import date as d_

    a = {"devolucoes": 2, "reembolsado": 9.5, "cancelamentos": 3, "nao_pagos": 1, "comprador": 3, "truncado": False,
         "nomes": {"S1": "Creme"}, "motivos": Counter({("Cancelamento", "Não quer mais"): 3}),
         "autores": {("Cancelamento", "Não quer mais"): Counter({"Comprador": 3})},
         "skus": Counter({("Cancelamento", "Não quer mais", "S1"): 2})}
    b = svc.de_json(__import__("json").loads(__import__("json").dumps(svc.para_json(a))))
    assert b["motivos"] == a["motivos"] and b["skus"] == a["skus"] and b["autores"][("Cancelamento", "Não quer mais")]["Comprador"] == 3
    svc._dias.clear(); svc._cache.clear(); svc._rodando.clear()
    svc._dias[("kokeshi", d_.today() - svc.timedelta(days=1))] = (svc.time.time(), b)
    r = svc.obter(7, iniciar=lambda d: None)
    assert r["carregando"] is True and r["marcas"][0]["marca"] == "kokeshi" and r["marcas"][0]["cancelamentos"] == 3
    svc._dias.clear()


def test_hoje_le_so_o_dia_corrente(monkeypatch):
    monkeypatch.setattr(settings, "tiktok_app_key", "k")
    monkeypatch.setattr(settings, "tiktok_app_secret", SecretStr("s"))
    svc._cipher.clear(); svc._dias.clear()
    hoje = date(2026, 11, 18)
    assert svc.janela(0, hoje) == (hoje, hoje)
    d = svc.montar(0, ["kokeshi"], lambda c: "ok", criar=Fake, hoje=hoje)
    assert (d["dias"], d["inicio"], d["fim"]) == (0, "2026-11-18", "2026-11-18")
    assert d["marcas"][0]["devolucoes"] == 1 and d["marcas"][0]["dias_faltando"] == 0
