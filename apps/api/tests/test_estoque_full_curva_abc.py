"""PR3 -- curva ABC por item nas listas de estoque do Full (Shopee e ML).

Protege: item com curva (direto e pela ponte de GTIN), kit, sem ponte, marca
fora da planilha, leitura em falha (todos None, nunca "C"), duplicata da fonte
(vale o maior faturamento), a ponte guardada junto com a planilha e o
`curva_meta` nas duas rotas. Dados ficticios; nenhuma chamada ao Google.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.schemas.full_curva_abc import CurvaMeta
from app.schemas.ml_full_stock import InventarioEstoque
from app.schemas.shopee_fbs_stock import ProdutoEstoque
from app.services import full_curva_abc_service as svc
from tests.test_full_curva_abc import AGORA, LINHAS, _Sessao

PLANILHA = svc.interpretar(LINHAS, AGORA)   # apice|20690 duplicado: AA (maior faturamento) e C
PONTE = [{"brand": "barbours", "seller_sku": "10009", "source_sku": "BB02027"}]


@pytest.fixture(autouse=True)
def _cache_limpo(monkeypatch):
    monkeypatch.setattr(svc, "_mapa_cache", {"lida_em": None, "em_s": 0.0, "mapa": None})


def _shopee(brand, sku, kit=False):
    # so' os campos que a curva usa (o resto do produto nao importa aqui)
    return ProdutoEstoque.model_construct(brand=brand, item_sku=sku, is_kit=kit, curva=None, curva_motivo=None)


def _ml(brand, sku, posicao=1):
    return InventarioEstoque.model_construct(posicao=posicao, brand=brand, sku=sku, curva=None, curva_motivo=None)


def _anotar(itens, sessao=None, obter=lambda: (PLANILHA, None), **kw):
    return svc.anotar_curva(itens, sessao or _Sessao(PONTE), obter=obter, **kw)


def test_shopee_cada_caso_com_o_motivo_certo():
    itens = [
        _shopee("apice", "20690"),            # direto; duplicata na fonte -> AA, nunca a C
        _shopee("barbours", "10009"),         # pela ponte de GTIN -> A
        _shopee("barbours", "BB-KIT-1", kit=True),   # kit (is_kit da Shopee)
        _shopee("rituaria", "99999"),         # marca na planilha, codigo sem ligacao
        _shopee("kokeshi", "40125"),          # marca fora da planilha
        _shopee("lescent", None),             # sem SKU: sem ponte
    ]
    meta = _anotar(itens, sku_de=lambda p: p.item_sku, kit_de=lambda p: p.is_kit)
    assert [(i.curva, i.curva_motivo) for i in itens] == [
        ("AA", None), ("A", None), (None, "kit"), (None, "sem_ponte"), (None, "marca_fora"),
        (None, "marca_fora"),   # lescent so' tinha curva invalida ("X"): nao conta como marca da planilha
    ]
    assert meta["disponivel"] is True and meta["lida_em"] == AGORA
    assert (meta["itens_com_curva"], meta["itens_total"]) == (2, 6)
    CurvaMeta(**meta)   # o bloco cabe no contrato


def test_ml_kit_pelo_codigo_e_inventario_sem_sku():
    itens = [_ml("barbours", "Kit110", 1), _ml("rituaria", "RT01002", 2), _ml("barbours", None, 3)]
    meta = _anotar(itens, sku_de=lambda i: i.sku)
    assert [(i.curva, i.curva_motivo) for i in itens] == [(None, "kit"), ("B", None), (None, "sem_ponte")]
    assert meta["itens_com_curva"] == 1


@pytest.mark.parametrize("motivo", [svc.MOTIVO_SEM_CREDENCIAL, svc.MOTIVO_LEITURA, svc.MOTIVO_FORMATO])
def test_leitura_em_falha_deixa_todos_sem_curva_e_nunca_c(motivo):
    itens = [_shopee("apice", "20690"), _shopee("barbours", "10009"), _shopee("kokeshi", "1")]
    meta = _anotar(itens, obter=lambda: (None, motivo), sku_de=lambda p: p.item_sku)
    assert all(i.curva is None and i.curva_motivo is None for i in itens)
    assert meta == {"disponivel": False, "motivo": motivo, "lida_em": None,
                    "itens_com_curva": 0, "itens_total": 3}


def test_erro_inesperado_na_ponte_nao_derruba_a_lista():
    class Quebra:
        def execute(self, *a, **k):
            raise RuntimeError("banco caiu")
    itens = [_shopee("apice", "20690")]
    meta = svc.anotar_curva(itens, Quebra(), obter=lambda: (PLANILHA, None), sku_de=lambda p: p.item_sku)
    assert meta["disponivel"] is False and itens[0].curva is None


def test_ponte_guardada_com_a_planilha_por_1h():
    t = [100.0]
    s = _Sessao(PONTE)
    for _ in range(3):
        _anotar([_shopee("barbours", "10009")], s, sku_de=lambda p: p.item_sku, relogio=lambda: t[0])
    assert s.comandos.count(svc.SQL_PONTE) == 1          # 3 cargas, 1 consulta da ponte
    t[0] += svc.CACHE_SEGUNDOS + 1
    _anotar([_shopee("barbours", "10009")], s, sku_de=lambda p: p.item_sku, relogio=lambda: t[0])
    assert s.comandos.count(svc.SQL_PONTE) == 2          # passou 1 h: refaz


def test_planilha_nova_refaz_a_ponte_na_hora():
    s = _Sessao(PONTE)
    _anotar([_shopee("barbours", "10009")], s, sku_de=lambda p: p.item_sku)
    nova = svc.interpretar(LINHAS, AGORA.replace(hour=13))
    _anotar([_shopee("barbours", "10009")], s, obter=lambda: (nova, None), sku_de=lambda p: p.item_sku)
    assert s.comandos.count(svc.SQL_PONTE) == 2


# ---------------------------------------------------------------------------
# Rotas: o bloco chega nas duas respostas (aditivo)
# ---------------------------------------------------------------------------
def test_rotas_anotam_e_mandam_o_curva_meta(monkeypatch):
    from app.config import settings
    from app.routers import performance as rota

    monkeypatch.setattr(settings, "shopee_fbs_stock_enabled", True)
    monkeypatch.setattr(settings, "ml_full_stock_api_enabled", True)
    monkeypatch.setattr(rota, "_require_db", lambda db: db)
    shopee = SimpleNamespace(produtos=[_shopee("apice", "20690")], curva_meta=None)
    ml = SimpleNamespace(inventarios=[_ml("rituaria", "RT01002")], curva_meta=None)
    monkeypatch.setattr(rota.fbs_stock_svc, "get_estoque_full_block", lambda *a, **k: shopee)
    monkeypatch.setattr(rota.ml_stock_svc, "get_ml_full_estoque_block", lambda *a, **k: ml)
    original = svc.anotar_curva
    monkeypatch.setattr(svc, "anotar_curva",
                        lambda itens, db, **kw: original(itens, _Sessao([]), obter=lambda: (PLANILHA, None), **kw))

    r1 = rota.shopee_fbs_estoque(brands=None, accounts=None, classificacoes=None, busca=None,
                                 somente_acao=False, limite=10, ref_date=None, db=object())
    r2 = rota.ml_full_estoque(brands=None, ref_date=None, incluir_fora_do_full=False, limite=10, db=object())
    assert r1.produtos[0].curva == "AA" and r1.curva_meta.itens_com_curva == 1
    assert r2.inventarios[0].curva == "B" and r2.curva_meta.disponivel is True
