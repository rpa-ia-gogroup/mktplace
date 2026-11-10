"""Cache persistente e rotina de aquecimento do Bling (marcas menores). Tudo com mock, sem rede nem banco."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

import pytest

from app.services import bling_warm
from app.services import marcas_menores_service as svc
from app.services.bling_token import BlingIndisponivel
from tests.test_marcas_menores import AUA_SHOPEE, CANCELADO, DADOS, FakeBling, YENZAH_SHOPEE, YENZAH_TIKTOK, pedido

HOJE = date(2026, 11, 10)
ITENS = {
    1: [{"codigo": "A", "descricao": "Sérum", "quantidade": 2, "valor": 50.0, "desconto": 0}],
    2: [{"codigo": "A", "descricao": "Sérum", "quantidade": 1, "valor": 50.5}],
    4: [{"codigo": "B", "descricao": "Óleo", "quantidade": 1, "valor": 10.0}],
    5: [{"codigo": "C", "descricao": "Kit", "quantidade": 1, "valor": 7.0}],
}


class FakeCache:
    """Mesma interface do cache Postgres, em memoria."""

    def __init__(self, lock_livre: bool = True):
        self.linhas: dict[int, dict] = {}
        self.itens_: dict[int, list] = {}
        self.sync: dict[str, tuple[str | None, datetime]] = {}
        self.lock_livre = lock_livre

    def pedidos(self, lojas, inicio, fim):
        lojas = set(lojas)
        return [dict(r) for r in self.linhas.values() if r["loja_id"] in lojas and inicio <= r["data"] <= fim]

    def salvar_pedidos(self, linhas):
        for l in linhas:
            self.linhas[l["id"]] = dict(l)

    def itens(self, ids):
        return {i: self.itens_[i] for i in ids if i in self.itens_}

    def salvar_itens(self, pedido_id, itens):
        self.itens_.setdefault(pedido_id, itens)

    def ids_sem_itens(self, lojas, inicio, fim, cancelado):
        return [r["id"] for r in sorted(self.linhas.values(), key=lambda r: (r["data"], r["id"]), reverse=True)
                if r["loja_id"] in set(lojas) and inicio <= r["data"] <= fim and r["situacao_id"] != cancelado and r["id"] not in self.itens_]

    def ler_sync(self, chave):
        return self.sync.get(chave)

    def ler_sync_prefixo(self, prefixo):
        return {k: v for k, v in self.sync.items() if k.startswith(prefixo)}

    def marcar_sync(self, chave, valor):
        self.sync[chave] = (valor, datetime.now(timezone.utc))

    @contextmanager
    def trava(self):
        yield self.lock_livre


@pytest.fixture(autouse=True)
def _limpo():
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def _bling():
    # as datas dos pedidos de teste sao de novembro/2026; a lista tambem devolve o cancelado (id 3)
    return FakeBling({k: list(v) for k, v in DADOS.items()}, ITENS)  # copia: o teste muta


def test_primeiro_ciclo_guarda_lista_e_itens_dos_nao_cancelados():
    cache, fake = FakeCache(), _bling()
    r = bling_warm.sincronizar(fake, cache, HOJE)
    assert r["pedidos"] == 5 and r["itens_lidos"] == 4 and r["itens_faltando"] == 0
    assert set(cache.linhas) == {1, 2, 3, 4, 5}  # o cancelado fica guardado (a leitura o exclui)
    assert cache.linhas[3]["situacao_id"] == CANCELADO
    assert set(cache.itens_) == {1, 2, 4, 5}  # item do cancelado nunca e' lido
    for loja in svc.LOJAS:
        assert cache.ler_sync(f"lista:{loja}")[0] == (HOJE - timedelta(days=90)).isoformat()


def test_segundo_ciclo_pega_so_o_que_mudou_e_nao_rele_itens():
    cache, fake = FakeCache(), _bling()
    bling_warm.sincronizar(fake, cache, HOJE)
    antes = len([c for c, _ in fake.chamadas if c.startswith("/pedidos/vendas/")])
    fake.chamadas.clear()
    bling_warm.sincronizar(fake, cache, HOJE)
    assert len([c for c, _ in fake.chamadas if c.startswith("/pedidos/vendas/") ]) == 0  # nenhum detalhe de novo
    listas = [p for c, p in fake.chamadas if c == "/pedidos/vendas"]
    assert any("dataAlteracaoInicial" in p for p in listas)  # janela de alteracao: pega cancelamentos antigos
    assert any(p["dataInicial"] == (HOJE - timedelta(days=1)).isoformat() for p in listas)  # ontem e hoje a cada ciclo
    assert antes == 4


def test_cancelamento_posterior_entra_pela_janela_de_alteracao():
    cache, fake = FakeCache(), _bling()
    bling_warm.sincronizar(fake, cache, HOJE)
    # o pedido 2 foi cancelado no Bling depois; o ciclo seguinte (so' janela de alteracao) o atualiza
    fake.pedidos[YENZAH_SHOPEE] = [pedido(1, "2026-11-08", 100.0), pedido(2, "2026-11-09", 50.5, CANCELADO), pedido(3, "2026-11-09", 999.0, CANCELADO)]
    bling_warm.sincronizar(fake, cache, HOJE)
    assert cache.linhas[2]["situacao_id"] == CANCELADO
    r = svc.get_marcas_menores(_SemBling(), date(2026, 11, 1), date(2026, 11, 9), HOJE, cache=cache)
    assert {m["id"]: m for m in r["marcas"]}["yenzah"]["total"] == 110.0  # 100 + 10 do TikTok


class _SemBling:
    """Qualquer chamada ao Bling quebra: prova que a leitura veio so' do cache."""

    def get(self, caminho, params=None):
        raise AssertionError(f"chamou o Bling: {caminho}")


