"""
T-0118 — backfill de `total_shipments` do Mercado Livre, e SÓ dele.

POR QUE ESTE MÓDULO EXISTE

A migration 047 cria `marts.fact_marketplace_daily_performance.total_shipments`
(denominador do "não entregue" do ML: envios, não pedidos). O pipeline diário
passa a gravá-la, mas só na janela incremental. O histórico fica NULL até ser
preenchido, e `daily_performance --source ml` em backfill republicaria a linha
INTEIRA (GMV, pedidos, Ads, frete... — ver `sync_ml_marketplace_fees`).

Este módulo é o reparo de escopo restrito: um UPDATE que toca **uma coluna**,
`total_shipments`, e mais nada. Molde: `pipelines/sync_ml_marketplace_fees.py`.

CONTRATO

  * lê `gold.ml_gestao_diaria` (`ref_date`, `brand`, `total_shipments`) no
    Data Mart, na janela `--start..--end` (inclusiva);
  * brand → loja_id pelo mesmo mapa do transform (`BRAND_TO_LOJA`); marca sem
    loja é ignorada e contada;
  * **nunca insere**: só `UPDATE ... WHERE marketplace_id = 2 AND loja_id = ...
    AND date = ...`. Linha da gold sem linha na fato é só contada;
  * ausência de observação (gold com `total_shipments` NULL) não é escrita;
  * só escreve o que muda (idempotente: reexecutar não muda nada);
  * dry-run por padrão (transação READ ONLY, zero escrita); `--apply` grava
    numa transação única, sob advisory lock próprio (`LOCK_KEY`);
  * credenciais só pelo ambiente (`pipelines.common.db`); nenhum DSN, host,
    senha ou IP em log ou mensagem de erro.

USO

    python -m pipelines.sync_ml_total_shipments --start 2026-01-01 --end 2026-10-31
    python -m pipelines.sync_ml_total_shipments --start 2026-01-01 --end 2026-10-31 --apply
"""
from __future__ import annotations

import argparse
import logging
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Optional

from sqlalchemy import text

from pipelines.common.logging import get_logger
from pipelines.ingestion.fato_diaria_lock import EXIT_CODE_LOCK_UNAVAILABLE
from pipelines.transforms.ml_gestao_diaria import BRAND_TO_LOJA, MARKETPLACE_ID

logger = get_logger(__name__)

SOURCE_NAME = "ml_total_shipments"
FACT_TABLE = "marts.fact_marketplace_daily_performance"

#: Advisory lock PRÓPRIO, de transação. Família 9181500xx (reparo de coluna da
#: fato), distinta de 918130000+mid (fato diária), 9181400xx (DRE) e
#: 917120017 (ofertas). 047 = número da migration que cria a coluna.
LOCK_KEY = 918_150_047


class MlTotalShipmentsError(RuntimeError):
    """Falha no backfill de total_shipments do ML."""


class MlTotalShipmentsLockOcupado(MlTotalShipmentsError):
    """Outro backfill de total_shipments está rodando."""


# ---------------------------------------------------------------------------
# Sanitização — nada de DSN, host, senha ou IP em log
# ---------------------------------------------------------------------------

_PADROES_SENSIVEIS = (
    re.compile(r"postgres(?:ql)?://[^\s]*", re.I),
    re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"),
    re.compile(r"password=\S+", re.I),
    re.compile(r"\bhost=\S+", re.I),
    re.compile(r"\buser=\S+", re.I),
)


def sanitizar(exc: BaseException | str) -> str:
    """Mensagem sem DSN, IP, host, senha ou usuário."""
    texto = exc if isinstance(exc, str) else f"{type(exc).__name__}: {exc}"
    for padrao in _PADROES_SENSIVEIS:
        texto = padrao.sub("[REDACTED]", texto)
    return " ".join(texto.split())[:500]


# ---------------------------------------------------------------------------
# SQL — escopo restrito
# ---------------------------------------------------------------------------

