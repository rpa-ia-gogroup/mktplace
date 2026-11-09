"""T-0077 — reprocesso SEMANAL de 35 dias do GMV Mercado Livre, e o `--days`.

O defeito (T-0075): o `daily_ml` regrava so' D-4..D-1, e um pedido pago
cancelado depois de D+4 fica contado na fato para sempre (+2,77% em set/26). A
correcao copia a T-0074: `daily_performance --source ml --mode backfill
--days 35` uma vez por semana.

As perguntas que estes testes respondem:
  1. o comando, o timeout, o preflight e a criticidade sao os decididos?
  2. o diario continua incremental e nenhuma cadeia ganhou o passo?
  3. `--days 35` chega ao conector como D-36..D-1?
  4. o caminho regrava por UPSERT, sem DELETE, inclusive o dia com gmv=0?
  5. preflight bloqueado, timeout e lock ocupado saem FAILED/BLOCKED com exit 1?
  6. `--days` no incremental: sem efeito em TODAS as fontes, com aviso (R141)?
  7. janela exata: no ML, linha fora da janela bloqueia antes do upsert; nas
     demais fontes, so' aviso (R141)?

Fakes em tudo: nenhum subprocess, nenhum banco.
"""
from __future__ import annotations

import logging
import re
import subprocess
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

import pipelines.ops.orchestrate as orch
from pipelines.common.operational_calendar import closed_window, last_closed_date
from pipelines.connectors.mercadolivre import connector as ml
from pipelines.ingestion import daily_performance
from pipelines.ingestion.fato_diaria_lock import (
    EXIT_CODE_LOCK_UNAVAILABLE,
    fato_diaria_lock as _lock_real,
)
from pipelines.tests.conexoes_lock import ConexaoDeLock

PIPELINE = "ml_weekly_reprocess"
TZ = ZoneInfo("America/Sao_Paulo")


def _passo() -> orch.Step:
    (passo,) = orch.ML_WEEKLY_REPROCESS_STEPS
    return passo


def _kwargs_do_cli(args: tuple[str, ...]) -> dict:
    """Traduz argumentos de CLI para kwargs de `run`, pelo argparse REAL."""
    a = daily_performance.build_parser().parse_args(list(args))
    return {"source": a.source, "mode": a.mode, "days_back": a.days}


@pytest.fixture
def registrado(monkeypatch):
    """O pipeline ainda nao esta em PIPELINES (ver orchestrate.py); para testar
    o desfecho no orquestrador, registra so' durante o teste."""
    monkeypatch.setitem(orch.PIPELINES, PIPELINE, orch.ML_WEEKLY_REPROCESS_STEPS)


# ---------------------------------------------------------------------------
# 1. Definicao do passo
# ---------------------------------------------------------------------------

def test_um_unico_passo_com_o_comando_decidido():
    passo = _passo()
    assert passo.name == "ml_weekly_reprocess"
    assert passo.module == "pipelines.ingestion.daily_performance"
    assert passo.args == ("--source", "ml", "--mode", "backfill", "--days", "35")


def test_janela_pedida_e_35_dias_pelo_argparse_real():
    assert orch.ML_WEEKLY_REPROCESS_DAYS == 35
    assert _kwargs_do_cli(_passo().args) == {"source": "ml", "mode": "backfill", "days_back": 35}


def test_timeout_e_o_mesmo_envelope_do_daily_ml():
    diario = next(s for s in orch.PIPELINES["full_daily"] if s.name == "daily_ml")
    assert _passo().timeout_seconds == 900 == diario.timeout_seconds
    assert orch.ML_WEEKLY_REPROCESS_STEP_TIMEOUT_BUDGET_SECONDS == 900


def test_preflight_critico_sem_dependencia_sem_mapa_de_exit():
    passo = _passo()
    assert passo.preflight_source == "ml_daily"
    assert passo.critical is True
    assert passo.depends_on == ()
    assert passo.always_run is False
    assert passo.exit_status_map is None
    assert passo.supports_dry_run is False


