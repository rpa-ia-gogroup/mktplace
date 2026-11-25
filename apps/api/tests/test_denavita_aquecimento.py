"""Denavita no cache do banco SEM DDL (ids negativos nas mesmas tabelas) e aquecida pela rotina. Tudo com dubles."""
from __future__ import annotations

from datetime import date

import pytest

from app.config import settings
from app.services import bling_cache, bling_warm
from app.services import marcas_menores_service as svc
from app.services.bling_token import BlingIndisponivel
from tests.test_bling_cache import FakeCache
from tests.test_bling_denavita import CANCELADO_DEN, DEN_ML, DEN_SHOPEE, FakeBlingDenavita
from tests.test_denavita_itens import DEN, DEN_ITENS, INI, FIM, RIT, RIT_ITENS
from tests.test_marcas_menores import YENZAH_SHOPEE, FakeBling

HOJE = date(2026, 11, 16)


class Proibido:
    """Qualquer chamada ao Bling quebra: prova que a leitura veio so' do banco."""

    def get(self, caminho, params=None):
        raise AssertionError(f"chamou o Bling: {caminho}")


@pytest.fixture(autouse=True)
def _limpo(monkeypatch):
    monkeypatch.setattr(settings, "bling_denavita_lojas", "")
    monkeypatch.setattr(settings, "bling_denavita_situacao_cancelado_id", 0)
    svc.limpar_cache()
    yield
    svc.limpar_cache()


def _ciclo(cache=None, den=True, **kw):
    cache = cache if cache is not None else FakeCache()
    rit = FakeBling({k: list(v) for k, v in RIT.items()}, RIT_ITENS)
    den_cli = FakeBlingDenavita({k: list(v) for k, v in DEN.items()}, DEN_ITENS) if den is True else den
    stats = bling_warm.sincronizar(rit, cache, HOJE, cli_denavita=den_cli, **kw)
    return stats, cache, rit, den_cli


def _detalhes(fake):
    return [c for c, _ in fake.chamadas if c.startswith("/pedidos/vendas/")]


# ---------------------------------------------------------------- aquecimento das duas contas

def test_ciclo_aquece_lista_e_itens_das_duas_contas_com_id_negativo_para_a_denavita():
    stats, cache, rit, den = _ciclo()
    assert set(cache.linhas) == {11, 12, -11, -13, -14}, "Rituaria 11/12; Denavita -11/-13(cancelado)/-14; TikTok do Bling nao entra"
    assert cache.linhas[-11]["loja_id"] == DEN_ML and cache.linhas[-14]["loja_id"] == DEN_SHOPEE, "loja_id e' a loja real"
    assert cache.linhas[11]["loja_id"] == YENZAH_SHOPEE, "o id 11 da Rituaria nao foi sobrescrito pelo 11 da Denavita"
    assert cache.linhas[-13]["situacao_id"] == CANCELADO_DEN
    assert set(cache.itens_) == {11, 12, -11, -14}, "item do cancelado nunca e' lido"
    assert cache.itens_[11][0]["codigo"] == "RIT-A" and cache.itens_[-11][0]["codigo"] == "DEN-X"
    assert stats["itens_lidos"] == 4 and stats["itens_faltando"] == 0
    assert stats["denavita_itens_lidos"] == 2 and stats["denavita_itens_faltando"] == 0
    assert sorted(_detalhes(den)) == ["/pedidos/vendas/11", "/pedidos/vendas/14"]
    # o que a leitura sem Bling precisa: lojas e situacao "Cancelado" da conta, no banco
    assert cache.sync["lojas_denavita"][0] == f"{DEN_ML}:MELI,{DEN_SHOPEE}:SHOPEE"
    assert cache.sync["cancelado_id:denavita"][0] == str(CANCELADO_DEN)
    assert f"lista:{DEN_ML}" in cache.sync and f"lista:{DEN_SHOPEE}" in cache.sync


def test_segundo_ciclo_com_a_memoria_zerada_nao_rele_nada():
    _, cache, *_ = _ciclo()
    svc.limpar_cache()  # como num reinicio do Render: a memoria some, o banco fica
    stats, _, rit, den = _ciclo(cache=cache)
    assert stats["itens_lidos"] == 0 and stats["itens_faltando"] == 0
    assert _detalhes(rit) == [] and _detalhes(den) == []


