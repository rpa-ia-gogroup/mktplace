"""T-0117 (C1-202) — frescor de /operacoes pela DATA do dado, nao so' pela carga.

A tela dizia "Atualizado 10:17" (`refreshed_at` = hora da carga) com a gold
um dia atras e sem aviso. `dados_ate` traz a ultima data com dado por bloco
(ML e TikTok) e `esperado_ate` o D-1 operacional, o teto das janelas.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.services import gold_service as gs

HOJE = date(2026, 11, 13)
D_FECHADO = HOJE - timedelta(days=1)


def _instala(monkeypatch, frescor_rows):
    capturado: dict[str, str] = {}

    def fake_query(db, sql):
        s = " ".join(sql.split())
        if "frescor_refreshed_at" in s:
            capturado["frescor"] = s
            return [dict(r) for r in frescor_rows]
        return []

    monkeypatch.setattr(gs, "_hoje_operacional", lambda *a, **k: HOJE)
    monkeypatch.setattr(gs, "_query", fake_query)
    return capturado


def test_dados_ate_reflete_o_max_date_de_cada_bloco(monkeypatch):
    _instala(monkeypatch, [{
        "frescor_refreshed_at": datetime(2026, 11, 13, 13, 17, tzinfo=timezone.utc),
        "dados_ate_ml": date(2026, 11, 12),
        "dados_ate_tiktok": date(2026, 11, 11),
    }])
    out = gs.get_operacoes(db=None)
    assert out["dados_ate"] == {"ml": "2026-11-12", "tiktok": "2026-11-11"}
    assert out["esperado_ate"] == "2026-11-12"
    # A hora da carga continua la', separada da data do dado.
    assert out["refreshed_at"] == "2026-11-13T13:17:00Z"


def test_datetime_vira_data_e_sem_linha_e_none_nunca_hoje(monkeypatch):
    _instala(monkeypatch, [{
        "frescor_refreshed_at": None,
        "dados_ate_ml": datetime(2026, 11, 12, 0, 0),
        "dados_ate_tiktok": None,
    }])
    out = gs.get_operacoes(db=None)
    assert out["dados_ate"] == {"ml": "2026-11-12", "tiktok": None}

    _instala(monkeypatch, [])
    out = gs.get_operacoes(db=None)
    assert out["dados_ate"] == {"ml": None, "tiktok": None}
    assert out["esperado_ate"] == str(D_FECHADO)


def test_sql_le_max_da_data_no_escopo_e_teto_da_tela(monkeypatch):
    capturado = _instala(monkeypatch, [])
    gs.get_operacoes(db=None)
    sql = capturado["frescor"]
    assert "MAX(ref_date) FROM marts.fact_ml_gestao_diaria" in sql
    assert "MAX(date) FROM marts.fact_tiktok_creator_daily" in sql
    assert "MAX(date) FROM marts.fact_tiktok_brand_content_daily" in sql
    assert "AS dados_ate_ml" in sql and "AS dados_ate_tiktok" in sql
    # Nunca alem do D-1 e nunca o relogio do banco.
    assert f"'{HOJE}'" not in sql and "now()" not in sql.lower()