#: Leitura da gold. Sem filtro de marca de propósito: marca fora do mapa vira
#: contagem visível, não some em silêncio.
SQL_GOLD = """
    SELECT g.ref_date, g.brand, g.total_shipments
      FROM gold.ml_gestao_diaria g
     WHERE g.ref_date >= :start
       AND g.ref_date <= :end
     ORDER BY g.ref_date, g.brand
"""

SQL_FATO = text(f"""
    SELECT date, loja_id, total_shipments
      FROM {FACT_TABLE}
     WHERE marketplace_id = {MARKETPLACE_ID}
       AND date >= :start
       AND date <= :end
""")

#: A UNICA coluna autorizada. Sem INSERT: rowcount 0 = a chave sumiu entre a
#: leitura e a escrita, e a resposta certa é desfazer tudo.
SQL_PATCH = text(f"""
    UPDATE {FACT_TABLE}
       SET total_shipments = :total_shipments
     WHERE marketplace_id = {MARKETPLACE_ID}
       AND loja_id        = :loja_id
       AND date           = :date
""")

SQL_LOCK = text("SELECT pg_try_advisory_xact_lock(:chave)")
SQL_READ_ONLY = text("SET TRANSACTION READ ONLY")

SQL_AUDIT = text("""
    INSERT INTO audit.source_sync_run
        (source_name, marketplace_id, status, started_at, finished_at,
         rows_extracted, rows_loaded, source_min_date, source_max_date)
    VALUES (:fonte, :mkt, 'success', NOW(), NOW(),
            :extracted, :loaded, :min_date, :max_date)
""")


# ---------------------------------------------------------------------------
# Plano (função pura)
# ---------------------------------------------------------------------------

@dataclass
class Plano:
    linhas_gold: int = 0
    sem_loja: list[tuple] = field(default_factory=list)
    sem_observacao: list[tuple] = field(default_factory=list)
    casadas: int = 0
    mudariam: list[dict] = field(default_factory=list)
    gold_sem_fato: list[tuple] = field(default_factory=list)

    def resumo(self) -> dict:
        return {
            "linhas_gold": self.linhas_gold,
            "casadas_na_fato": self.casadas,
            "mudariam": len(self.mudariam),
            "gold_sem_fato": len(self.gold_sem_fato),
            "marca_sem_loja": len(self.sem_loja),
            "gold_sem_total_shipments": len(self.sem_observacao),
        }


def _contagem(valor: Any, onde: tuple) -> int:
    try:
        n = int(valor)
    except (TypeError, ValueError):
        raise MlTotalShipmentsError(f"total_shipments invalido em {onde}: {valor!r}") from None
    if n != valor or n < 0:
        raise MlTotalShipmentsError(f"total_shipments invalido em {onde}: {valor!r}")
    return n


def planejar(gold: list[dict], fato: list[dict]) -> Plano:
    """Compara gold x fato e devolve o que mudaria. Não toca banco."""
    na_fato = {(r["date"], r["loja_id"]): r.get("total_shipments") for r in fato}
    p = Plano(linhas_gold=len(gold))
    vistas: set[tuple] = set()

    for row in gold:
        ref_date, brand = row.get("ref_date"), row.get("brand")
        loja_id = BRAND_TO_LOJA.get(brand)
        if loja_id is None:
            p.sem_loja.append((ref_date, brand))
            continue

        chave = (ref_date, loja_id)
        if chave in vistas:
            raise MlTotalShipmentsError(
                f"chave repetida na gold: {ref_date} loja_id={loja_id}. O agregado "
                "por dia x marca deveria ser unico."
            )
        vistas.add(chave)

        if chave not in na_fato:
            p.gold_sem_fato.append(chave)
            continue
        p.casadas += 1

        valor = row.get("total_shipments")
        if valor is None:
            # Ausência na fonte não apaga o que está publicado.
            p.sem_observacao.append(chave)
            continue
        novo = _contagem(valor, chave)
        atual = na_fato[chave]
        if atual is not None and int(atual) == novo:
            continue
        p.mudariam.append({"date": ref_date, "loja_id": loja_id, "total_shipments": novo})

    return p