def test_nada_da_rituaria_le_linha_da_denavita():
    _, cache, *_ = _ciclo()
    assert {r["id"] for r in cache.pedidos(svc.LOJAS.keys(), date(2026, 1, 1), HOJE)} == {11, 12}, "filtro por loja"
    assert cache.ids_sem_itens(svc.LOJAS.keys(), date(2026, 1, 1), HOJE, 15) == []
    svc.limpar_cache()
    lista = svc.pedidos(Proibido(), INI, FIM, cache=cache)  # leitura da Rituaria so' do banco
    assert sorted(p["id"] for p in lista) == [11, 12] and {p["marca"] for p in lista} == {"yenzah"}


def test_um_limite_so_dividido_entre_as_contas_rituaria_primeiro_e_backlog():
    s1, cache, *_ = _ciclo(limite_detalhes=2)
    assert set(cache.itens_) == {11, 12}, "o limite acabou na Rituaria"
    assert s1["denavita_itens_lidos"] == 0 and s1["denavita_itens_faltando"] == 2
    assert s1["itens_faltando"] == 2 and bling_warm.proxima_espera(s1) == bling_warm.PROXIMO_COM_BACKLOG_S
    s2, cache, *_ = _ciclo(cache=cache, limite_detalhes=2)
    assert set(cache.itens_) == {11, 12, -11, -14} and s2["itens_faltando"] == 0
    assert bling_warm.proxima_espera(s2) != bling_warm.PROXIMO_COM_BACKLOG_S


def test_pedidos_mais_novos_da_denavita_primeiro():
    cache = FakeCache()
    for pid, itens in RIT_ITENS.items():
        cache.salvar_itens(pid, itens)
    s, cache, *_ = _ciclo(cache=cache, limite_detalhes=1)
    assert -14 in cache.itens_ and -11 not in cache.itens_, "14 (05/11) e' mais novo que 11 (03/11)"
    assert s["denavita_itens_faltando"] == 1


def test_bling_da_denavita_fora_nao_derruba_o_ciclo_da_rituaria():
    class Fora(FakeBlingDenavita):
        def get(self, caminho, params=None):
            if caminho == "/canais-venda":
                raise BlingIndisponivel("Bling da Denavita recusou o token.")
            return super().get(caminho, params)

    stats, cache, *_ = _ciclo(den=Fora(DEN, DEN_ITENS))
    assert set(cache.itens_) == {11, 12} and not any(k < 0 for k in cache.linhas)
    assert stats["itens_lidos"] == 2 and "denavita_itens_lidos" not in stats


def test_sem_cliente_da_denavita_o_ciclo_e_o_de_antes():
    stats, cache, *_ = _ciclo(den=None)
    assert "denavita_itens_lidos" not in stats and set(cache.itens_) == {11, 12} and not any(k < 0 for k in cache.linhas)


def test_loja_da_denavita_igual_a_da_rituaria_para_tudo_e_a_rituaria_segue(monkeypatch):
    monkeypatch.setattr(settings, "bling_denavita_lojas", f"{YENZAH_SHOPEE}:SHOPEE")
    with pytest.raises(BlingIndisponivel):
        svc.lojas_denavita(FakeBlingDenavita(DEN, DEN_ITENS))
    stats, cache, *_ = _ciclo()
    assert set(cache.itens_) == {11, 12} and not any(k < 0 for k in cache.linhas), "Denavita adiada, Rituaria intacta"


def test_canal_novo_entra_no_ciclo_seguinte_sem_reiniciar():
    den = FakeBlingDenavita({k: list(v) for k, v in DEN.items()}, DEN_ITENS)
    cache = FakeCache()
    _ciclo(cache=cache, den=den)
    assert cache.sync["lojas_denavita"][0] == f"{DEN_ML}:MELI,{DEN_SHOPEE}:SHOPEE"
    orig = den.get

    def com_canal_novo(caminho, params=None):
        r = orig(caminho, params)
        if caminho == "/canais-venda":
            r = {"data": r["data"] + [{"id": 9777, "descricao": "Shopee Nova", "tipo": "Shopee"}]}
        return r

    den.get = com_canal_novo
    _ciclo(cache=cache, den=den)
    assert cache.sync["lojas_denavita"][0] == f"{DEN_ML}:MELI,{DEN_SHOPEE}:SHOPEE,9777:SHOPEE"


