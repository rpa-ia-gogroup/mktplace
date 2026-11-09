"""Testes de pipelines/ops/refresh_ml_daily_contract.py (T-0077).

Nenhum banco: `ler_destino`, `ml_connector.fetch` e `daily_performance.run` sao
sempre substituidos. As perguntas:
  1. janela padrao 01/07..hoje-5, teto D-1;
  2. fatias de <= 31 dias, cortadas no mes, sem buraco nem sobreposicao;
  3. dry-run NAO escreve (nao chama o pipeline) e mede o impacto mes x marca;
  4. apply escreve SO' as janelas pedidas, pelo pipeline diario, e para na
     primeira falha.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from pipelines.ops import refresh_ml_daily_contract as rf

TZ = ZoneInfo("America/Sao_Paulo")
AGORA = datetime(2026, 11, 9, 10, 0, tzinfo=TZ)   # hoje-5 = 2026-11-04


# ---------------------------------------------------------------------------
# 1. Janela
# ---------------------------------------------------------------------------

def test_janela_padrao_e_01_07_ate_hoje_menos_5():
    assert rf.resolve_window(None, None, AGORA) == (date(2026, 7, 1), date(2026, 11, 4))


def test_date_to_em_d0_e_recusado():
    with pytest.raises(rf.RefreshError, match="D-1"):
        rf.resolve_window(None, date(2026, 11, 9), AGORA)


def test_date_to_em_d1_e_aceito():
    assert rf.resolve_window(date(2026, 11, 1), date(2026, 11, 8), AGORA)[1] == date(2026, 11, 8)


def test_janela_invertida_e_recusada():
    with pytest.raises(rf.RefreshError, match="vazia"):
        rf.resolve_window(date(2026, 9, 2), date(2026, 9, 1), AGORA)


# ---------------------------------------------------------------------------
# 2. Fatias
# ---------------------------------------------------------------------------

def test_fatias_do_reparo_padrao_sao_os_meses():
    assert rf.janelas(date(2026, 7, 1), date(2026, 11, 4)) == [
        (date(2026, 7, 1), date(2026, 7, 31)),
        (date(2026, 8, 1), date(2026, 8, 31)),
        (date(2026, 9, 1), date(2026, 9, 30)),
        (date(2026, 10, 1), date(2026, 10, 31)),
        (date(2026, 11, 1), date(2026, 11, 4)),
    ]


@pytest.mark.parametrize("inicio, fim, max_dias", [
    (date(2026, 7, 1), date(2026, 11, 4), 31),
    (date(2026, 7, 15), date(2026, 9, 3), 31),
    (date(2025, 12, 28), date(2026, 3, 2), 31),
    (date(2026, 1, 1), date(2026, 12, 31), 10),
    (date(2026, 7, 1), date(2026, 7, 1), 31),
])
def test_fatias_cobrem_tudo_sem_buraco_e_com_no_maximo_31_dias(inicio, fim, max_dias):
    fatias = rf.janelas(inicio, fim, max_dias)
    assert fatias[0][0] == inicio and fatias[-1][1] == fim
    for (a, b), (c, _) in zip(fatias, fatias[1:]):
        assert c == b + timedelta(days=1)
    for a, b in fatias:
        assert a <= b
        assert (b - a).days + 1 <= min(max_dias, 31)
        assert a.month == b.month and a.year == b.year


# ---------------------------------------------------------------------------
# 3. Dry-run
# ---------------------------------------------------------------------------

def _linha_fonte(d, brand, gmv, orders=1):
    return {"date": d, "brand": brand, "gmv": Decimal(gmv), "orders": orders,
            "marketplace_fee": None, "fee_orders": None,
            "paid_gmv": Decimal(gmv), "paid_orders_src": orders}


def _linha_destino(d, loja_id, gmv, orders=1):
    return {"date": d, "loja_id": loja_id, "marketplace_id": 2,
            "gmv": Decimal(gmv), "orders": orders, "canceled_orders": 0}


@pytest.fixture
def mundo(monkeypatch):
    """Fonte e destino em memoria; qualquer escrita levanta."""
    estado = {"destino": [], "fonte": [], "fetches": [], "leituras": [], "runs": []}

    def fake_fetch(a, b):
        estado["fetches"].append((a, b))
        return [r for r in estado["fonte"] if a <= r["date"] <= b]

    def fake_destino(a, b):
        estado["leituras"].append((a, b))
        return [r for r in estado["destino"] if a <= r["date"] <= b]

    monkeypatch.setattr(rf.ml_connector, "fetch", fake_fetch)
    monkeypatch.setattr(rf, "ler_destino", fake_destino)
    monkeypatch.setattr(rf.ml_fee_reconciliation, "reconciliar", lambda *a, **k: None)
    return estado


def test_dry_run_nao_escreve_e_mede_mes_x_marca(monkeypatch, mundo):
    def proibido(*a, **k):
        raise AssertionError("dry-run chamou o pipeline de escrita")

    monkeypatch.setattr(rf.daily_performance, "run", proibido)
    monkeypatch.setattr(rf._common_db, "local_session", proibido)
    d = date(2026, 9, 10)
    mundo["destino"] = [_linha_destino(d, 2, "1000.00", 10), _linha_destino(d, 3, "500.00", 5)]
    mundo["fonte"] = [_linha_fonte(d, "barbours", "900.00", 9),
                      _linha_fonte(d, "kokeshi", "500.00", 5)]

    rel = rf.run_refresh(date(2026, 9, 1), date(2026, 9, 30), apply=False, agora=AGORA)

    assert rel["resultado"] == "dry-run; nada escrito"
    assert mundo["fetches"] == [(date(2026, 9, 1), date(2026, 9, 30))]
    imp = rel["impacto"]
    assert imp["chaves_com_gmv_ou_pedidos_alterados"] == 1
    assert imp["chaves_so_no_destino"] == 0 and imp["chaves_novas"] == 0
    linhas = {(r["mes"], r["marca"]): r for r in imp["por_mes_marca"]}
    assert linhas[("2026-09", "barbours")]["delta_gmv"] == "-100.00"
    assert linhas[("2026-09", "barbours")]["delta_gmv_pct"] == "-10.00"
    assert linhas[("2026-09", "kokeshi")]["delta_gmv"] == "0.00"
    assert linhas[("2026-09", "TOTAL")]["gmv_antes"] == "1500.00"
    assert linhas[("2026-09", "TOTAL")]["gmv_depois"] == "1400.00"


def test_dry_run_le_a_fonte_janela_a_janela(mundo):
    rf.run_refresh(None, None, apply=False, agora=AGORA)
    assert mundo["fetches"] == rf.janelas(date(2026, 7, 1), date(2026, 11, 4))
    assert all((b - a).days + 1 <= 31 for a, b in mundo["fetches"])


def test_dry_run_conta_chave_que_o_upsert_nao_tocaria(mundo):
    d = date(2026, 8, 5)
    mundo["destino"] = [_linha_destino(d, 2, "10.00")]
    rel = rf.run_refresh(date(2026, 8, 1), date(2026, 8, 31), apply=False, agora=AGORA)
    assert rel["impacto"]["chaves_so_no_destino"] == 1
    assert rel["impacto"]["amostra_so_no_destino"] == [{"date": "2026-08-05", "loja_id": 2}]


def test_dry_run_informa_guardrail_que_reprovaria(monkeypatch, mundo):
    def reprova(*a, **k):
        raise rf.ml_fee_reconciliation.MlFeeReconciliationError("divergiu")

    monkeypatch.setattr(rf.ml_fee_reconciliation, "reconciliar", reprova)
    rel = rf.run_refresh(date(2026, 8, 1), date(2026, 8, 31), apply=False, agora=AGORA)
    assert rel["guardrail_comissao"]["2026-08-01..2026-08-31"].startswith("REPROVARIA")


def test_resumo_sem_linha_num_lado_fica_none_nunca_zero():
    r = rf.resumo_mes_marca([], [_linha_destino(date(2026, 7, 1), 4, "5.00")])
    lescent = next(x for x in r if x["marca"] == "lescent")
    assert lescent["gmv_antes"] is None and lescent["delta_gmv"] is None


# ---------------------------------------------------------------------------
# 4. Apply
# ---------------------------------------------------------------------------

def test_apply_escreve_so_as_janelas_pelo_pipeline_diario(monkeypatch, mundo):
    def fake_run(**kw):
        mundo["runs"].append(kw)
        return {"status": "success", "rows_loaded": 4}

    monkeypatch.setattr(rf.daily_performance, "run", fake_run)
    rel = rf.run_refresh(None, None, apply=True, agora=AGORA)

    assert rel["resultado"] == "aplicado"
    assert mundo["fetches"] == []          # a leitura da fonte e' do pipeline
    assert mundo["runs"] == [
        {"source": "ml", "mode": "backfill", "date_from": a.isoformat(), "date_to": b.isoformat()}
        for a, b in rf.janelas(date(2026, 7, 1), date(2026, 11, 4))
    ]
    # destino lido antes e depois, so' na janela do reparo
    assert mundo["leituras"] == [(date(2026, 7, 1), date(2026, 11, 4))] * 2


def test_apply_para_na_primeira_janela_que_falha(monkeypatch, mundo):
    def fake_run(**kw):
        mundo["runs"].append(kw)
        status = "failed" if kw["date_from"] == "2026-08-01" else "success"
        return {"status": status, "rows_loaded": 0}

    monkeypatch.setattr(rf.daily_performance, "run", fake_run)
    with pytest.raises(rf.RefreshError, match="2026-08-01..2026-08-31") as exc:
        rf.run_refresh(None, None, apply=True, agora=AGORA)
    assert [r["date_from"] for r in mundo["runs"]] == ["2026-07-01", "2026-08-01"]
    assert exc.value.relatorio["aplicadas"][-1]["status"] == "failed"


def test_main_sem_apply_e_dry_run(monkeypatch, mundo, capsys):
    monkeypatch.setattr(rf.daily_performance, "run",
                        lambda **k: (_ for _ in ()).throw(AssertionError("escreveu")))
    assert rf.main(["--date-from", "2026-07-01", "--date-to", "2026-07-31"]) == 0
    out = capsys.readouterr().out
    assert "MODO DRY-RUN" in out and "NADA foi gravado" in out


def test_main_data_invalida_sai_dois(capsys):
    assert rf.main(["--date-from", "01/07/2026"]) == 2
    assert "data invalida" in capsys.readouterr().err
