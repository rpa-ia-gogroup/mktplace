"""`daily_shopee_ads` — Investimento em Ads da Shopee (familia de Ads) na fato diaria, pela API.

ADS-SHOPEE-API-1. O relatorio exportado por marca parou de chegar (apice, barbours, lescent e
rituaria so' ate' 12/10; kokeshi ate' 11/11) e o Investimento em Ads ficou NULL. A fonte passa a
ser `raw.shopee_ads_daily` (Data Mart, migration 68 do airflow): o gasto TOTAL da loja por dia,
`ads/get_all_cpc_ads_daily_performance`, gravado pela DAG `shopee_ads_items_daily`.

POR QUE NAO `raw.shopee_ads_items`
---------------------------------
A tabela por item (migration 66) so' guarda campanhas de 1 item: as de 0 ou 2+ itens (loja,
GMV Max, multi-item) nao sao rateadas e ficam de fora. Em out/2026 a Kokeshi deu R$ 189 mil
por item contra R$ 223 mil no relatorio. O total da loja inclui todas as campanhas CPC.

O QUE PUBLICA, por (dia da loja BRT, loja com API)
--------------------------------------------------
  ad_spend        cost (expense)            ad_revenue  broad_amount (broad_gmv)
  ad_impressions  impressions               ad_clicks   clicks
  roas = receita / gasto     acos_pct = gasto / receita x 100
  ctr_pct = cliques / impressoes x 100      cpc = gasto / cliques   (NULL com divisor 0)
Mesmas formulas do relatorio (`_parser_ads`). So' as colunas de Ads; nada mais da linha muda.

DONO DE COLUNA
--------------
Nas lojas com API este modulo e' o dono da familia de Ads. O carregador do relatorio
(`daily_performance --source shopee-ads`) vira reserva: so' preenche onde a fato estiver vazia
(`PATCH_ADS_RESERVA_SQL`). Dia sem linha na API nao e' tocado aqui: fica o que havia (o
relatorio, se houver) ou NULL. Ausencia nunca vira 0.

TRAVAS
------
* `fato_diaria_lock(3)`, o mesmo dos carregadores da Shopee;
* so' grava linha cujo conteudo mudou (idempotente) e reconcilia antes do commit;
* mes em que a API fica abaixo do que estava publicado sai em `avisos` (nunca cai calado);
* `--apply` so' escreve com `SHOPEE_ADS_API_ENABLED=true`; sem ela, dry-run declarado.

USO
---
    python -m pipelines.sync_shopee_ads_api                       # dry-run + comparacao por mes
    python -m pipelines.sync_shopee_ads_api --desde 2026-10-01    # dry-run do backfill
    SHOPEE_ADS_API_ENABLED=true python -m pipelines.sync_shopee_ads_api --apply --desde 2026-10-01

Saida: 0 ok (inclui dry-run); 1 contrato/falha, nada escrito; 75 lock da fato Shopee ocupado.
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text

from pipelines import sync_shopee_daily_api_shadow as SH
from pipelines.common.db import datamart_session, local_engine
from pipelines.common.logging import get_logger
from pipelines.ingestion.daily_performance import COLUNAS_ADS, PATCH_ADS_SQL
from pipelines.ingestion.fato_diaria_lock import (
    EXIT_CODE_LOCK_UNAVAILABLE,
    FatoDiariaLockUnavailable,
    fato_diaria_lock,
)
from pipelines.transforms.shopee_orders_daily import (
    BRAND_TO_LOJA,
    CONTAS_COM_API,
    EMPRESA_ID,
    LOJAS_COM_API,
    MARKETPLACE_ID,
)

logger = get_logger(__name__)

FATO = "marts.fact_marketplace_daily_performance"
FONTE = "raw.shopee_ads_daily"
DIAS_JANELA = 60
FLAG_HABILITADO = "SHOPEE_ADS_API_ENABLED"
#: queda maior que isto contra o publicado, no mes, vira aviso
TOLERANCIA_QUEDA = 0.02


class ShopeeAdsApiError(RuntimeError):
    """Falha de contrato ou de publicacao. Nada foi escrito."""


SQL_FONTE = f"""
    SELECT brand, ref_date, cost, broad_amount, clicks, impressions, extracted_at
      FROM {FONTE}
     WHERE brand = ANY(:marcas) AND ref_date BETWEEN :inicio AND :fim
     ORDER BY brand, ref_date