# ---------------------------------------------------------------------------
# 2. O diario e as cadeias nao mudam
# ---------------------------------------------------------------------------

def test_daily_ml_continua_incremental_sem_days():
    for nome in ("full_daily", "daily_chain"):
        diario = next(s for s in orch.PIPELINES[nome] if s.name == "daily_ml")
        assert diario.args == ("--source", "ml", "--mode", "incremental"), nome


def test_nenhum_pipeline_existente_ganhou_o_passo_semanal():
    for nome, passos in orch.PIPELINES.items():
        if nome == PIPELINE:   # quando registrado, o proprio pipeline nao conta
            continue
        assert "ml_weekly_reprocess" not in {s.name for s in passos}, nome
        assert not any(s.args[:2] == ("--source", "ml") and "backfill" in s.args
                       for s in passos), nome


# ---------------------------------------------------------------------------
# 3. Janela efetiva: D-36..D-1
# ---------------------------------------------------------------------------

def test_closed_window_de_35_e_d36_a_d1():
    inicio, fim = closed_window(35, datetime(2026, 11, 9, 10, 0, tzinfo=TZ))
    assert (inicio.isoformat(), fim.isoformat()) == ("2026-10-04", "2026-11-08")


def test_cadencia_semanal_garante_regravacao_ate_d_mais_30():
    assert orch.ML_WEEKLY_REPROCESS_DAYS + 1 - 6 >= 30


def test_fetch_backfill_pede_ao_conector_a_janela_d36_d1(monkeypatch):
    capturado = {}
    monkeypatch.setattr(ml, "fetch", lambda a, b: capturado.setdefault("j", (a, b)) and [])
    ml.fetch_backfill(orch.ML_WEEKLY_REPROCESS_DAYS)
    inicio, fim = capturado["j"]
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
    # O guardrail de comissao tem testes proprios; aqui interessa o caminho.
    monkeypatch.setattr(daily_performance.ml_fee_reconciliation, "reconciliar",
                        lambda *a, **k: None)
    return log


def _linha_ml(d, brand="barbours", **over):
    base = {
        "date": d, "brand": brand,
        "gmv": Decimal("100.00"), "orders": 4, "units_sold": 5,
        "avg_ticket": Decimal("25.00"), "unique_buyers": 3, "new_buyers": 2,
        "repeat_buyers": 1, "repeat_buyer_rate_pct": Decimal("33.33"),
        "canceled_orders": 1, "cancel_rate_pct": Decimal("20.00"),
        "delivered_orders": 2, "avg_delivery_days": Decimal("3.00"),
        "seller_shipping_cost": Decimal("10.00"), "shipping_pct_of_gmv": Decimal("10.00"),
        "ad_spend": None, "ad_revenue": None, "ad_impressions": None, "ad_clicks": None,
        "roas": None, "acos_pct": None, "ctr_pct": None, "cpc": None,
        "marketplace_fee": Decimal("17.00"), "fee_orders": 4,
        "paid_gmv": Decimal("100.00"), "paid_orders_src": 4,
    }
    base.update(over)
    return base


def _escritas(log):
    return [(s, p) for s, p in log if "fact_marketplace_daily_performance" in s]


def test_comando_do_passo_regrava_por_upsert_sem_delete(monkeypatch, sessao):
    d1 = last_closed_date()
    dias = [d1 - timedelta(days=i) for i in (0, 20, 35)]
    capturado = {}

    def fake_fetch_backfill(days_back):
        capturado["days_back"] = days_back
        # dia com todos os pedidos cancelados: gmv=0, linha presente
        return [_linha_ml(d) for d in dias[:2]] + [
            _linha_ml(dias[2], gmv=Decimal("0"), orders=0, avg_ticket=None,
                      canceled_orders=7, cancel_rate_pct=Decimal("100.00"),
                      marketplace_fee=None, fee_orders=None,
                      paid_gmv=None, paid_orders_src=None)]

    monkeypatch.setattr(daily_performance.ml_connector, "fetch_backfill", fake_fetch_backfill)

    r = daily_performance.run(**_kwargs_do_cli(_passo().args))

    assert r["status"] == "success" and r["rows_loaded"] == 3
    assert capturado["days_back"] == 35
    escritas = _escritas(sessao)
    assert len(escritas) == 3
    for sql, _ in escritas:
        assert re.search(r"ON CONFLICT \(date, loja_id, marketplace_id\) DO UPDATE", sql)
        assert re.search(r"\bgmv\s*=\s*EXCLUDED\.gmv", sql)
    assert not any(re.search(r"^\s*DELETE", s, re.I | re.M) for s, _ in sessao)
    zerado = next(p for _, p in escritas if p["date"] == dias[2])
    assert zerado["gmv"] == Decimal("0") and zerado["marketplace_id"] == 2


