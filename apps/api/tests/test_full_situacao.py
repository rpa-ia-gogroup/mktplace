"""Brinde e descontinuado (aba BD da planilha 'Sortimento Gobeaute') saem da fila.

Protege: status sem acento/maiuscula, marca na coluna A (cabecalho numerico),
SKU fora da BD = conta normal, status conflitante = conta normal, BD falhando
nao derruba a curva e a situacao anterior segue, ligacao pela ponte de GTIN e o
filtro do impacto. Dados ficticios; nenhuma chamada ao Google.
"""
from __future__ import annotations

import pytest

from app.schemas.ml_full_stock import InventarioEstoque
from app.services import full_curva_abc_service as svc
from tests.test_full_curva_abc import AGORA, LINHAS, _Sessao

BD = [
    ["2", "SKU Único", "Status", "Descrição", "Curva ABC"],
    ["Apice", "20690", "Ativo", "Ativador", "AA"],
    ["Apice", "BR001", "BRINDE", "Necessaire", ""],
    ["Barbour's", "BB02027", "brinde", "Amostra", ""],
    ["Rituária", "RT01002", "Descontinuado", "Vela", "B"],
    ["Lescent", "LC01", "Lançamento", "Novo", ""],
    ["Lescent", "LC01", "lançamento", "Novo", ""],
    ["Kokeshi", "KK1", "Brinde", "x", ""],
    ["Kokeshi", "KK1", "Ativo", "x", ""],              # conflito: conta normal
    ["", "SEM-MARCA", "Brinde", "x", ""],              # sem marca: ignorada
    ["Apice", "BD01", "Descontinuado", "x", ""],       # PRECEDENCIA brinde > descontinuado:
    ["Apice", "BD01", "Brinde", "x", ""],              # o mesmo SKU nas duas = brinde
]


def test_status_sem_acento_sem_maiuscula_marca_pela_coluna_a_e_precedencia_brinde():
    sit, marcas, conflitos = svc.interpretar_bd(BD)
    assert sit == {("apice", "BR001"): "brinde", ("barbours", "BB02027"): "brinde",
                   ("rituaria", "RT01002"): "descontinuado",
                   ("apice", "BD01"): "brinde"}
    assert ("apice", "20690") not in sit and ("lescent", "LC01") not in sit, "Ativo/Lançamento ficam na fila"
    assert conflitos == (("kokeshi", "KK1"),), "status conflitante nao tira da fila"
    assert "apice" in marcas
    # precedencia brinde > descontinuado; misturado com Ativo e' conflito (nenhum dos dois vale)
    assert sit[("apice", "BD01")] == "brinde"


def test_bd_sem_as_colunas_e_formato_inesperado():
    with pytest.raises(svc.FormatoInesperado):
        svc.interpretar_bd([["2", "Codigo", "Situacao"]])
    with pytest.raises(svc.FormatoInesperado):
        svc.interpretar_bd([])


def _planilha():
    sit, marcas, conflitos = svc.interpretar_bd(BD)
    from dataclasses import replace
    return replace(svc.interpretar(LINHAS, AGORA), situacoes=sit, bd_lida=True, bd_marcas=marcas, bd_conflitos=conflitos)


def _ml(brand, sku, posicao=1):
    return InventarioEstoque.model_construct(posicao=posicao, brand=brand, sku=sku, curva=None, curva_motivo=None, situacao=None)


@pytest.fixture(autouse=True)
def _cache_limpo(monkeypatch):
    monkeypatch.setattr(svc, "_mapa_cache", {"lida_em": None, "em_s": 0.0, "mapa": None})


def test_item_recebe_situacao_e_sem_linha_na_bd_conta_normal():
    itens = [_ml("apice", "BR001"), _ml("rituaria", "RT01002"), _ml("apice", "20690"), _ml("apice", "NAO-ESTA-NA-BD"),
             _ml("kokeshi", "KK1")]
    meta = svc.anotar_curva(itens, _Sessao([]), sku_de=lambda i: i.sku, obter=lambda: (_planilha(), None))
    assert [i.situacao for i in itens] == ["brinde", "descontinuado", None, None, None]
    assert meta["brindes"] == 1 and meta["descontinuados"] == 1 and meta["bd_lida"] is True


def test_situacao_pela_ponte_de_gtin():
    ponte = [{"brand": "apice", "seller_sku": "CANAL-9", "source_sku": "BR001"}]
    itens = [_ml("apice", "CANAL-9")]
    svc.anotar_curva(itens, _Sessao(ponte), sku_de=lambda i: i.sku, obter=lambda: (_planilha(), None))
    assert itens[0].situacao == "brinde"


def test_planilha_nao_lida_ninguem_vira_brinde():
    itens = [_ml("apice", "BR001")]
    meta = svc.anotar_curva(itens, _Sessao([]), sku_de=lambda i: i.sku, obter=lambda: (None, "fora"))
    assert itens[0].situacao is None and meta["disponivel"] is False


def test_bd_falhando_nao_derruba_a_curva_e_mantem_a_situacao_anterior():
    cache = svc._Cache()
    quebra = lambda: (_ for _ in ()).throw(RuntimeError("bd fora"))
    svc._atualizar(cache, lambda: LINHAS, lambda: 1.0, ler_bd=lambda: BD)
    assert cache.planilha.bd_lida and cache.planilha.situacoes
    svc._atualizar(cache, lambda: LINHAS, lambda: 2.0, ler_bd=quebra)
    assert cache.planilha.curvas, "a curva segue"
    assert cache.planilha.situacoes[("apice", "BR001")] == "brinde", "situacao anterior segue valendo"
    novo = svc._Cache()
    svc._atualizar(novo, lambda: LINHAS, lambda: 1.0, ler_bd=quebra)
    assert novo.planilha.curvas and novo.planilha.bd_lida is False and not novo.planilha.situacoes


def test_impacto_tira_brinde_e_descontinuado_e_sem_leitura_mantem_todos():
    itens = [{"brand": "apice", "sku": "BR001"}, {"brand": "rituaria", "sku": "RT01002"},
             {"brand": "apice", "sku": "20690"}, {"brand": "apice", "sku": None}]
    ficam = svc.fora_da_fila(itens, _Sessao([]), obter=lambda: (_planilha(), None))
    assert [i["sku"] for i in ficam] == ["20690", None]

    def quebra():
        raise RuntimeError("x")
    assert svc.fora_da_fila(itens, _Sessao([]), obter=quebra) == itens
    assert svc.fora_da_fila(itens, _Sessao([]), obter=lambda: (None, "fora")) == itens
