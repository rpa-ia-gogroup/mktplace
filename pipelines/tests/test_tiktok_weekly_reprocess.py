"""T-0074 — reprocesso SEMANAL de 35 dias do GMV TikTok.

O defeito (T-0072): o `daily_tiktok` regrava so' D-11..D-1, e um pedido
cancelado depois de D+11 fica contado na fato para sempre. A correcao e' um
pipeline proprio, `tiktok_weekly_reprocess`, que roda
`daily_performance --source tiktok --mode backfill --days 35` uma vez por semana.

As perguntas que estes testes respondem:
  1. o comando, o timeout, o preflight e a criticidade sao os decididos?
  2. o diario de 11 dias continua intacto e a cadeia diaria nao ganhou passo?
  3. `--days 35` chega ao conector como D-36..D-1 (36 dias fechados)?
  4. o caminho regrava por UPSERT (`ON CONFLICT ... DO UPDATE`), sem DELETE?
  5. o dia com TODOS os pedidos cancelados continua gerando linha (gmv=0)? E'
     isso que torna o DELETE do `refresh_tiktok_daily_contract` dispensavel
     neste passo.
  6. preflight bloqueado, timeout e lock ocupado saem FAILED/BLOCKED com exit 1.

Fakes em tudo: nenhum subprocess, nenhum banco.
"""
from __future__ import annotations

import re
import subprocess
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

import pipelines.ops.orchestrate as orch
from pipelines.common.operational_calendar import closed_window, last_closed_date
from pipelines.connectors.tiktok import connector as tk
from pipelines.ingestion import daily_performance
from pipelines.ingestion.fato_diaria_lock import (
    EXIT_CODE_LOCK_UNAVAILABLE,
    fato_diaria_lock as _lock_real,
)
from pipelines.tests.conexoes_lock import ConexaoDeLock

PIPELINE = "tiktok_weekly_reprocess"
TZ = ZoneInfo("America/Sao_Paulo")


def _passo() -> orch.Step:
    (passo,) = orch.PIPELINES[PIPELINE]
    return passo


def _args_como_kwargs(args: tuple[str, ...]) -> dict:
    """Traduz os argumentos do step para os kwargs de `daily_performance.run`,
    exatamente como o argparse do modulo faria (`--days` vira `days_back`)."""
    pares = dict(zip(args[::2], args[1::2]))
    assert set(pares) == {"--source", "--mode", "--days"}, pares
    return {"source": pares["--source"], "mode": pares["--mode"],
            "days_back": int(pares["--days"])}


# ---------------------------------------------------------------------------
# 1. Definicao do passo
# ---------------------------------------------------------------------------

def test_pipeline_tem_um_unico_passo_com_o_comando_decidido():
    passo = _passo()
    assert passo.name == "tiktok_weekly_reprocess"
    assert passo.module == "pipelines.ingestion.daily_performance"
    assert passo.args == ("--source", "tiktok", "--mode", "backfill", "--days", "35")


def test_janela_pedida_e_35_dias():
    assert orch.TIKTOK_WEEKLY_REPROCESS_DAYS == 35
    assert _args_como_kwargs(_passo().args)["days_back"] == 35


def test_timeout_e_o_mesmo_envelope_do_daily_tiktok():
    diario = next(s for s in orch.PIPELINES["full_daily"] if s.name == "daily_tiktok")
    assert _passo().timeout_seconds == 900 == diario.timeout_seconds
    assert orch.TIKTOK_WEEKLY_REPROCESS_STEP_TIMEOUT_BUDGET_SECONDS == 900


def test_preflight_critico_sem_dependencia_sem_mapa_de_exit():
    passo = _passo()
    assert passo.preflight_source == "tiktok_daily"
    assert passo.critical is True
    assert passo.depends_on == ()
    assert passo.always_run is False
    assert passo.exit_status_map is None


def test_nao_declara_modo_ensaio():
    """`daily_performance` nao tem dry-run: o pipeline RECUSA `--dry-run`
    antes de qualquer subprocesso, em vez de rodar o backfill gravando."""
    assert _passo().supports_dry_run is False
    with pytest.raises(orch.DryRunUnsupportedError):
        orch.run_pipeline(PIPELINE, executor=lambda *a, **k: 0,
                          preflight_fn=lambda _f: (True, []), dry_run=True)


def test_sem_health_check():
    assert "health_check" not in {s.name for s in orch.PIPELINES[PIPELINE]}


# ---------------------------------------------------------------------------
# 2. O diario e a cadeia nao mudam
# ---------------------------------------------------------------------------

def test_daily_tiktok_continua_incremental_de_10_dias():
    for nome in ("full_daily", "daily_chain"):
        diario = next(s for s in orch.PIPELINES[nome] if s.name == "daily_tiktok")
        assert diario.args == ("--source", "tiktok", "--mode", "incremental", "--days", "10"), nome


@pytest.mark.parametrize("nome", ["full_daily", "daily_chain", "serving_refresh",
                                  "shopee_manual_refresh", "pma_refresh"])