def test_gmv_do_conector_vem_da_gold_e_a_gold_dirige_o_select():
    """A linha do (dia, marca) existe pela gold (agregado com todos os status),
    nao pelos CTEs `paid`, que entram por LEFT JOIN."""
    assert re.search(r"FROM gold\.ml_gestao_diaria g\s+LEFT JOIN ml_fees f", ml.QUERY)
    assert "LEFT JOIN ml_paid p" in ml.QUERY
    assert "g.cancelled_orders" in ml.QUERY


# ---------------------------------------------------------------------------
# 5. Desfechos no orquestrador
# ---------------------------------------------------------------------------

def _executor(rc=0, timeout=False, chamadas=None):
    def _fn(step):
        if chamadas is not None:
            chamadas.append(step.name)
        if timeout:
            raise subprocess.TimeoutExpired(cmd=step.module, timeout=step.timeout_seconds)
        return rc
    return _fn


def test_sucesso_sai_ok_e_exit_zero(registrado):
    chamadas: list = []
    r = orch.run_pipeline(PIPELINE, executor=_executor(chamadas=chamadas),
                          preflight_fn=lambda _f: (True, []))
    assert chamadas == ["ml_weekly_reprocess"]
    assert r == {"ml_weekly_reprocess": "SUCCESS"}
    assert orch.exit_code_do_pipeline(PIPELINE, r, orch.compute_overall_status(PIPELINE, r)) == 0


def test_recusa_dry_run(registrado):
    with pytest.raises(orch.DryRunUnsupportedError):
        orch.run_pipeline(PIPELINE, executor=lambda *a, **k: 0,
                          preflight_fn=lambda _f: (True, []), dry_run=True)


def test_preflight_bloqueado_nao_executa_e_sai_um(registrado):
    chamadas: list = []
    vistos: list = []

    def preflight(fonte):
        vistos.append(fonte)
        return False, []

    r = orch.run_pipeline(PIPELINE, executor=_executor(chamadas=chamadas), preflight_fn=preflight)
    assert vistos == ["ml_daily"] and chamadas == []
    overall = orch.compute_overall_status(PIPELINE, r)
    assert overall == "BLOCKED"
    assert orch.exit_code_do_pipeline(PIPELINE, r, overall) == 1


@pytest.mark.parametrize("executor", [_executor(timeout=True),
                                      _executor(rc=EXIT_CODE_LOCK_UNAVAILABLE)])
def test_timeout_ou_lock_ocupado_vira_failed_e_exit_um(registrado, executor):
    r = orch.run_pipeline(PIPELINE, executor=executor, preflight_fn=lambda _f: (True, []))
    assert r == {"ml_weekly_reprocess": "FAILED"}
    assert orch.exit_code_do_pipeline(PIPELINE, r, orch.compute_overall_status(PIPELINE, r)) == 1


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
                                    "--source", "ml", "--mode", "backfill", "--days", "35"]


# ---------------------------------------------------------------------------
# 6. `--days`
# ---------------------------------------------------------------------------

def test_argparse_days_sem_valor_e_none():
    assert _kwargs_do_cli(("--source", "ml", "--mode", "incremental"))["days_back"] is None


