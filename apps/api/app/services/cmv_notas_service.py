"""CMV / RECEITA da Gerencial pelas notas fiscais, no periodo do filtro, com estimativa.

FONTE (Data Mart, so' leitura, UMA consulta via `datamart_leitura`):
`gold.fct_nf_vendas_unificada` (item de NF). A consulta agrega por dia x
plataforma x marca o intervalo que cobre o periodo, o comparativo e a janela da
razao; todo o resto e' feito aqui, sem nova ida ao Data Mart (ou ao Metabase,
que em producao responde em fila: 20 a 75 s medidos em 26/11/2026; por isso o
cache de 15 min por (intervalo, marcas, canais)).

REGRA (pedido do Planejamento, 26/11/2026):
- CMV = SUM(custo); receita com custo = SUM(receita_produto) das linhas com custo.
- CMV % = CMV / receita com custo. Receita sem custo fica fora da conta e vira
  cobertura (receita com custo / receita). Cobertura < 98%
  (`dre_service.COBERTURA_CMV_MINIMA`) = parcial.
- ESTIMATIVA dos dias sem nota completa, por marca x canal x dia:
  - dia incompleto = os 2 ultimos dias e hoje (dia >= hoje - 2) OU receita das
    NFs < 70% do GMV do dia da Torre (o mesmo GMV da Gerencial);
  - no dia incompleto, CMV estimado = GMV do dia x razao, e o GMV entra no
    denominador no lugar da receita da NF;
  - razao, por marca x canal = CMV / receita com custo das NFs dos ULTIMOS 3
    DIAS FECHADOS (dias da janela hoje - 32 a hoje - 3 que a regra acima NAO
    marca como incompletos), do mais recente para tras. Motivo (Planejamento,
    26/11): o CMV % diario sobe com desconto (16-25/11: ML 26,1-28,2%, Shopee
    24,1-28,1%, TikTok 28,5-32,4%); a media de 30 dias subestimava;
  - marca x canal sem dia fechado com nota nesses 30 dias: cai para a razao dos
    30 dias inteiros; sem nada, sem razao: o GMV entra como receita sem custo
    (cai a cobertura), nunca como custo zero;
  - sem GMV na Torre (marcas menores, Bling): fica a nota, mesmo incompleta.
  Medido em 26/11 nos dias fechados: receita NF / GMV = 1,01 (TikTok), 1,00 (ML),
  0,955 (Shopee); so' 4 de 420 celulas abaixo de 70%.
- Sem dado = None, nunca 0.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Callable, Optional

from app.services.dre_service import COBERTURA_CMV_MINIMA

Consultar = Callable[[str, dict], list[dict]]

#: canal da Torre -> plataforma da fonte fiscal (mesmo mapa da DRE).
PLATAFORMA = {"tiktok": "tiktokshop", "ml": "mercadolivre", "shopee": "shopee"}
CANAL_DA_PLATAFORMA = {v: k for k, v in PLATAFORMA.items()}
MKT_ID = {"tiktok": 1, "ml": 2, "shopee": 3}
#: Marcas do filtro da Gerencial (grandes e menores; a Denavita fica fora, como no filtro).
MARCAS = {"apice": "apice", "barbours": "barbours", "kokeshi": "kokeshi", "lescent": "lescent",
          "rituaria": "rituaria", "yenzah": "yenzah", "aua": "aua", "by-samia": "by_samia"}
TTL_S = 15 * 60.0
#: Metabase em fila: a consulta passa dos 60 s padrao do cliente (medido de 20 a 183 s em 26/11).
TIMEOUT_METABASE_S = 240.0
LIMIAR_NF_GMV = 0.70
DIAS_RECENTES = 2      # os 2 ultimos dias (alem de hoje) sempre estimados
JANELA_RAZAO = 30     # onde se procuram os dias fechados (e a reserva)
DIAS_RAZAO = 3        # dias fechados que formam a razao

SQL_NF = """
SELECT data_emissao::text AS dia, plataforma, marca,
       SUM(custo)                                          AS cmv,
       SUM(receita_produto) FILTER (WHERE custo IS NOT NULL) AS receita_com_custo,
       SUM(receita_produto)                                AS receita
  FROM gold.fct_nf_vendas_unificada
 WHERE data_emissao BETWEEN :de AND :ate
   AND plataforma = ANY(:plataformas) AND marca = ANY(:marcas)
   AND NOT coalesce(intercompany, false)
 GROUP BY 1, 2, 3