def test_ciclo_da_rotina_passa_o_cliente_da_denavita(monkeypatch):
    import app.database as database
    from app.services import bling_client

    visto = {}

    class Db:
        def close(self):
            visto["fechou"] = True

    monkeypatch.setattr(database, "SessionLocal", lambda: Db())
    monkeypatch.setattr(bling_warm.settings, "bling_client_id", "id")
    monkeypatch.setattr(bling_warm, "cliente_com_sessao", lambda db: "cli-rituaria")
    monkeypatch.setattr(bling_client, "cliente_denavita", lambda db: ("cli-denavita", None))
    monkeypatch.setattr(bling_cache, "ArmazemCachePg", lambda db: "cache")
    monkeypatch.setattr(bling_warm, "sincronizar", lambda cli, cache, hoje, **kw: visto.update(kw, cli=cli) or {"pedidos": 0})
    assert bling_warm._ciclo() == {"pedidos": 0}
    assert visto["cli"] == "cli-rituaria" and visto["cli_denavita"] == "cli-denavita" and visto["fechou"]
    monkeypatch.setattr(bling_client, "cliente_denavita", lambda db: (None, "Bling da Denavita: conta ainda sem autorização (sem token gravado)."))
    bling_warm._ciclo()
    assert visto["cli_denavita"] is None


# ---------------------------------------------------------------- leitura das requisicoes: do banco, sem chamada ao vivo

def test_marcas_menores_le_a_denavita_do_banco_sem_chamar_o_bling_dela():
    _, cache, *_ = _ciclo()
    svc.limpar_cache()
    acionou = []
    r = svc.get_marcas_menores(
        Proibido(), INI, FIM, HOJE, cache=cache, ao_faltar_cache=lambda: acionou.append(1), cli_denavita=Proibido(),
    )
    d = {m["id"]: m for m in r["marcas"]}["denavita"]
    assert d["total"] == 230.0, "ML 200 + Shopee 30; cancelado e TikTok do Bling fora"
    assert {p["plataforma"]: p["faturamento"] for p in d["por_plataforma"]} == {"MELI": 200.0, "SHOPEE": 30.0}
    assert not acionou, "cache quente: a rotina nem e' acionada"
    assert {m["id"]: m for m in r["marcas"]}["yenzah"]["total"] == 150.0


def test_produtos_le_a_denavita_do_banco_sem_chamar_o_bling_dela(monkeypatch):
    monkeypatch.setattr(svc.settings, "bling_warm_enabled", True)
    _, cache, *_ = _ciclo()
    svc.limpar_cache()
    r = svc.get_produtos(Proibido(), INI, FIM, HOJE, cache=cache, cli_denavita=Proibido())
    d = {m["id"]: m for m in r["marcas"]}["denavita"]
    assert r["completo"] is True and r["pedidos_lidos"] == 4
    assert {p["sku"] for p in d["produtos"]} == {"DEN-X", "DEN-Y"} and d["receita_itens"] == 220.0
    assert {p["sku"] for p in {m["id"]: m for m in r["marcas"]}["yenzah"]["produtos"]} == {"RIT-A", "RIT-B"}


def test_cache_frio_cai_no_bling_e_aciona_a_rotina():
    acionou = []
    den = FakeBlingDenavita({k: list(v) for k, v in DEN.items()}, DEN_ITENS)
    lista = svc.pedidos_denavita_bling(den, INI, FIM, cache=FakeCache(), ao_faltar_cache=lambda: acionou.append(1))
    assert sorted(p["id"] for p in lista) == [11, 14] and acionou, "reserva ao vivo + rotina acionada"
    # reserva so' quando o banco nao cobre: com a lista no banco, nenhuma chamada
    _, cache, *_ = _ciclo()
    svc.limpar_cache()
    assert sorted(p["id"] for p in svc.pedidos_denavita_bling(Proibido(), INI, FIM, cache=cache)) == [11, 14]