def test_nenhum_outro_pipeline_ganhou_o_passo_semanal(nome):
    assert "tiktok_weekly_reprocess" not in {s.name for s in orch.PIPELINES[nome]}
    assert not any("backfill" in s.args for s in orch.PIPELINES[nome]), nome


# ---------------------------------------------------------------------------
# 3. Janela efetiva: D-36..D-1
# ---------------------------------------------------------------------------

def test_closed_window_de_35_e_d36_a_d1():
    agora = datetime(2026, 11, 9, 10, 0, tzinfo=TZ)
    inicio, fim = closed_window(35, agora)
    assert fim.isoformat() == "2026-11-08"          # D-1
    assert inicio.isoformat() == "2026-10-04"       # D-36
    assert (fim - inicio).days + 1 == 36


def test_cadencia_semanal_garante_regravacao_ate_d_mais_30():
    """Cada dia e' regravado pela ultima vez com idade entre 30 e 36 dias: com
    a janela D-36..D-1 rodando a cada 7 dias, o pior caso perde 6 dias."""
    idade_maxima = orch.TIKTOK_WEEKLY_REPROCESS_DAYS + 1
    assert idade_maxima - 6 >= 30


def test_fetch_backfill_pede_ao_conector_a_janela_d36_d1(monkeypatch):
    capturado = {}

    def fake_fetch(date_from, date_to):
        capturado["janela"] = (date_from, date_to)
        return []

    monkeypatch.setattr(tk, "fetch", fake_fetch)
    tk.fetch_backfill(orch.TIKTOK_WEEKLY_REPROCESS_DAYS)
    inicio, fim = capturado["janela"]
    assert fim == last_closed_date()
    assert fim - inicio == timedelta(days=35)


# ---------------------------------------------------------------------------
# 4. Caminho de escrita: UPSERT, sem DELETE
# ---------------------------------------------------------------------------

class _Resultado:
    def scalar_one(self):
        return 1


class _SessaoGravadora:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append((str(sql), params))
        return _Resultado()

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


def _linha_fonte(d, brand, **over):
    base = {
        "date": d, "brand": brand,
        "gmv": Decimal("100.00"), "orders": 4, "avg_ticket": Decimal("25.00"),
        "content_orders": 6, "units_sold": 5, "unique_buyers": 3,
        "visitors": None, "conversion_rate": None,
        "canceled_orders": 1, "cancel_rate_pct": Decimal("20.00"),
        "returned_orders": None, "refunded_orders": None, "problem_rate": None,
        "delivered_orders": 2, "avg_delivery_hours": Decimal("30.00"),
        "gmv_video": Decimal("10.00"), "gmv_live": Decimal("5.00"),
        "gmv_card": Decimal("1.00"),
        "total_settlement": Decimal("90.00"), "total_fees": Decimal("10.00"),
    }
    base.update(over)
    return base


@pytest.fixture
def sessao(monkeypatch):
    log: list = []

    @contextmanager
    def _local_session():
        yield _SessaoGravadora(log)

    monkeypatch.setattr(daily_performance, "local_session", _local_session)
    monkeypatch.setattr(
        daily_performance, "fato_diaria_lock",
        lambda mkt: _lock_real(mkt, connect=lambda: ConexaoDeLock(livre=True)))
    return log


def test_comando_do_passo_regrava_por_upsert_sem_delete(monkeypatch, sessao):
    d1 = last_closed_date()
    dias = [d1 - timedelta(days=i) for i in (0, 20, 35)]
    capturado = {}

    def fake_fetch_backfill(days_back):
        capturado["days_back"] = days_back
        # dia com tudo cancelado: gmv=0, zero pedidos comerciais, linha presente
        return [_linha_fonte(d, "apice") for d in dias[:2]] + [
            _linha_fonte(dias[2], "apice", gmv=Decimal("0"), orders=0,
                         avg_ticket=None, canceled_orders=7,
                         cancel_rate_pct=Decimal("100.00"))]

    monkeypatch.setattr(daily_performance.tiktok_connector, "fetch_backfill", fake_fetch_backfill)

    daily_performance.run(**_args_como_kwargs(_passo().args))

    assert capturado["days_back"] == 35
    escritas = [(s, p) for s, p in sessao if "fact_marketplace_daily_performance" in s]
    assert len(escritas) == 3
    for sql, _ in escritas:
        assert re.search(r"ON CONFLICT \(date, loja_id, marketplace_id\) DO UPDATE", sql)
        assert re.search(r"\bgmv\s*=\s*EXCLUDED\.gmv", sql)
    assert not any(re.search(r"^\s*DELETE", s, re.I | re.M) for s, _ in sessao)
    cancelado = next(p for _, p in escritas if p["date"] == dias[2])
    assert cancelado["gmv"] == Decimal("0") and cancelado["marketplace_id"] == 1
    assert {p["date"] for _, p in escritas} == set(dias)


