"""VENDAS-POR-HORA-1 — o "Hoje" por hora: cada canal cortado na SUA ultima hora fechada.

Le' `marts.fact_marketplace_hourly_sales` (vendas por hora, gravadas pela DAG
`marketplace_tower_dia_corrente` via `pipelines.sync_vendas_por_hora`) e soma
de 00:00 ate' o corte, hoje, ontem e no mesmo dia da semana passada.

🔑 O CORTE
----------
Corte H = "vendas de 00:00 ate' H:00" (horas 0..H-1). Cada canal tem o proprio
corte (a ultima hora que a fonte dele fechou): a Shopee atrasada nao segura o
ML e o TikTok. Hoje e ontem do MESMO canal somam ate' o mesmo corte, entao a
comparacao continua justa; o total e' a soma dos canais, cada um no seu corte.
`corte_hora` (topo) e' o do canal mais fresco, so' para dizer "ha' dado".
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.deps.period import APP_TIMEZONE

TABELA = "marts.fact_marketplace_hourly_sales"
FONTES = "marts.fact_marketplace_hourly_sales_fonte"

CANAL_POR_ID = {1: "tiktok", 2: "ml", 3: "shopee"}
SHOPEE_ID = 3

def _bloco(gmv, pedidos) -> dict:
    gmv = float(gmv or 0)
    pedidos = int(pedidos or 0)
    return {"gmv": round(gmv, 2), "pedidos": pedidos,
            "ticket": round(gmv / pedidos, 2) if pedidos else None}


def projetar_fechamento(hoje_ate_corte: float, ontem_ate_corte: float, ontem_dia: float) -> Optional[float]:
    """Onde o dia tende a fechar pelo RITMO DE ONTEM: o que ontem ja' tinha
    vendido ate' a mesma hora diz que fracao do dia aquilo era. Sem venda ontem
    ate' o corte nao ha' ritmo para usar: `None`, nunca um palpite."""
    if ontem_ate_corte <= 0 or ontem_dia <= 0:
        return None
    return round(hoje_ate_corte * ontem_dia / ontem_ate_corte, 2)


def hora_fechada_do_canal(fonte_ate: Optional[datetime], hoje: date) -> int:
    """Quantas horas de HOJE o canal ja' fechou (0 a 24)."""
    if fonte_ate is None:
        return 0
    local = fonte_ate.astimezone(APP_TIMEZONE)
    if local.date() < hoje:
        return 0
    if local.date() > hoje:
        return 24
    return local.hour


def calcular_cortes(fontes: dict[int, Optional[datetime]], mkt_ids: list[int],
                    agora: datetime) -> dict[int, int]:
    """Corte de cada canal: a ultima hora que ele fechou, nunca alem da hora atual."""
    local = agora.astimezone(APP_TIMEZONE)
    return {m: min(hora_fechada_do_canal(fontes.get(m), local.date()), local.hour) for m in mkt_ids}


