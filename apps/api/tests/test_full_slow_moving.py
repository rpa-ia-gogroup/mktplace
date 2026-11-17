"""Slow Moving (Full): le' a regra do Supply, so' marcas da Torre, pecas pelo R$ / custo."""
from __future__ import annotations

from datetime import date

from app.services.full_slow_moving_service import get_slow_moving


def test_marcas_da_torre_pecas_e_ordem():
    linhas = [
        {"marca": "Kokeshi", "chave": "KK-KS03042", "sku_unico": None, "descricao": "Creme Gel", "categoria": "Skin Care",
         "curva": "B", "status": "Ativo", "custo_und": 3.88, "consumo_marketplace": 548.0,
         "cobertura_marketplace": 179.4, "slow_moving_marketplace_rs": 381528.69},
        {"marca": "Rituária", "chave": "RT-RT01030", "sku_unico": "RT01030", "descricao": "Femme", "categoria": None,
         "curva": "C", "status": "Descontinuado", "custo_und": None, "consumo_marketplace": 0,
         "cobertura_marketplace": 999, "slow_moving_marketplace_rs": 1000},
        {"marca": "BySamia", "chave": "BS-1", "sku_unico": "1", "descricao": "x", "custo_und": 1,
         "consumo_marketplace": 1, "cobertura_marketplace": 200, "slow_moving_marketplace_rs": 9e9},
    ]

    def consultar(sql, params):
        if "si_rawsales" in sql:
            return []
        return [{"dia": date(2026, 11, 17)}] if "si_historical_stock" in sql else linhas

    r = get_slow_moving(consultar, hoje=date(2026, 11, 17))
    assert [s.sku for s in r.skus] == ["KS03042", "RT01030"]  # bysamia fora; maior R$ primeiro
    assert r.skus[0].marca == "kokeshi" and r.skus[0].estoque == 98332
    rt = r.skus[1]
    assert rt.marca == "rituaria" and rt.estoque is None and rt.cobertura_dias is None  # sem custo e sem venda
    assert r.atualizado_em == date(2026, 11, 17) and r.meta_dias == 120



def test_serie_do_supply_por_marca_e_canal():
    from app.services.full_slow_moving_service import _marca
    from app.services.slow_moving_vendas import series_por_sku

    linhas = [
        {"empresa": "Barbours", "sku_unico": "BB02084", "canal": "MKT", "q": "0,0,3", "r": "0,0,90.5"},
        {"empresa": "Barbours", "sku_unico": "BB02084", "canal": "TT", "q": "0,2,0", "r": "0,50,0"},
        {"empresa": "Rituária", "sku_unico": "BB02084", "canal": "MKT", "q": "0,0,7", "r": "0,0,1"},
        {"empresa": "Barbours", "sku_unico": "BB02008", "canal": "MKT", "q": "1,2", "r": "1,2"},  # tamanho errado
    ]
    s = series_por_sku(linhas, 3, _marca)
    assert s[("barbours", "BB02084")]["q"] == {"MKT": [0, 0, 3], "TT": [0, 2, 0]}
    assert s[("barbours", "BB02084")]["r"]["MKT"] == [0, 0, 90.5]
    assert s[("rituaria", "BB02084")]["q"]["MKT"] == [0, 0, 7]  # mesmo codigo em outra marca fica separado
    assert ("barbours", "BB02008") not in s