"""


def _div(a, b, fator=1, casas=4):
    return round(float(a) / float(b) * fator, casas) if b and float(b) > 0 else None


def linha_da_fato(r: dict) -> dict:
    gasto, receita = Decimal(r["cost"]), Decimal(r["broad_amount"])
    cliques, impressoes = int(r["clicks"]), int(r["impressions"])
    return {
        "date": r["ref_date"], "loja_id": BRAND_TO_LOJA[r["brand"]],
        "ad_spend": round(float(gasto), 2), "ad_revenue": round(float(receita), 2),
        "ad_impressions": impressoes, "ad_clicks": cliques,
        "roas": _div(receita, gasto), "acos_pct": _div(gasto, receita, 100),
        "ctr_pct": _div(cliques, impressoes, 100), "cpc": _div(gasto, cliques),
    }


def _norm(v):
    return None if v is None else round(float(v), 4)


def conteudo(linha: dict) -> tuple:
    return tuple(_norm(linha.get(c)) for c in COLUNAS_ADS)


def coletar_fonte(inicio: date, fim: date) -> list[dict]:
    """Data Mart, READ ONLY. Ponto de injecao dos testes."""
    with datamart_session() as dm:
        dm.connection().execute(text("SET TRANSACTION READ ONLY"))
        if not dm.execute(text(f"SELECT to_regclass('{FONTE}') IS NOT NULL")).scalar():
            raise ShopeeAdsApiError(f"{FONTE} ausente no Data Mart (migration 68 do airflow)")
        return [dict(r) for r in dm.execute(text(SQL_FONTE), {
            "marcas": sorted(CONTAS_COM_API), "inicio": inicio, "fim": fim}).mappings()]


def publicado(conn, inicio: date, fim: date) -> dict:
    """(date, loja_id) -> colunas de Ads publicadas, so' das lojas com API, na janela."""
    linhas = conn.execute(text(f"""
        SELECT date, loja_id, {', '.join(COLUNAS_ADS)} FROM {FATO}
         WHERE marketplace_id = :mkt AND loja_id = ANY(:lojas) AND date BETWEEN :inicio AND :fim
    """), {"mkt": MARKETPLACE_ID, "lojas": sorted(LOJAS_COM_API), "inicio": inicio, "fim": fim}).mappings()
    return {(r["date"], r["loja_id"]): dict(r) for r in linhas}


def a_gravar(antes: dict, linhas: list[dict]) -> list[dict]:
    return [r for r in linhas if (r["date"], r["loja_id"]) not in antes
            or conteudo(antes[(r["date"], r["loja_id"])]) != conteudo(r)]


def comparar_por_mes(antes: dict, linhas: list[dict]) -> list[dict]:
    """Por (loja, mes): gasto publicado x API, e quantos dias cada um tem."""
    acc: dict = defaultdict(lambda: {"publicado": 0.0, "dias_publicado": 0, "api": 0.0, "dias_api": 0})
    for (d, loja), r in antes.items():
        if r.get("ad_spend") is not None:
            a = acc[(loja, d.strftime("%Y-%m"))]
            a["publicado"] += float(r["ad_spend"])
            a["dias_publicado"] += 1
    for r in linhas:
        a = acc[(r["loja_id"], r["date"].strftime("%Y-%m"))]
        a["api"] += r["ad_spend"]
        a["dias_api"] += 1
    return [{"loja_id": loja, "mes": mes, **{k: round(v, 2) if isinstance(v, float) else v for k, v in a.items()}}
            for (loja, mes), a in sorted(acc.items())]


def avisos_de_queda(comparacao: list[dict]) -> list[str]:
    """Mes em que a API fica abaixo do publicado (com dado nos dois): nunca cai calado."""
    return [f"loja {c['loja_id']} {c['mes']}: API R$ {c['api']:,.2f} abaixo do publicado R$ {c['publicado']:,.2f}"
            for c in comparacao
            if c["dias_publicado"] and c["dias_api"] and c["api"] < c["publicado"] * (1 - TOLERANCIA_QUEDA)]


