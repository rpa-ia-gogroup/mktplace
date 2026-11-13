"""T-0107b — o incremental nao completa conta nova (causa do B2-06).

Conta com pedido na silver ANTES da janela incremental e nenhuma linha no
destino antes dela: o `--apply` RECUSA (fail-closed) e o dry-run AVISA. Sem
banco real: reaproveita os fakes de `test_sync_shopee_fbs_execucao`.
"""
from __future__ import annotations

from datetime import date

import pytest

from pipelines import sync_shopee_fbs_daily as mod
from pipelines.tests.test_sync_shopee_fbs_execucao import (
    AGORA, FakeConn, FakeResult, FakeSession, Trace, _linha_fonte,
)

# AGORA = 2026-09-16 12:00 UTC -> janela incremental 2026-08-31..2026-09-15.
DATE_FROM = date(2026, 8, 31)
NORMAIS = ("apice", "barbours", "lescent", "rituaria")


class ConnContaNova(FakeConn):
    """FakeConn que responde as duas consultas novas."""

    def __init__(self, *a, silver_antes=None, destino_antes=None, **kw):
        super().__init__(*a, **kw)
        self.silver_antes = silver_antes or {}
        self.destino_antes = destino_antes or ()

    def execute(self, sql, params=None):
        txt = str(getattr(sql, "text", sql))
        if "primeiro_dia_silver" in txt:
            self.trace.reg(f"{self.rotulo}:silver_antes")
            assert params["date_from"] == DATE_FROM
            return FakeResult(linhas=[
                {"shop_account": c, "primeiro_dia_silver": d}
                for c, d in self.silver_antes.items()])
        if "SELECT DISTINCT shop_account" in txt:
            self.trace.reg(f"{self.rotulo}:destino_antes")
            assert params["date_from"] == DATE_FROM
            return FakeResult(linhas=[{"shop_account": c}
                                      for c in self.destino_antes])
        return super().execute(sql, params)


def _monta(monkeypatch, trace, silver_antes, destino_antes):
    lock = FakeConn(trace, "lock")
    audit = ConnContaNova(trace, "audit", destino_antes=destino_antes)
    pub = ConnContaNova(trace, "pub", destino_antes=destino_antes)
    dm = ConnContaNova(trace, "dm", fonte_linhas=[_linha_fonte()],
                       silver_antes=silver_antes)
    monkeypatch.setattr(mod, "_conn_lock", lambda: lock)
    n = {"n": 0}

    def neon():
        n["n"] += 1
        return (FakeSession(trace, audit, "audit") if n["n"] == 1
                else FakeSession(trace, pub, "pub"))

    return neon, lambda: FakeSession(trace, dm, "dm")


def _run(monkeypatch, apply, silver_antes, destino_antes):
    t = Trace()
    neon, dm = _monta(monkeypatch, t, silver_antes, destino_antes)
    res = mod.run(mode=mod.MODE_INCREMENTAL, apply=apply, agora=AGORA,
                  neon_factory=neon, dm_factory=dm)
    return t, res


SILVER_COM_KOKESHI = {**{c: date(2026, 1, 1) for c in NORMAIS},
                      "kokeshi": date(2026, 8, 1)}


# (a) conta nova COM historico anterior a janela -----------------------------

def test_a_apply_recusa_conta_nova_com_historico_anterior(monkeypatch):
    t = Trace()
    neon, dm = _monta(monkeypatch, t, SILVER_COM_KOKESHI, NORMAIS)
    with pytest.raises(mod.ContaSemHistoricoError) as exc:
        mod.run(mode=mod.MODE_INCREMENTAL, apply=True, agora=AGORA,
                neon_factory=neon, dm_factory=dm)
    msg = str(exc.value)
    assert "kokeshi" in msg and "2026-08-01" in msg
    assert "--mode full" in msg
    assert "marketplace_tower_shopee_fbs_reparo_manual_" in msg
    for c in NORMAIS:
        assert c not in msg
    # Recusa ANTES de qualquer escrita, com rollback e auditoria `failed`.
    assert t.tem("pub:destino_antes")
    assert not any("DELETE" in e or "CREATE TEMP" in e for e in t.eventos)
    assert not t.tem("pub:COMMIT")
    assert t.tem("pub:ROLLBACK")
    assert t.tem("audit:UPDATE audit")
    assert t.tem("lock:SELECT pg_advisory_unlock")


def test_a_main_devolve_codigo_de_recusa(monkeypatch):
    t = Trace()
    neon, dm = _monta(monkeypatch, t, SILVER_COM_KOKESHI, NORMAIS)
    monkeypatch.setattr(mod, "LocalSession", neon)
    monkeypatch.setattr(mod, "DataMartSession", dm)
    assert mod.main(["--apply"]) == 1


def test_a_dry_run_avisa_e_nao_recusa(monkeypatch):
    t, res = _run(monkeypatch, False, SILVER_COM_KOKESHI, NORMAIS)
    assert res["applied"] is False
    avisos = [w for w in res["warnings"] if "RECUSADO" in w]
    assert len(avisos) == 1
    assert "kokeshi" in avisos[0] and "2026-08-01" in avisos[0]
    assert "--mode full" in avisos[0]
    assert t.tem("audit:destino_antes")
    assert not any("COMMIT" in e for e in t.eventos)


# (b) contas normais: nada muda -----------------------------------------------

def test_b_contas_normais_publicam_sem_aviso(monkeypatch):
    silver = {c: date(2026, 1, 1) for c in mod.CONTAS_ESPERADAS}
    t, res = _run(monkeypatch, True, silver, mod.CONTAS_ESPERADAS)
    assert res["applied"] is True
    assert t.tem("pub:COMMIT")
    assert not any("RECUSADO" in w for w in res["warnings"])

    _, seco = _run(monkeypatch, False, silver, mod.CONTAS_ESPERADAS)
    assert not any("RECUSADO" in w for w in seco["warnings"])


# (c) conta nova SEM historico anterior: comecou dentro da janela ------------

def test_c_conta_que_comecou_na_janela_nao_recusa(monkeypatch):
    silver = {c: date(2026, 1, 1) for c in NORMAIS}   # kokeshi so' na janela
    t, res = _run(monkeypatch, True, silver, NORMAIS)
    assert res["applied"] is True
    assert t.tem("pub:COMMIT")

    _, seco = _run(monkeypatch, False, silver, NORMAIS)
    assert not any("RECUSADO" in w for w in seco["warnings"])


def test_full_nao_consulta_historico_anterior(monkeypatch):
    """O modo full comeca no piso: nao existe 'antes da janela'."""
    t = Trace()
    neon, dm = _monta(monkeypatch, t, SILVER_COM_KOKESHI, ())
    res = mod.run(mode=mod.MODE_FULL, apply=True, agora=AGORA,
                  neon_factory=neon, dm_factory=dm)
    assert res["applied"] is True
    assert not t.tem("dm:silver_antes") and not t.tem("pub:destino_antes")


def test_silver_respeita_o_piso_historico():
    assert ":piso" in mod.SQL_SILVER_ANTES_DA_JANELA.text
    assert "< :date_from" in mod.SQL_DESTINO_ANTES_DA_JANELA.text
