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

    r = get_slow_moving(consultar, hoje=date(2026, 11, 17), lookups=lambda: None)
    assert [s.sku for s in r.skus] == ["KS03042", "RT01030"]  # bysamia fora; maior R$ primeiro
    assert r.skus[0].marca == "kokeshi" and r.skus[0].estoque == 98332
    rt = r.skus[1]
    assert rt.marca == "rituaria" and rt.estoque is None and rt.cobertura_dias is None  # sem custo e sem venda
    assert r.atualizado_em == date(2026, 11, 17) and r.meta_dias == 120



def test_kit_vira_pecas_e_canal_separa_ml_shopee_tiktok():
    from app.services.slow_moving_vendas import montar_lookups, series_por_sku

    depara_csv = "Empresa,SKU unico,Status,Descricao,SKU VENDAS,SKU VENDAS 2\nBarbours,BB02084,Ativo,Kiss,10056,7901128400075\n"
    kits_csv = "Empresa,SKU KIT,Descricao,SKU UNICO 1,SKU UNICO 2\nBarbours,KIT009,Kit 2 Kiss,BB02084,BB02084\n"
    depara, kits = montar_lookups(depara_csv, kits_csv, {"kitRows": [], "inferidos": {}})
    assert depara["barbours"]["10056"] == "BB02084" and kits["barbours"]["KIT009"] == {"BB02084": 2}
    linhas = {
        "SP": [{"marca": "barbours", "sku": "10056", "envio": "F", "q": "0,0,3", "r": "0,0,90"}],
        "ML": [{"marca": "barbours", "sku": "kit-009", "envio": "N", "q": "0,1,0", "r": "0,50,0"},
               {"marca": "barbours", "sku": "SEM-DEPARA", "envio": "N", "q": "9,9,9", "r": "1,1,1"}],
        "TT": [{"marca": "barbours", "sku": "10056", "envio": "N", "q": "1,2", "r": "1,2"}],  # tamanho errado
    }
    e = series_por_sku(linhas, 3, depara, kits)[("barbours", "BB02084")]
    assert e["q"] == {"SP-F": [0, 0, 3], "ML-N": [0, 2, 0]}  # kit = 2 pecas; sem de-para e lista quebrada nao entram
    assert e["r"]["ML-N"] == [0, 50, 0]