# ---------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------

def _ler_gold(start: date, end: date) -> list[dict]:
    # Import tardio: `pipelines.common.db` cria os engines no import.
    from pipelines.common.db import datamart_query

    return datamart_query(SQL_GOLD, {"start": start, "end": end})


def _fabrica_padrao():
    from pipelines.common.db import LocalSession

    return LocalSession()


def executar(start: date, end: date, *, apply: bool = False,
             ler_gold: Optional[Callable] = None,
             session_factory: Optional[Callable] = None) -> dict:
    """Dry-run (padrão) ou apply, numa sessão/transação única.

    Ordem no apply: lock de transação -> leitura da gold -> leitura da fato ->
    UPDATEs -> auditoria -> commit. A leitura vem DEPOIS do lock para não
    publicar uma fotografia que outro backfill já invalidou.
    """
    if start > end:
        raise MlTotalShipmentsError(f"--start ({start}) posterior a --end ({end}).")

    sessao = (session_factory or _fabrica_padrao)()
    try:
        if apply:
            if not sessao.execute(SQL_LOCK, {"chave": LOCK_KEY}).scalar():
                raise MlTotalShipmentsLockOcupado(
                    f"advisory lock {LOCK_KEY} em uso: outro backfill de "
                    "total_shipments esta rodando. Nada foi escrito."
                )
        else:
            sessao.execute(SQL_READ_ONLY)

        gold = (ler_gold or _ler_gold)(start, end)
        fato = [dict(r) for r in
                sessao.execute(SQL_FATO, {"start": start, "end": end}).mappings().all()]
        plano = planejar(gold, fato)
        resumo = {"applied": False, "start": start, "end": end, **plano.resumo()}

        if not apply:
            sessao.rollback()
            return resumo

        atualizadas = 0
        for params in plano.mudariam:
            res = sessao.execute(SQL_PATCH, params)
            if res.rowcount != 1:
                raise MlTotalShipmentsError(
                    f"UPDATE afetou {res.rowcount} linha(s) para {params['date']} "
                    f"loja_id={params['loja_id']}; esperado 1. Transacao desfeita."
                )
            atualizadas += 1
        sessao.execute(SQL_AUDIT, {
            "fonte": SOURCE_NAME, "mkt": MARKETPLACE_ID,
            "extracted": plano.linhas_gold, "loaded": atualizadas,
            "min_date": start, "max_date": end,
        })
        sessao.commit()
        return {**resumo, "applied": True, "rows_updated": atualizadas}
    except BaseException:
        sessao.rollback()
        raise
    finally:
        sessao.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Preenche SOMENTE total_shipments do Mercado Livre na fato "
                    "diaria, a partir de gold.ml_gestao_diaria. Nunca insere linha."
    )
    parser.add_argument("--start", required=True, type=date.fromisoformat, metavar="YYYY-MM-DD")
    parser.add_argument("--end", required=True, type=date.fromisoformat, metavar="YYYY-MM-DD")
    parser.add_argument("--apply", action="store_true",
                        help="Sem esta flag o comando e' dry-run: zero escrita.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)-8s %(name)s %(message)s")

    try:
        resumo = executar(args.start, args.end, apply=args.apply)
    except MlTotalShipmentsLockOcupado as exc:
        logger.error("%s", sanitizar(exc))
        return EXIT_CODE_LOCK_UNAVAILABLE
    except Exception as exc:  # noqa: BLE001 — fronteira do CLI, mensagem sanitizada
        logger.error("backfill de total_shipments falhou: %s", sanitizar(exc))
        return 1

    print("APLICADO" if resumo["applied"] else "DRY-RUN (nenhuma escrita)")
    for k, v in resumo.items():
        print(f"  {k:26} {v}")
    return 0


if __name__ == "__main__":   # pragma: no cover
    raise SystemExit(main())