def test_ml_incremental_sem_days_usa_a_janela_do_conector(monkeypatch, sessao):
    chamadas = []
    monkeypatch.setattr(daily_performance.ml_connector, "fetch_incremental",
                        lambda **kw: chamadas.append(kw) or [])
    daily_performance.run(**_kwargs_do_cli(("--source", "ml", "--mode", "incremental")))
    assert chamadas == [{}]


@pytest.mark.parametrize("source, conector, days", [
    ("ml", "ml_connector", "2"),          # o `dia_ml --days 2` do Airflow
    ("tiktok", "tiktok_connector", "10"),
])
def test_incremental_com_days_nao_passa_days_back_e_avisa(monkeypatch, sessao, caplog,
                                                          source, conector, days):
    """R141: no incremental `--days` continua SEM efeito em todas as fontes,
    como antes da T-0077. A unica diferenca e' o aviso no log."""
    chamadas = []
    monkeypatch.setattr(getattr(daily_performance, conector), "fetch_incremental",
                        lambda **kw: chamadas.append(kw) or [])
    with caplog.at_level(logging.WARNING):
        daily_performance.run(**_kwargs_do_cli(
            ("--source", source, "--mode", "incremental", "--days", days)))
    assert chamadas == [{}]
    assert any(f"--days {days} ignorado" in m and source in m for m in caplog.messages)


def test_constante_de_days_no_incremental_nao_existe_mais():
    assert not hasattr(daily_performance, "FONTES_DAYS_NO_INCREMENTAL")


@pytest.mark.parametrize("days, esperado", [(None, 3), (35, 35), (0, 0)])
def test_backfill_sem_days_continua_em_3(days, esperado):
    assert daily_performance._fetch_kwargs("ml", "backfill", days) == {"days_back": esperado}


# ---------------------------------------------------------------------------
# 7. Janela exata: nada fora dela chega ao upsert
# ---------------------------------------------------------------------------

def test_linha_fora_da_janela_bloqueia_antes_do_upsert(monkeypatch, sessao):
    df, dt = date(2026, 7, 1), date(2026, 7, 31)
    monkeypatch.setattr(daily_performance.ml_connector, "fetch",
                        lambda a, b: [_linha_ml(df), _linha_ml(dt + timedelta(days=1))])
    with pytest.raises(daily_performance.WindowViolation):
        daily_performance.run(source="ml", mode="backfill",
                              date_from=df.isoformat(), date_to=dt.isoformat())
    assert _escritas(sessao) == []


def _linha_tiktok(d):
    return {
        "date": d, "brand": "apice",
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


def test_barreira_de_janela_so_bloqueia_no_ml_em_tiktok_e_aviso(monkeypatch, sessao, caplog):
    """R141: a `WindowViolation` vale so' para `source="ml"`. No TikTok a linha
    fora da janela nao levanta: so' aviso, e a carga segue como antes."""
    df, dt = date(2026, 7, 1), date(2026, 7, 31)
    fora = dt + timedelta(days=1)
    monkeypatch.setattr(daily_performance.tiktok_connector, "fetch",
                        lambda a, b: [_linha_tiktok(df), _linha_tiktok(fora)])
    with caplog.at_level(logging.WARNING):
        r = daily_performance.run(source="tiktok", mode="backfill",
                                  date_from=df.isoformat(), date_to=dt.isoformat())
    assert r["status"] == "success"
    assert any("fora da janela pedida" in m for m in caplog.messages)
    assert {p["date"] for _, p in _escritas(sessao)} == {df, fora}


def test_janela_exata_escreve_so_a_janela_e_devolve_o_desfecho(monkeypatch, sessao):
    df, dt = date(2026, 7, 1), date(2026, 7, 31)
    monkeypatch.setattr(daily_performance.ml_connector, "fetch",
                        lambda a, b: [_linha_ml(df), _linha_ml(dt, brand="kokeshi")])
    r = daily_performance.run(source="ml", mode="backfill",
                              date_from=df.isoformat(), date_to=dt.isoformat())
    assert r == {"status": "success", "rows_loaded": 2,
                 "source_min_date": df, "source_max_date": dt}
    assert {p["date"] for _, p in _escritas(sessao)} == {df, dt}
