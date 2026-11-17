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
        return [{"dia": date(2026, 11, 17)}] if "si_historical_stock" in sql else linhas

    r = get_slow_moving(consultar)
    assert [s.sku for s in r.skus] == ["KS03042", "RT01030"]  # bysamia fora; maior R$ primeiro
    assert r.skus[0].marca == "kokeshi" and r.skus[0].estoque == 98332
    rt = r.skus[1]
    assert rt.marca == "rituaria" and rt.estoque is None and rt.cobertura_dias is None  # sem custo e sem venda
    assert r.atualizado_em == date(2026, 11, 17) and r.meta_dias == 120