def test_cache_quente_serve_a_leitura_sem_chamar_o_bling_e_bate_com_a_leitura_ao_vivo():
    cache = FakeCache()
    bling_warm.sincronizar(_bling(), cache, HOJE)
    svc.limpar_cache()
    quente = svc.get_marcas_menores(_SemBling(), date(2026, 11, 1), date(2026, 11, 9), HOJE, cache=cache)
    svc.limpar_cache()
    vivo = svc.get_marcas_menores(_bling(), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert quente == vivo


def test_cancelado_id_fica_guardado_e_nao_se_descobre_de_novo():
    cache = FakeCache()
    bling_warm.sincronizar(_bling(), cache, HOJE)
    assert cache.ler_sync("cancelado_id")[0] == str(CANCELADO)
    svc.limpar_cache()  # "reinicio": a memoria some, o banco fica
    assert svc.id_cancelado(_SemBling(), cache) == CANCELADO


def test_cache_velho_ou_que_nao_cobre_vai_ao_bling_e_aciona_a_rotina():
    cache = FakeCache()
    bling_warm.sincronizar(_bling(), cache, HOJE)
    acionou = []
    # velho: a ultima sincronizacao passou de 45 min
    velho = datetime.now(timezone.utc) - timedelta(minutes=50)
    for k, (v, _) in list(cache.sync.items()):
        if k.startswith("lista:"):
            cache.sync[k] = (v, velho)
    svc.limpar_cache()
    fake = _bling()
    r = svc.get_marcas_menores(fake, date(2026, 11, 1), date(2026, 11, 9), HOJE, cache=cache, ao_faltar_cache=lambda: acionou.append(1))
    assert r["disponivel"] and acionou and any(c == "/pedidos/vendas" for c, _ in fake.chamadas)
    # janela antes da cobertura (mais de 90 dias atras): tambem ao vivo
    cache2 = FakeCache()
    bling_warm.sincronizar(_bling(), cache2, HOJE)
    svc.limpar_cache()
    fake2 = _bling()
    svc.get_marcas_menores(fake2, date(2026, 1, 1), date(2026, 1, 31), HOJE, cache=cache2)
    assert any(c == "/pedidos/vendas" for c, _ in fake2.chamadas)


def test_sem_cache_nada_muda():
    r = svc.get_marcas_menores(_bling(), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    assert r["disponivel"] is True


def test_outra_instancia_sincronizando_pula_o_ciclo_sem_chamar_o_bling():
    r = bling_warm.sincronizar(_SemBling(), FakeCache(lock_livre=False), HOJE)
    assert r == {"pulado": True}


def test_produtos_leem_os_itens_do_cache_sem_chamar_o_bling():
    cache = FakeCache()
    bling_warm.sincronizar(_bling(), cache, HOJE)
    svc.limpar_cache()
    r = svc.get_produtos(_SemBling(), date(2026, 11, 1), date(2026, 11, 9), HOJE, cache=cache)
    assert r["completo"] is True and r["pedidos_total"] == 4
    m = {x["id"]: x for x in r["marcas"]}
    assert {p["sku"] for p in m["yenzah"]["produtos"]} == {"A", "B"}


def test_com_cache_e_rotina_a_requisicao_nao_le_item_no_bling_e_aciona_a_rotina():
    """Causa dos 30 s: a rota lia 36 itens ao vivo por chamada enquanto a rotina ainda enchia o backlog."""
    cache = FakeCache()
    bling_warm.sincronizar(_bling(), cache, HOJE)  # lista + itens
    for pid in (2, 5):  # backlog: dois pedidos ainda sem item
        del cache.itens_[pid]
    svc.limpar_cache()
    acionou = []
    fake = _bling()
    r = svc.get_produtos(fake, date(2026, 11, 1), date(2026, 11, 9), HOJE, cache=cache, ao_faltar_cache=lambda: acionou.append(1))
    assert [c for c, _ in fake.chamadas if c.startswith("/pedidos/vendas/")] == []  # nenhum item lido ao vivo
    assert acionou  # a rotina e' acionada para preencher
    assert r["completo"] is False and r["pedidos_lidos"] == 2 and r["pedidos_total"] == 4
    assert {p["sku"] for mm in r["marcas"] for p in mm["produtos"]} == {"A", "B"}  # o que o banco tem ja' aparece
    # a rotina preenche e a proxima leitura fecha, ainda sem tocar no Bling
    bling_warm.sincronizar(_bling(), cache, HOJE)
    svc.limpar_cache()
    r2 = svc.get_produtos(_SemBling(), date(2026, 11, 1), date(2026, 11, 9), HOJE, cache=cache)
    assert r2["completo"] is True and r2["pedidos_lidos"] == 4


def test_itens_por_canal_contam_pedidos_distintos_por_produto():
    dados = {YENZAH_SHOPEE: [pedido(1, "2026-11-08", 100.0), pedido(2, "2026-11-09", 50.0)]}
    itens = {
        1: [{"codigo": "A", "quantidade": 1, "valor": 60.0}, {"codigo": "A", "quantidade": 1, "valor": 40.0}],  # repetido no mesmo pedido
        2: [{"codigo": "A", "quantidade": 1, "valor": 50.0}],
    }
    r = svc.get_produtos(FakeBling(dados, itens), date(2026, 11, 1), date(2026, 11, 9), HOJE)
    linha = {m["id"]: m for m in r["marcas"]}["yenzah"]["itens_por_canal"][0]
    assert linha["quantidade"] == 3.0 and linha["pedidos"] == 2  # 3 unidades em 2 pedidos


def test_item_lido_ao_vivo_e_guardado_quando_a_rotina_esta_desligada(monkeypatch):
    monkeypatch.setattr(svc.settings, "bling_warm_enabled", False)
    cache = FakeCache()
    fake = _bling()
    svc.get_produtos(fake, date(2026, 11, 1), date(2026, 11, 9), HOJE, cache=cache)
    assert set(cache.itens_) == {1, 2, 4, 5}


def test_proximo_ciclo_vem_logo_enquanto_ha_backlog_de_itens():
    assert bling_warm.proxima_espera({"pedidos": 5, "itens_lidos": 600, "itens_faltando": 120}) == bling_warm.PROXIMO_COM_BACKLOG_S
    assert bling_warm.proxima_espera({"pedidos": 5, "itens_lidos": 3, "itens_faltando": 0}) == max(60, bling_warm.settings.bling_warm_intervalo_s)
    assert bling_warm.proxima_espera(None) == max(60, bling_warm.settings.bling_warm_intervalo_s)


def test_falha_do_bling_no_ciclo_nao_derruba_nem_vaza():
    class Quebra(FakeBling):
        def get(self, caminho, params=None):
            raise BlingIndisponivel("Bling indisponível agora.")

    with pytest.raises(BlingIndisponivel):
        bling_warm.sincronizar(Quebra(), FakeCache(), HOJE)
    # o laco em segundo plano captura e so' registra o nome da excecao (testado em _ciclo)


def test_nenhum_log_do_ciclo_carrega_token(caplog, monkeypatch):
    import logging

    cache = FakeCache()
    monkeypatch.setattr("app.services.bling_warm.cliente_com_sessao", lambda db: _bling())
    monkeypatch.setattr("app.database.SessionLocal", lambda: type("S", (), {"close": lambda self: None})())
    monkeypatch.setattr("app.services.bling_cache.ArmazemCachePg", lambda db: cache)
    monkeypatch.setattr(bling_warm.settings, "bling_client_id", "id-teste")
    with caplog.at_level(logging.INFO):
        bling_warm._ciclo()
    texto = " ".join(r.getMessage() for r in caplog.records)
    assert "bling aquecido" in texto and "Bearer" not in texto and "token" not in texto.lower()