# ---------------------------------------------------------------------------
# 5. Contrato do conector de que o UPSERT depende
# ---------------------------------------------------------------------------

def _bloco(sql: str, inicio: str, fim: str) -> str:
    a = sql.index(inicio)
    return sql[a:sql.index(fim, a)]


def test_raw_daily_nao_filtra_status_no_where():
    """O dia com TODOS os pedidos cancelados so' continua gerando linha (gmv=0)
    porque nenhum filtro de status vive no WHERE de `raw_dedup` nem de
    `raw_daily`: o comercial fica no SUM/FILTER. Se alguem mover o filtro para o
    WHERE, o (dia, marca) desaparece da extracao, o UPSERT nao o toca e o valor
    antigo fica orfao — e o reprocesso semanal deixaria de corrigir esse caso."""
    dedup = _bloco(tk.QUERY, "raw_dedup AS", "raw_daily AS")
    where_dedup = _bloco(dedup, "WHERE", "ORDER BY")
    assert "order_status" not in where_dedup
    assert "statuses" not in where_dedup
    daily = _bloco(tk.QUERY, "raw_daily AS", "\nSELECT\n")
    # Sem WHERE entre o FROM e o GROUP BY: os `WHERE` de `raw_daily` vivem
    # todos dentro de `COUNT(*) FILTER (...)`, que nao remove linha do grupo.
    assert re.search(r"FROM raw_dedup\s+GROUP BY", daily)
    assert "SUM(CASE WHEN order_status IN :commercial_statuses THEN total_amount ELSE 0 END)" in daily


def test_raw_daily_e_a_tabela_dirigente():
    assert re.search(r"FROM raw_daily r\s+LEFT JOIN gold\.tiktok_brand_daily g", tk.QUERY)


# ---------------------------------------------------------------------------
# 6. Desfechos no orquestrador
# ---------------------------------------------------------------------------

def _executor(rc=0, timeout=False, chamadas=None):
    def _fn(step):
        if chamadas is not None:
            chamadas.append(step.name)
        if timeout:
            raise subprocess.TimeoutExpired(cmd=step.module, timeout=step.timeout_seconds)
        return rc
    return _fn


def test_sucesso_sai_ok_e_exit_zero():
    chamadas: list = []
    r = orch.run_pipeline(PIPELINE, executor=_executor(chamadas=chamadas),
                          preflight_fn=lambda _f: (True, []))
    assert chamadas == ["tiktok_weekly_reprocess"]
    assert r == {"tiktok_weekly_reprocess": "SUCCESS"}
    assert orch.compute_overall_status(PIPELINE, r) == "OK"
    assert orch.exit_code_do_pipeline(PIPELINE, r, "OK") == 0


def test_preflight_bloqueado_nao_executa_e_sai_um():
    chamadas: list = []
    vistos: list = []

    def preflight(fonte):
        vistos.append(fonte)
        return False, []

    r = orch.run_pipeline(PIPELINE, executor=_executor(chamadas=chamadas), preflight_fn=preflight)
    assert vistos == ["tiktok_daily"]
    assert chamadas == []
    overall = orch.compute_overall_status(PIPELINE, r)
    assert overall == "BLOCKED"
    assert orch.exit_code_do_pipeline(PIPELINE, r, overall) == 1


def test_timeout_individual_vira_failed_e_exit_um():
    r = orch.run_pipeline(PIPELINE, executor=_executor(timeout=True),
                          preflight_fn=lambda _f: (True, []))
    assert r == {"tiktok_weekly_reprocess": "FAILED"}
    overall = orch.compute_overall_status(PIPELINE, r)
    assert overall == "FAILED"
    assert orch.exit_code_do_pipeline(PIPELINE, r, overall) == 1


def test_default_executor_aplica_o_timeout_de_900s(monkeypatch):
    capturado = {}

    def fake_run(cmd, cwd=None, timeout=None):
        capturado.update(cmd=cmd, timeout=timeout)

        class _P:
            returncode = 0
        return _P()

    monkeypatch.setattr(orch.subprocess, "run", fake_run)
    assert orch._default_executor(_passo()) == 0
    assert capturado["timeout"] == 900
    assert capturado["cmd"][1:] == ["-m", "pipelines.ingestion.daily_performance",
                                    "--source", "tiktok", "--mode", "backfill", "--days", "35"]


def test_lock_da_fato_ocupado_vira_failed():
    """Exit 75 = outro escritor da fato TikTok (diario ou dia corrente) em
    curso; nada lido nem escrito. O orquestrador nao repete: FAILED, exit 1."""
    r = orch.run_pipeline(PIPELINE, executor=_executor(rc=EXIT_CODE_LOCK_UNAVAILABLE),
                          preflight_fn=lambda _f: (True, []))
    assert r == {"tiktok_weekly_reprocess": "FAILED"}
    assert orch.exit_code_do_pipeline(PIPELINE, r, orch.compute_overall_status(PIPELINE, r)) == 1