def publicar_em_transacao(conn, linhas: list[dict], inicio: date, fim: date) -> dict:
    antes = publicado(conn, inicio, fim)
    mudou = a_gravar(antes, linhas)
    if mudou:
        conn.execute(PATCH_ADS_SQL, [{**r, "marketplace_id": MARKETPLACE_ID, "empresa_id": EMPRESA_ID} for r in mudou])
    depois = publicado(conn, inicio, fim)
    divergentes = [(r["date"], r["loja_id"]) for r in linhas
                   if (r["date"], r["loja_id"]) not in depois or conteudo(depois[(r["date"], r["loja_id"])]) != conteudo(r)]
    if divergentes:
        raise ShopeeAdsApiError(f"reconciliacao pre-commit falhou em {len(divergentes)} linha(s), ex.: {divergentes[:3]}")
    return {"linhas_gravadas": len(mudou), "linhas_identicas": len(linhas) - len(mudou)}


#: Conexao do advisory lock. `None` = a conexao padrao de `fato_diaria_lock`.
_lock_connect = None


def _montar(inicio: date, fim: date) -> tuple[list[dict], list[str]]:
    fonte = coletar_fonte(inicio, fim)
    linhas = [linha_da_fato(r) for r in fonte]
    if {r["loja_id"] for r in linhas} - LOJAS_COM_API:
        raise ShopeeAdsApiError("linha de loja sem API montada")
    sem_dado = sorted(set(CONTAS_COM_API) - {r["brand"] for r in fonte})
    return linhas, [f"{m}: sem nenhum dia na API na janela (fica o que havia)" for m in sem_dado]


def run(apply: bool = False, desde: date | None = None, agora: datetime | None = None,
        ambiente: dict | None = None) -> dict:
    agora_utc = (agora or datetime.now(timezone.utc)).astimezone(timezone.utc)
    hoje = SH.hoje_brt(agora_utc)
    fim = hoje - timedelta(days=1)          # a API de Ads entrega dia fechado
    inicio = desde or fim - timedelta(days=DIAS_JANELA - 1)
    if inicio > fim:
        raise ShopeeAdsApiError("--desde depois de D-1")
    habilitado = (ambiente if ambiente is not None else os.environ).get(FLAG_HABILITADO) == "true"
    resumo = {"janela": [str(inicio), str(fim)], "lojas": sorted(LOJAS_COM_API), "aplicado": False}

    if not (apply and habilitado):
        linhas, avisos = _montar(inicio, fim)
        with local_engine().connect() as conn:
            antes = publicado(conn, inicio, fim)
        comp = comparar_por_mes(antes, linhas)
        resumo.update({"modo": "dry-run" if not apply else f"dry-run ({FLAG_HABILITADO} != 'true')",
                       "linhas_da_fonte": len(linhas), "linhas_que_mudariam": len(a_gravar(antes, linhas)),
                       "publicado_x_api_por_mes": comp, "avisos": avisos + avisos_de_queda(comp)})
        return resumo

    with fato_diaria_lock(MARKETPLACE_ID, connect=_lock_connect):
        linhas, avisos = _montar(inicio, fim)
        with local_engine().begin() as conn:
            comp = comparar_por_mes(publicado(conn, inicio, fim), linhas)
            pub = publicar_em_transacao(conn, linhas, inicio, fim)
    resumo.update(pub)
    resumo.update({"modo": "apply", "aplicado": pub["linhas_gravadas"] > 0, "linhas_da_fonte": len(linhas),
                   "publicado_x_api_por_mes": comp, "avisos": avisos + avisos_de_queda(comp)})
    for a in resumo["avisos"]:
        logger.warning("%s", a)
    return resumo


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="daily_shopee_ads: Investimento em Ads da Shopee (API) na fato diaria")
    p.add_argument("--apply", action="store_true", help=f"publica (exige {FLAG_HABILITADO}=true)")
    p.add_argument("--desde", type=date.fromisoformat, default=None,
                   help=f"inicio da janela (YYYY-MM-DD). Default: {DIAS_JANELA} dias ate' D-1")
    args = p.parse_args(argv)
    try:
        res = run(apply=args.apply, desde=args.desde)
    except FatoDiariaLockUnavailable as exc:
        logger.error("%s", exc)
        return EXIT_CODE_LOCK_UNAVAILABLE
    except ShopeeAdsApiError as exc:
        logger.error("%s", SH.sanitizar(exc))
        return 1
    print(json.dumps(res, default=str, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