def get_hoje_por_hora(db: Session, mkt_ids: list[int], brand_keys: Optional[list[str]],
                      agora: Optional[datetime] = None, base: str = "pagos") -> dict:
    """`base="realizados"` soma os nao pagos (colunas paralelas `unpaid_*`) a pedidos,
    GMV e tendencia; `pagos` (padrao) nem le' essas colunas. ML nao tem fonte de nao
    pago: `nao_pago_disponivel.ml` = false (NULL conta como 0 na soma)."""
    realizados = base == "realizados"
    agora = (agora or datetime.now(APP_TIMEZONE)).astimezone(APP_TIMEZONE)
    hoje = agora.date()
    dias = {"hoje": hoje, "ontem": hoje - timedelta(days=1), "semana_passada": hoje - timedelta(days=7)}

    existe = db.execute(text("SELECT to_regclass(:t) IS NOT NULL AND to_regclass(:f) IS NOT NULL"),
                        {"t": TABELA, "f": FONTES}).scalar()
    # `{**base}` abaixo: o nome `base` da assinatura e' a base de vendas, entao o
    # esqueleto da resposta chama-se `esqueleto`.
    esqueleto = {"dia": hoje.isoformat(), "corte_hora": None, "canais": [], "limitacoes": [],
                 "base": base, "nao_pago_disponivel": None}
    if not existe:
        return {**esqueleto, "disponivel": False,
                "motivo": "As vendas por hora ainda não estão publicadas no banco."}

    fontes = {r[0]: r[1] for r in db.execute(
        text(f"SELECT marketplace_id, fonte_ate FROM {FONTES} WHERE marketplace_id = ANY(:m)"),
        {"m": mkt_ids})}
    cortes = calcular_cortes(fontes, mkt_ids, agora)
    # Cada linha e' filtrada pelo corte do proprio canal (ids sao int: JSON seguro).
    cortes_json = json.dumps({str(m): c for m, c in cortes.items()})
    canais = [{"channel": CANAL_POR_ID[m],
               "fonte_ate": fontes[m].isoformat() if fontes.get(m) else None,
               "horas_fechadas_hoje": hora_fechada_do_canal(fontes.get(m), hoje),
               "corte_hora": cortes[m]}
              for m in mkt_ids]
    limitacoes: list[str] = []

    gmv_expr = "h.gmv + COALESCE(h.unpaid_gmv, 0)" if realizados else "h.gmv"
    pedidos_expr = "h.pedidos + COALESCE(h.unpaid_orders, 0)" if realizados else "h.pedidos"
    nao_pago_n = ", COUNT(h.unpaid_orders) AS unpaid_n" if realizados else ""
    linhas = db.execute(text(f"""
        SELECT h.dia, h.marketplace_id, SUM({gmv_expr}) AS gmv, SUM({pedidos_expr}) AS pedidos{nao_pago_n}
        FROM {TABELA} h
        JOIN marts.dim_loja l ON l.loja_id = h.loja_id
        WHERE h.dia = ANY(:dias)
          AND h.hora < (CAST(:cortes AS jsonb) ->> CAST(h.marketplace_id AS text))::int
          AND h.marketplace_id = ANY(:mkt_ids)
          AND (CAST(:brands AS text[]) IS NULL OR l.brand_key = ANY(CAST(:brands AS text[])))
        GROUP BY 1, 2
    """), {"dias": list(dias.values()), "cortes": cortes_json, "mkt_ids": mkt_ids,
           "brands": brand_keys}).mappings().all()

    somas = {(r["dia"], r["marketplace_id"]): (r["gmv"], r["pedidos"]) for r in linhas}
    # Ha' fonte de nao pago no canal se alguma hora dele (nos dias lidos) tem
    # `unpaid_orders` preenchido; zero conta (zero provado), NULL nao.
    nao_pago_disponivel = ({nome: any(int(r["unpaid_n"] or 0) > 0 for r in linhas if r["marketplace_id"] == mid)
                            for mid, nome in CANAL_POR_ID.items()} if realizados else None)

    # Tendencia de fechamento por marca: hoje e ontem ate' o corte, e ontem inteiro.
    por_marca_linhas = db.execute(text(f"""
        -- por_marca
        SELECT l.brand_key AS brand, h.dia, h.marketplace_id,
               SUM({gmv_expr}) FILTER (
                   WHERE h.hora < (CAST(:cortes AS jsonb) ->> CAST(h.marketplace_id AS text))::int) AS gmv_corte,
               SUM({gmv_expr}) AS gmv_dia
        FROM {TABELA} h
        JOIN marts.dim_loja l ON l.loja_id = h.loja_id
        WHERE h.dia = ANY(:dias)
          AND h.marketplace_id = ANY(:mkt_ids)
          AND (CAST(:brands AS text[]) IS NULL OR l.brand_key = ANY(CAST(:brands AS text[])))
        GROUP BY 1, 2, 3
    """), {"dias": [dias["hoje"], dias["ontem"]], "cortes": cortes_json, "mkt_ids": mkt_ids,
           "brands": brand_keys}).mappings().all() if any(cortes.values()) else []
    # Por marca E canal: quem mostra a tendencia soma so' os canais do valor
    # ao lado dela (ex.: so' os canais com meta), nunca um conjunto diferente.
    marcas: dict[str, dict[int, dict]] = {}
    for r in por_marca_linhas:
        m = marcas.setdefault(r["brand"], {}).setdefault(
            r["marketplace_id"], {"hoje": 0.0, "ontem_ate": 0.0, "ontem_dia": 0.0})
        if r["dia"] == dias["hoje"]:
            m["hoje"] = float(r["gmv_corte"] or 0)
        else:
            m["ontem_ate"], m["ontem_dia"] = float(r["gmv_corte"] or 0), float(r["gmv_dia"] or 0)

    def _tendencia(partes: list[dict]) -> dict:
        hoje_, ate, dia = (sum(p[k] for p in partes) for k in ("hoje", "ontem_ate", "ontem_dia"))
        return {"hoje": round(hoje_, 2), "ontem_mesma_hora": round(ate, 2), "ontem_dia": round(dia, 2),
                "projecao": projetar_fechamento(hoje_, ate, dia)}

    por_marca = [{
        "brand": b, **_tendencia(list(canais.values())),
        "por_canal": [{"channel": CANAL_POR_ID[mk], **_tendencia([p])} for mk, p in sorted(canais.items())],
        # Vazio desde que a Kokeshi na Shopee passou a ter hora de pedido (API, 11/2026).
        "canais_fora": [],
    } for b, canais in sorted(marcas.items())]

    def total(dia: date, ids: list[int]) -> dict:
        gmv = sum(float(somas.get((dia, m), (0, 0))[0] or 0) for m in ids)
        pedidos = sum(int(somas.get((dia, m), (0, 0))[1] or 0) for m in ids)
        return _bloco(gmv, pedidos)

    return {
        **esqueleto,
        "nao_pago_disponivel": nao_pago_disponivel,
        "disponivel": True,
        "corte_hora": max(cortes.values(), default=0),
        "canais": canais,
        "limitacoes": limitacoes,
        **{nome: total(d, mkt_ids) for nome, d in dias.items()},
        "por_canal": [{"channel": CANAL_POR_ID[m], **{nome: total(d, [m]) for nome, d in dias.items()}}
                      for m in mkt_ids],
        "por_marca": por_marca,
    }
