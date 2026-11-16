"""T-0120 — dublê das leituras que a taxa Shopee do `/financeiro` faz.

`get_financeiro` le' tres coisas: a fato agregada por marca x canal, a taxa
Shopee do mart por MES (`SQL_SHOPEE_TAXA_MES`) e, para meses inteiros, o
insumo publicado da DRE (`marts.fact_dre_insumo_mensal`). Os dublês antigos
devolviam as mesmas linhas para qualquer SQL; este roteia pelo texto.
"""
from __future__ import annotations

from datetime import date

SHOPEE_ID = 3


class Rows:
    def __init__(self, rows, escalar=None):
        self._rows = rows
        self._escalar = escalar

    def mappings(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._escalar


def meses_do_mart(rows: list[dict], mes: date, linhas: int = 31) -> list[dict]:
    """Taxa Shopee por mes a partir das linhas da fato: `total_fees` nao zero =
    mart em todas as linhas do mes; zero/ausente = nenhuma linha com taxa."""
    out = []
    for r in rows:
        if r["marketplace_id"] != SHOPEE_ID:
            continue
        fee = r.get("total_fees") or 0
        out.append({"mes": mes, "marca": r["brand_key"], "dias": linhas, "linhas": linhas,
                    "fees": fee or None, "fees_n": linhas if fee else 0, "fees_neg_n": 0})
    return out


class FinanceiroSession:
    """Fato por marca x canal; mart Shopee por mes; insumo da DRE opcional."""

    def __init__(self, rows, mes: date, insumos: list[dict] | None = None, meses: list[dict] | None = None):
        self.rows = rows
        self.meses = meses if meses is not None else meses_do_mart(rows, mes)
        self.insumos = insumos
        self.sqls: list[str] = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.sqls.append(sql)
        if "to_regclass('marts.fact_dre_insumo_mensal')" in sql:
            return Rows([], escalar=self.insumos is not None)
        if "FROM marts.fact_dre_insumo_mensal" in sql:
            return Rows(self.insumos or [])
        if "AS refreshed_at" in sql:
            return Rows([{"refreshed_at": None}])
        if "fees_n" in sql:
            return Rows(self.meses)
        return Rows(self.rows)
