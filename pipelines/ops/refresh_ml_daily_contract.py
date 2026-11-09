"""Reparo UNICO do GMV Mercado Livre congelado em D+4 (T-0077).

O DEFEITO (T-0075, 09/11/2026)
------------------------------
O `daily_ml` regrava so' D-4..D-1. Um pedido pago em D e cancelado (ou com
reembolso parcial) depois de D+4 continua no GMV da Torre para sempre. Medido:
+0,63% (ago), +2,77% (set) e +1,28% (out/26). O reprocesso semanal
(`ml_weekly_reprocess`, orchestrate) impede o defeito daqui para a frente; este
modulo regrava UMA vez o passado: de 01/07/2026 ate hoje-5 (D-4..D-1 ja sao do
incremental diario).

POR QUE NAO E' UMA COPIA DO `refresh_tiktok_daily_contract`
-----------------------------------------------------------
O refresh do TikTok APAGA a janela e reinsere (chave orfa de troca de contrato).
Aqui nao ha troca de contrato: e' maturacao de status, e o UPSERT basta.
`gold.ml_gestao_diaria` e' agregado dia x marca que conta TODOS os status
(`cancelled_orders`, `cancel_rate_pct`); o filtro `paid` vive no `gmv`, nao na
existencia da linha. Um (dia, marca) cujos pedidos foram todos cancelados
continua com linha (gmv=0) e o UPSERT a sobrescreve. O dry-run MEDE a premissa:
`chaves_so_no_destino` conta as chaves que a fonte nao devolve mais e que o
UPSERT nao tocaria.

Do TikTok vem o padrao de operacao: dry-run por padrao, `--apply` explicito,
impacto por mes x marca (antes x depois) e janela fechada (nunca D0).

A ESCRITA E' A DO PIPELINE DIARIO
---------------------------------
`--apply` chama `daily_performance.run(source="ml", mode="backfill",
date_from, date_to)` janela a janela: mesmo `fato_diaria_lock`,
`audit.source_sync_run`, checks de qualidade, segunda defesa de dia fechado,
barreira de janela (`WindowViolation`) e guardrail de comissao (MARGEM-REAL-2B),
que falha fechado ANTES de escrever. UPSERT por (date, loja_id,
marketplace_id), sem DELETE: nada fora da janela e' tocado.

Janelas de no maximo 31 dias, cortadas no mes: cada janela e' um mes (ou parte
dele), o que limita o custo da leitura da VIEW e faz o resumo por mes casar com
as janelas. Cada janela e' uma transacao propria: se uma falha, as anteriores
ficam gravadas, a execucao para, e rodar de novo e' idempotente.

SEGURANCA
---------
Dry-run le a fonte (Data Mart) e o destino em transacao `READ ONLY`; nao chama
`daily_performance.run`, nao abre lock e nao escreve. `marketplace_id` fixo em
2. Sem retry, sleep ou agendamento. Nada e' executado no import.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import text

from pipelines.common import db as _common_db
from pipelines.common.operational_calendar import last_closed_date, operational_today
from pipelines.connectors.mercadolivre import connector as ml_connector
from pipelines.ingestion import daily_performance
from pipelines.quality import ml_fee_reconciliation
from pipelines.sync_tiktok_serving import sanitize_error_message
from pipelines.transforms import ml_gestao_diaria as ml_transform

# ---------------------------------------------------------------------------
# Especificacao
# ---------------------------------------------------------------------------

TARGET_TABLE = "marts.fact_marketplace_daily_performance"

#: Mercado Livre. Fixo: o reparo nunca le nem compara outro marketplace.
ML_MARKETPLACE_ID = ml_transform.MARKETPLACE_ID

#: Inicio do reparo (T-0075: jun ja batia; jul-out congelados).
DEFAULT_DATE_FROM = date(2026, 7, 1)

#: Fim padrao = hoje - 5. D-4..D-1 sao regravados pelo `daily_ml` incremental.
DEFAULT_LAG_DIAS = 5

#: Teto de cada janela. Alem disso, as janelas sao cortadas na virada do mes.
MAX_JANELA_DIAS = 31

#: Colunas lidas do destino para comparar. Nunca `SELECT *`.
COLUNAS_DESTINO = ("date", "loja_id", "marketplace_id", "gmv", "orders", "canceled_orders")

RESUMO_TOTAL = "TOTAL"

LOJA_TO_BRAND = {v: k for k, v in ml_transform.BRAND_TO_LOJA.items()}


class RefreshError(RuntimeError):
    """Erro de contrato desta operacao."""


# ---------------------------------------------------------------------------
# Janela
# ---------------------------------------------------------------------------

def resolve_window(date_from: date | None, date_to: date | None,
                   agora: datetime | None = None) -> tuple[date, date]:
    """Janela INCLUSIVA. Default 01/07/2026 .. hoje-5; teto D-1 (dia fechado)."""
    hoje = operational_today(agora)
    teto = last_closed_date(agora)
    inicio = DEFAULT_DATE_FROM if date_from is None else date_from
    fim = hoje - timedelta(days=DEFAULT_LAG_DIAS) if date_to is None else date_to
    if fim > teto:
        raise RefreshError(
            f"date_to={fim.isoformat()} e posterior a D-1 ({teto.isoformat()}) em "
            "America/Sao_Paulo: o dia corrente esta aberto."
        )
    if inicio > fim:
        raise RefreshError(
            f"janela vazia: date_from={inicio.isoformat()} > date_to={fim.isoformat()}."
        )
    return inicio, fim


def janelas(inicio: date, fim: date, max_dias: int = MAX_JANELA_DIAS) -> list[tuple[date, date]]:
    """Fatias consecutivas, sem buraco nem sobreposicao, cobrindo `inicio..fim`.

    Cada fatia termina no fim do mes ou em `max_dias` dias, o que vier antes.
    """
    if max_dias < 1:
        raise RefreshError(f"max_dias precisa ser >= 1: {max_dias}.")
    saida = []
    cur = inicio
    while cur <= fim:
        prox_mes = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        ate = min(fim, prox_mes - timedelta(days=1), cur + timedelta(days=max_dias - 1))
        saida.append((cur, ate))
        cur = ate + timedelta(days=1)
    return saida


# ---------------------------------------------------------------------------
# Leituras (somente leitura)
# ---------------------------------------------------------------------------

def ler_fonte(date_from: date, date_to: date) -> dict:
    """Le a fonte pela consulta do PROPRIO conector e roda o guardrail de
    comissao sem levantar: o dry-run informa se o `--apply` dessa janela
    passaria pela barreira."""
    raw = ml_connector.fetch(date_from, date_to)
    canon = ml_transform.transform_batch(raw)
    try:
        ml_fee_reconciliation.reconciliar(
            raw, brands_esperadas=ml_connector.BRANDS_IN_SCOPE,
            date_from=date_from, date_to=date_to,
        )
        guardrail = "ok"
    except ml_fee_reconciliation.MlFeeReconciliationError as exc:
        guardrail = f"REPROVARIA: {sanitize_error_message(exc)}"
    return {"linhas": canon, "guardrail_comissao": guardrail}


def ler_destino(date_from: date, date_to: date) -> list[dict]:
    """Le a janela do destino em transacao READ ONLY, colunas explicitas."""
    engine = _common_db.local_engine()
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        rows = conn.execute(
            text(f"SELECT {', '.join(COLUNAS_DESTINO)} FROM {TARGET_TABLE} "
                 "WHERE marketplace_id = :mkt AND date BETWEEN :df AND :dt "
                 "ORDER BY date, loja_id"),
            {"mkt": ML_MARKETPLACE_ID, "df": date_from, "dt": date_to},
        ).mappings().all()
        conn.rollback()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Impacto (puro)
# ---------------------------------------------------------------------------

def _mes(d: date) -> str:
    return d.strftime("%Y-%m")


def _chave(r: dict) -> tuple:
    return (r["date"], r["loja_id"])


def _soma_decimal(rows: list[dict], col: str):
    """Soma so' dos presentes; todos ausentes => None (nunca zero)."""
    presentes = [Decimal(str(r[col])) for r in rows if r.get(col) is not None]
    return sum(presentes, Decimal("0")) if presentes else None