"""


def _f(v) -> float:
    return 0.0 if v is None else float(v)


def janela_razao(hoje: date) -> tuple[date, date]:
    fim = hoje - timedelta(days=DIAS_RECENTES + 1)
    return fim - timedelta(days=JANELA_RAZAO - 1), fim


def intervalo_leitura(periodos: list[tuple[date, date]], hoje: date) -> tuple[date, date]:
    """O intervalo unico da consulta: periodo, comparativo e a janela da razao."""
    r0, r1 = janela_razao(hoje)
    return min([r0] + [p[0] for p in periodos]), max([r1] + [min(p[1], hoje) for p in periodos])


def indexar_nf(linhas: list[dict]) -> dict:
    """(dia, canal, marca) -> [cmv, receita_com_custo, receita]."""
    out: dict = {}
    for r in linhas:
        canal = CANAL_DA_PLATAFORMA.get(r.get("plataforma"))
        if canal is None:
            continue
        out[(str(r["dia"])[:10], canal, r["marca"])] = [_f(r.get("cmv")), _f(r.get("receita_com_custo")), _f(r.get("receita"))]
    return out


def incompleto(dia: str, n: Optional[list], g: float, hoje: date) -> bool:
    """Dia incompleto da celula marca x canal: os 2 ultimos dias e hoje, ou NF < 70% do GMV."""
    return dia >= (hoje - timedelta(days=DIAS_RECENTES)).isoformat() or n is None or n[2] < LIMIAR_NF_GMV * g


def razoes(nf: dict, gmv: dict, hoje: date) -> dict:
    """(canal, marca) -> CMV / receita com custo dos ultimos 3 dias fechados; sem eles, dos 30 dias.
    Sem receita com custo em nenhum dos dois: fora (a celula fica sem razao)."""
    r0, r1 = (d.isoformat() for d in janela_razao(hoje))
    por_celula: dict = defaultdict(list)   # (canal, marca) -> [(dia, cmv, rcc, completo)]
    for (dia, canal, marca), n in nf.items():
        if r0 <= dia <= r1:
            g = gmv.get((dia, canal, marca)) or 0.0
            por_celula[(canal, marca)].append((dia, n[0], n[1], not incompleto(dia, n, g, hoje)))
    out = {}
    for k, dias in por_celula.items():
        dias.sort(reverse=True)
        fechados = [d for d in dias if d[3] and d[2] > 0][:DIAS_RAZAO]
        base = fechados or dias
        cmv, rcc = sum(d[1] for d in base), sum(d[2] for d in base)
        if rcc > 0:
            out[k] = cmv / rcc
    return out


def _bloco(cmv: float, rcc: float, rec: float, est: float) -> dict:
    pct = round(cmv / rcc * 100, 2) if rcc > 0 else None
    cobertura = round(rcc / rec, 4) if rec > 0 else None
    return {
        "cmv": round(cmv, 2) if rcc > 0 else None,
        "receita_com_custo": round(rcc, 2) if rec > 0 else None,
        "receita": round(rec, 2) if rec > 0 else None,
        "cmv_pct": pct,
        "cobertura": cobertura,
        "parcial": pct is not None and cobertura is not None and cobertura < COBERTURA_CMV_MINIMA,
        #: parte do denominador (receita) que veio de GMV estimado (0..1).
        "estimado_pct": round(est / rec, 4) if rec > 0 and est > 0 else None,
    }


def calcular(nf: dict, gmv: dict, razao: dict, de: date, ate: date, hoje: date, canais: list[str]) -> dict:
    """Bloco total + por canal de um periodo. `gmv`: (dia, canal, marca) -> GMV da Torre."""
    por: dict = {c: [0.0, 0.0, 0.0, 0.0] for c in canais}  # cmv, rcc, receita, estimado
    dias_estimados: set[str] = set()
    d = de
    fim = min(ate, hoje)
    while d <= fim:
        dia = d.isoformat()
        for canal in canais:
            marcas = {m for (x, c, m) in nf if x == dia and c == canal} | {m for (x, c, m) in gmv if x == dia and c == canal}
            for marca in marcas:
                n = nf.get((dia, canal, marca))
                g = gmv.get((dia, canal, marca)) or 0.0
                acc = por[canal]
                if incompleto(dia, n, g, hoje) and g > 0:
                    r = razao.get((canal, marca))
                    if r is not None:
                        acc[0] += g * r
                        acc[1] += g
                    acc[2] += g
                    acc[3] += g
                    dias_estimados.add(dia)
                elif n is not None:
                    acc[0] += n[0]
                    acc[1] += n[1]
                    acc[2] += n[2]
        d += timedelta(days=1)
    total = [sum(v[i] for v in por.values()) for i in range(4)]
    return {
        **_bloco(*total),
        "dias_estimados": sorted(dias_estimados),
        "por_canal": [{"canal": c, **_bloco(*por[c])} for c in canais if por[c][2] > 0],
    }


def ultima_nf(nf: dict) -> Optional[str]:
    return max((k[0] for k, v in nf.items() if v[2] > 0), default=None)


def get_cmv_notas(consultar: Consultar, ler_gmv: Callable[[date, date], dict], canais: list[str],
                  marcas: list[str] | None, de: date, ate: date, hoje: date,
                  comp: Optional[tuple[date, date]] = None) -> dict:
    """`canais`: chaves da Torre. `marcas` vazio = todas do filtro. `ler_gmv(de, ate)`:
    (dia, canal, marca) -> GMV da Torre (o mesmo da Gerencial). `comp`: periodo anterior."""
    chaves = [m for m in (marcas or []) if m in MARCAS] or list(MARCAS)
    canais = [c for c in canais if c in PLATAFORMA]
    periodos = [(de, ate)] + ([comp] if comp else [])
    i0, i1 = intervalo_leitura(periodos, hoje)
    params = {"de": i0, "ate": i1, "plataformas": [PLATAFORMA[c] for c in canais], "marcas": [MARCAS[m] for m in chaves]}
    nf = indexar_nf(consultar(SQL_NF, params)) if canais else {}
    # GMV sem cache (a estimativa de hoje acompanha a Torre); cobre a janela da razao tambem.
    gmv = ler_gmv(i0, min(i1, hoje)) if canais else {}
    razao = razoes(nf, gmv, hoje)
    atual = calcular(nf, gmv, razao, de, ate, hoje, canais)
    anterior = calcular(nf, gmv, razao, comp[0], comp[1], hoje, canais) if comp else None
    return {
        "date_from": de.isoformat(),
        "date_to": ate.isoformat(),
        "ultima_nf": ultima_nf(nf),
        "cobertura_minima": COBERTURA_CMV_MINIMA,
        **atual,
        "anterior_cmv_pct": anterior["cmv_pct"] if anterior else None,
        "compare_date_from": comp[0].isoformat() if comp else None,
        "compare_date_to": comp[1].isoformat() if comp else None,
    }
