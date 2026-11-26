"""CMV do mes ate ontem pelas notas fiscais (card CMV / RECEITA da Gerencial).

Fonte: `silver.fct_gobeaute_custo_produto_diario` (Data Mart, so' leitura, UMA
consulta). Grao mes x marca x canal/plataforma x sku, recarregada todo dia com
as NFs ate D-1. `data_ultima_venda` (maior data de NF da linha) da' o "ate DD/MM".

CMV % = CMV / receita COM custo (linhas com `cmv_oficial`). Receita sem custo
nao e' custo zero: vira cobertura (receita com custo / receita). Cobertura
abaixo de 98% (`dre_service.COBERTURA_CMV_MINIMA`) = parcial. Sem linha ou sem
receita com custo: `cmv_pct` None, nunca 0.
"""
from __future__ import annotations

from datetime import date
from typing import Callable, Optional

from app.services.dre_service import COBERTURA_CMV_MINIMA

Consultar = Callable[[str, dict], list[dict]]

#: canal da Torre -> plataforma da fonte fiscal (mesmo mapa da DRE).
PLATAFORMA = {"tiktok": "tiktokshop", "ml": "mercadolivre", "shopee": "shopee"}
#: Marcas do filtro da Gerencial: as grandes e as menores (Denavita fica fora,
#: como no filtro). Chave da Torre -> marca da fonte.
MARCAS = {"apice": "apice", "barbours": "barbours", "kokeshi": "kokeshi", "lescent": "lescent",
          "rituaria": "rituaria", "yenzah": "yenzah", "aua": "aua", "by-samia": "by_samia"}
#: A base muda 1x por dia (carga da manha): 6 h de cache basta.
TTL_S = 6 * 3600.0

SQL = """
SELECT plataforma,
       SUM(quantidade_vendida * cmv_oficial) FILTER (WHERE cmv_oficial IS NOT NULL) AS cmv,
       SUM(receita) FILTER (WHERE cmv_oficial IS NOT NULL)                         AS receita_com_custo,
       SUM(receita)                                                                AS receita,
       to_char(MAX(data_ultima_venda), 'YYYY-MM-DD')                               AS ate,
       to_char(MAX(data_carga) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') AS carregado
  FROM silver.fct_gobeaute_custo_produto_diario
 WHERE data_mes = :mes AND plataforma = ANY(:plataformas) AND marca = ANY(:marcas)
 GROUP BY plataforma
"""


def _f(v) -> Optional[float]:
    return None if v is None else float(v)


def _bloco(cmv: Optional[float], rcc: Optional[float], rec: Optional[float]) -> dict:
    pct = round(cmv / rcc * 100, 2) if cmv is not None and rcc else None
    cobertura = round(rcc / rec, 4) if rcc is not None and rec else None
    return {
        "cmv": None if cmv is None else round(cmv, 2),
        "receita_com_custo": None if rcc is None else round(rcc, 2),
        "receita": None if rec is None else round(rec, 2),
        "cmv_pct": pct,
        "cobertura": cobertura,
        "parcial": pct is not None and cobertura is not None and cobertura < COBERTURA_CMV_MINIMA,
    }


def get_cmv_notas(consultar: Consultar, canais: list[str], marcas: list[str] | None, hoje: date,
                  mes: Optional[date] = None) -> dict:
    """`canais`: chaves da Torre (tiktok, ml, shopee). `marcas` vazio/None = todas do filtro."""
    mes = (mes or hoje).replace(day=1)
    chaves = [m for m in (marcas or []) if m in MARCAS] or list(MARCAS)
    params = {
        "mes": mes,
        "plataformas": [PLATAFORMA[c] for c in canais if c in PLATAFORMA],
        "marcas": [MARCAS[m] for m in chaves],
    }
    linhas = consultar(SQL, params) if params["plataformas"] else []
    por = {r["plataforma"]: r for r in linhas}
    por_canal = []
    soma = {"cmv": None, "rcc": None, "rec": None}
    for canal in canais:
        r = por.get(PLATAFORMA.get(canal, ""))
        if r is None:
            continue
        cmv, rcc, rec = _f(r.get("cmv")), _f(r.get("receita_com_custo")), _f(r.get("receita"))
        por_canal.append({"canal": canal, **_bloco(cmv, rcc, rec)})
        for k, v in (("cmv", cmv), ("rcc", rcc), ("rec", rec)):
            if v is not None:
                soma[k] = (soma[k] or 0.0) + v
    total = _bloco(soma["cmv"], soma["rcc"], soma["rec"])
    ates = [r["ate"] for r in linhas if r.get("ate")]
    cargas = [r["carregado"] for r in linhas if r.get("carregado")]
    return {
        "mes": mes.strftime("%Y-%m"),
        "ate": max(ates) if ates else None,
        "carregado_em": max(cargas) if cargas else None,
        "cobertura_minima": COBERTURA_CMV_MINIMA,
        **total,
        "por_canal": por_canal,
    }