def resumo_mes_marca(antes: list[dict], depois: list[dict]) -> list[dict]:
    """GMV e pedidos ANTES x DEPOIS por mes x marca, com linha TOTAL por mes.

    `delta` = depois - antes: o excesso da Torre medido na T-0075 aparece como
    delta NEGATIVO. `None` continua `None`; o delta so' existe com os dois lados.
    """
    def marca(r):
        return LOJA_TO_BRAND.get(r["loja_id"], str(r["loja_id"]))

    grupos: dict[tuple[str, str], dict[str, list[dict]]] = {}
    for lado, rows in (("antes", antes), ("depois", depois)):
        for r in rows:
            for m in (marca(r), RESUMO_TOTAL):
                grupos.setdefault((_mes(r["date"]), m), {"antes": [], "depois": []})[lado].append(r)

    saida = []
    for mes, m in sorted(grupos, key=lambda k: (k[0], k[1] == RESUMO_TOTAL, k[1])):
        g = grupos[(mes, m)]
        gmv_a, gmv_d = _soma_decimal(g["antes"], "gmv"), _soma_decimal(g["depois"], "gmv")
        delta = None if gmv_a is None or gmv_d is None else gmv_d - gmv_a
        pct = (None if delta is None or not gmv_a
               else (delta / gmv_a * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        saida.append({
            "mes": mes, "marca": m,
            "gmv_antes": None if gmv_a is None else str(gmv_a),
            "gmv_depois": None if gmv_d is None else str(gmv_d),
            "delta_gmv": None if delta is None else str(delta),
            "delta_gmv_pct": None if pct is None else str(pct),
            "orders_antes": sum(int(r.get("orders") or 0) for r in g["antes"]),
            "orders_depois": sum(int(r.get("orders") or 0) for r in g["depois"]),
            "linhas_antes": len(g["antes"]),
            "linhas_depois": len(g["depois"]),
        })
    return saida


def compute_impact(atual: list[dict], novo: list[dict]) -> dict:
    """O que o UPSERT mudaria. Puro. `chaves_so_no_destino` sao as que o UPSERT
    NAO toca (a premissa do reparo e' que sejam zero)."""
    a = {_chave(r): r for r in atual}
    n = {_chave(r): r for r in novo}

    def gmv(r):
        return None if r.get("gmv") is None else Decimal(str(r["gmv"]))

    alteradas = sorted(k for k in set(a) & set(n)
                       if (gmv(a[k]), int(a[k].get("orders") or 0))
                       != (gmv(n[k]), int(n[k].get("orders") or 0)))
    so_destino = sorted(set(a) - set(n))
    return {
        "linhas_destino": len(atual),
        "linhas_fonte": len(novo),
        "chaves_novas": len(set(n) - set(a)),
        "chaves_com_gmv_ou_pedidos_alterados": len(alteradas),
        "chaves_so_no_destino": len(so_destino),
        "amostra_so_no_destino": [
            {"date": k[0].isoformat(), "loja_id": k[1]} for k in so_destino[:10]
        ],
        "por_mes_marca": resumo_mes_marca(atual, novo),
    }


def formatar_resumo_mes_marca(resumo: list[dict], gravado: bool) -> list[str]:
    def v(x):
        return "-" if x is None else str(x)

    cab = (f"{'mes':7s}  {'marca':9s}  {'gmv_antes':>15s}  {'gmv_depois':>15s}  "
           f"{'delta_gmv':>13s}  {'delta_%':>8s}  {'pedidos_antes':>13s}  "
           f"{'pedidos_depois':>14s}  {'linhas_a/d':>10s}")
    titulo = ("RESUMO MES x MARCA (antes = destino antes; depois = destino depois do apply)"
              if gravado else
              "RESUMO MES x MARCA (antes = destino hoje; depois = fonte; NADA foi gravado)")
    linhas = [titulo,
              "delta = depois - antes; excesso da Torre aparece como delta negativo",
              cab, "-" * len(cab)]
    for r in resumo:
        linhas.append(
            f"{r['mes']:7s}  {r['marca']:9s}  {v(r['gmv_antes']):>15s}  "
            f"{v(r['gmv_depois']):>15s}  {v(r['delta_gmv']):>13s}  "
            f"{v(r['delta_gmv_pct']):>8s}  {r['orders_antes']:>13d}  "
            f"{r['orders_depois']:>14d}  "
            f"{str(r['linhas_antes']) + '/' + str(r['linhas_depois']):>10s}"
        )
    return linhas


# ---------------------------------------------------------------------------
# Orquestracao
# ---------------------------------------------------------------------------

def run_refresh(date_from: date | None, date_to: date | None, apply: bool,
                agora: datetime | None = None) -> dict:
    """Sem `apply`: le fonte e destino por janela e reporta o impacto, sem
    escrever. Com `apply`: regrava janela a janela pelo pipeline diario e
    reporta destino antes x depois. Para na primeira janela que nao der certo."""
    inicio, fim = resolve_window(date_from, date_to, agora)
    fatias = janelas(inicio, fim)
    rel: dict = {
        "modo": "apply" if apply else "dry-run",
        "marketplace_id": ML_MARKETPLACE_ID,
        "date_from": inicio.isoformat(), "date_to": fim.isoformat(),
        "janelas": [(a.isoformat(), b.isoformat()) for a, b in fatias],
    }

    if not apply:
        atual: list[dict] = []
        novo: list[dict] = []
        guardrails = {}
        for a, b in fatias:
            atual += ler_destino(a, b)
            fonte = ler_fonte(a, b)
            novo += fonte["linhas"]
            guardrails[f"{a.isoformat()}..{b.isoformat()}"] = fonte["guardrail_comissao"]
        rel["guardrail_comissao"] = guardrails
        rel["impacto"] = compute_impact(atual, novo)
        rel["resultado"] = "dry-run; nada escrito"
        return rel

    antes = ler_destino(inicio, fim)
    aplicadas = []
    falha = None
    for a, b in fatias:
        r = daily_performance.run(source="ml", mode="backfill",
                                  date_from=a.isoformat(), date_to=b.isoformat())
        aplicadas.append({"janela": f"{a.isoformat()}..{b.isoformat()}",
                          "status": (r or {}).get("status"),
                          "linhas": (r or {}).get("rows_loaded")})
        if not r or r.get("status") != "success":
            falha = f"janela {a.isoformat()}..{b.isoformat()} nao terminou em success"
            break
    depois = ler_destino(inicio, fim)
    rel["aplicadas"] = aplicadas
    rel["impacto"] = {"por_mes_marca": resumo_mes_marca(antes, depois)}
    if falha:
        rel["resultado"] = f"INTERROMPIDO: {falha}; janelas anteriores ficaram gravadas"
        raise _ApplyInterrompido(rel)
    rel["resultado"] = "aplicado"
    return rel


class _ApplyInterrompido(RefreshError):
    def __init__(self, relatorio: dict):
        super().__init__(relatorio["resultado"])
        self.relatorio = relatorio


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="refresh_ml_daily_contract",
        description=(
            "Reparo unico do GMV Mercado Livre congelado em D+4 (T-0077). SEM "
            "--apply le fonte e destino e mostra o impacto por mes x marca, sem "
            "escrever. COM --apply regrava pelo pipeline diario (UPSERT), em "
            f"janelas de ate {MAX_JANELA_DIAS} dias cortadas no mes."
        ),
    )
    p.add_argument("--date-from", help=f"inicio inclusivo (YYYY-MM-DD); default "
                                       f"{DEFAULT_DATE_FROM.isoformat()}")
    p.add_argument("--date-to", help=f"fim inclusivo (YYYY-MM-DD); default hoje-{DEFAULT_LAG_DIAS}")
    p.add_argument("--apply", action="store_true",
                   help="EFETIVA a escrita. Sem esta flag, tudo e somente leitura.")
    return p


def _parse_date(valor: str | None) -> date | None:
    if valor is None:
        return None
    try:
        return date.fromisoformat(valor)
    except ValueError as exc:
        raise RefreshError(f"data invalida: {valor!r} (esperado YYYY-MM-DD)") from exc


def _imprimir(rel: dict, gravado: bool) -> None:
    for k, v in rel.items():
        if k != "impacto":
            print(f"{k:20s}: {v}")
    impacto = rel.get("impacto") or {}
    for k, v in impacto.items():
        if k != "por_mes_marca":
            print(f"{k:36s}: {v}")
    if "por_mes_marca" in impacto:
        print()
        for linha in formatar_resumo_mes_marca(impacto["por_mes_marca"], gravado):
            print(linha)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.apply:
        print("MODO DRY-RUN (sem --apply): le fonte e destino, nao escreve nada.")
    try:
        rel = run_refresh(_parse_date(args.date_from), _parse_date(args.date_to), args.apply)
    except _ApplyInterrompido as exc:
        _imprimir(exc.relatorio, gravado=True)
        print(f"FALHA: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 — fronteira do CLI
        print(f"FALHA: {sanitize_error_message(exc)}", file=sys.stderr)
        return 2
    _imprimir(rel, gravado=args.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
