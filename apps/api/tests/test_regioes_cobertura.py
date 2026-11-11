"""
REGIONAL-SOURCE-RECOVERY-2 — cobertura regional por canal.

Cenario real medido em 16/10/2026: ML carregado ate 15/10 e Shopee congelada
em 24/08 (fonte descontinuada, endereco mascarado na API). O `refreshed_at`
(instante da carga mais recente de QUALQUER canal) parecia saudavel e a
Shopee aparecia com 0 em set/out. Estes testes travam:

- status e `dados_ate` por canal, com motivo;
- `dados_completos_ate` = data ate a qual o TOTAL cobre todos os canais;
- ponto de tendencia marca os canais ausentes (ausencia, nao zero);
- o payload passa pelo `response_model` HTTP sem perder os campos.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.deps.period import EffectivePeriod
from app.main import app
from app.services import regioes_service as svc
from app.services.performance_service import ML_ID, SHOPEE_ID, TIKTOK_ID

HOJE = date(2026, 10, 16)
SET_OUT = EffectivePeriod(start=date(2026, 9, 1), end=date(2026, 10, 15))
CARGA_ATUAL = {ML_ID: date(2026, 10, 15), SHOPEE_ID: date(2026, 8, 24)}


def _por_canal(resultado):
    return {c["channel"]: c for c in resultado["cobertura_por_canal"]}


# ---------------------------------------------------------------------------
# build_cobertura_canais — puro
# ---------------------------------------------------------------------------
def test_ml_atual_e_shopee_defasada():
    r = svc.build_cobertura_canais([TIKTOK_ID, ML_ID, SHOPEE_ID], CARGA_ATUAL, SET_OUT, HOJE)
    c = _por_canal(r)

    assert c["ml"]["status"] == "atualizada"
    assert c["ml"]["dados_ate"] == date(2026, 10, 15)
    assert c["ml"]["motivo"] is None and c["ml"]["motivo_detalhe"] is None

    assert c["shopee"]["status"] == "defasada"
    assert c["shopee"]["dados_ate"] == date(2026, 8, 24)
    assert c["shopee"]["motivo"] == "carga_defasada"
    assert "mascarado" in c["shopee"]["motivo_detalhe"]

    assert c["tiktok"]["status"] == "sem_cobertura"
    assert c["tiktok"]["dados_ate"] is None
    assert c["tiktok"]["motivo"] == "sem_fonte_regional"

    # O total so' cobre TODOS os canais com fonte ate 24/08 — nao ate 15/10.
    assert r["dados_completos_ate"] == date(2026, 8, 24)
    assert r["canais_defasados"] == ["shopee"]
    assert r["canais_com_atraso"] == ["shopee"]


def test_data_recente_do_ml_nao_vira_data_do_total():
    """A regra que o PR precisa garantir: o ML em dia nunca empurra a data
    do total para frente enquanto a Shopee estiver parada."""
    r = svc.build_cobertura_canais([ML_ID, SHOPEE_ID], CARGA_ATUAL, SET_OUT, HOJE)
    assert r["dados_completos_ate"] != CARGA_ATUAL[ML_ID]
    assert r["dados_completos_ate"] == min(CARGA_ATUAL.values())


def test_esperado_ate_nunca_passa_de_d_menos_1():
    periodo_com_futuro = EffectivePeriod(start=date(2026, 10, 1), end=date(2026, 10, 31))
    r = svc.build_cobertura_canais([ML_ID], {ML_ID: date(2026, 10, 15)}, periodo_com_futuro, HOJE)
    assert _por_canal(r)["ml"]["esperado_ate"] == date(2026, 10, 15)
    assert _por_canal(r)["ml"]["status"] == "atualizada"


@pytest.mark.parametrize("dados_ate, status, motivo, grave", [
    (date(2026, 10, 15), "atualizada", None, False),          # D-1
    (date(2026, 10, 14), "atraso_leve", "carga_atrasada", False),  # D-2
    (date(2026, 10, 13), "defasada", "carga_defasada", True),  # D-3
])
def test_d1_atualizado_d2_atraso_leve_d3_defasado(dados_ate, status, motivo, grave):
    """Decisao RECOVERY-3: sem tolerancia. D-2 nunca e' 'atualizada'."""
    r = svc.build_cobertura_canais([ML_ID], {ML_ID: dados_ate}, SET_OUT, HOJE)
    ml = _por_canal(r)["ml"]
    assert ml["status"] == status
    assert ml["motivo"] == motivo
    assert (r["canais_defasados"] == ["ml"]) is grave
    assert (r["canais_com_atraso"] == ["ml"]) is (status != "atualizada")


def test_atraso_leve_nao_usa_o_motivo_estrutural_do_canal():
    """A Shopee com D-2 (se a fonte voltar) nao pode dizer 'fonte descontinuada'."""
    r = svc.build_cobertura_canais([SHOPEE_ID], {SHOPEE_ID: date(2026, 10, 14)}, SET_OUT, HOJE)
    shopee = _por_canal(r)["shopee"]
    assert shopee["status"] == "atraso_leve"
    assert "descontinuada" not in shopee["motivo_detalhe"]
    assert "ainda não chegou" in shopee["motivo_detalhe"]


def test_atraso_leve_tambem_marca_o_ultimo_ponto_como_ausente():
    cob = svc.build_cobertura_canais([ML_ID], {ML_ID: date(2026, 10, 14)}, SET_OUT, HOJE)["cobertura_por_canal"]
    assert svc.canais_ausentes_no_bucket(cob, date(2026, 10, 14)) == []
    assert svc.canais_ausentes_no_bucket(cob, date(2026, 10, 15)) == ["ml"]


def test_periodo_anterior_ao_congelamento_e_shopee_atualizada():
    julho = EffectivePeriod(start=date(2026, 7, 1), end=date(2026, 7, 31))
    r = svc.build_cobertura_canais([ML_ID, SHOPEE_ID], CARGA_ATUAL, julho, HOJE)
    assert _por_canal(r)["shopee"]["status"] == "atualizada"
    assert _por_canal(r)["shopee"]["motivo_detalhe"] is None
    assert r["canais_defasados"] == []


def test_canal_sem_nenhuma_carga_e_sem_carga_e_anula_a_data_do_total():
    r = svc.build_cobertura_canais([ML_ID, SHOPEE_ID], {ML_ID: date(2026, 10, 15)}, SET_OUT, HOJE)
    assert _por_canal(r)["shopee"]["status"] == "sem_carga"
    assert _por_canal(r)["shopee"]["dados_ate"] is None
    assert r["dados_completos_ate"] is None
    assert r["canais_defasados"] == ["shopee"]


def test_so_tiktok_nao_tem_data_de_total():
    r = svc.build_cobertura_canais([TIKTOK_ID], {}, SET_OUT, HOJE)
    assert r["dados_completos_ate"] is None
    assert r["canais_defasados"] == []


def test_canais_ausentes_no_bucket_diario_e_mensal():
    cob = svc.build_cobertura_canais([TIKTOK_ID, ML_ID, SHOPEE_ID], CARGA_ATUAL, SET_OUT, HOJE)["cobertura_por_canal"]
    assert svc.canais_ausentes_no_bucket(cob, date(2026, 8, 24)) == []
    assert svc.canais_ausentes_no_bucket(cob, date(2026, 8, 25)) == ["shopee"]
    # Agosto mensal termina em 31/08: Shopee so' tem ate 24/08 -> ponto parcial.
    fim_agosto = svc._fim_do_bucket(date(2026, 8, 1), "month", date(2026, 10, 15))
    assert fim_agosto == date(2026, 8, 31)
    assert svc.canais_ausentes_no_bucket(cob, fim_agosto) == ["shopee"]
    # TikTok nunca entra: a ausencia dele e' estrutural e ja tem campo proprio.
    assert "tiktok" not in svc.canais_ausentes_no_bucket(cob, date(2026, 10, 15))


# ---------------------------------------------------------------------------
# Integracao com as consultas (Session falsa)
# ---------------------------------------------------------------------------
class _Result:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    """Responde pela FORMA da consulta, nao pela ordem — o teste nao quebra
    se a ordem das consultas mudar."""

    def __init__(self, principal, dados_ate, refreshed_at):
        self.principal, self.dados_ate, self.refreshed_at = principal, dados_ate, refreshed_at

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "MAX(f.date) AS dados_ate" in sql:
            return _Result(self.dados_ate)
        if "MAX(f.ingested_at) AS refreshed_at" in sql:
            return _Result([{"refreshed_at": self.refreshed_at}])
        return _Result(self.principal)


DADOS_ATE_ROWS = [
    {"marketplace_id": ML_ID, "dados_ate": date(2026, 10, 15)},
    {"marketplace_id": SHOPEE_ID, "dados_ate": date(2026, 8, 24)},
]
CARGA_RECENTE_ML = datetime(2026, 10, 16, 9, 30, tzinfo=timezone.utc)
SUMMARY_ROW = [{
    "bucket": date(2026, 9, 10),  # lido so' pela tendencia
    "gmv": 1000.0, "orders": 10, "units_sold": 0, "ufs_com_venda": 3,
    "uf_known_orders": 10, "uf_eligible_orders": 10,
    "shipping_cost_covered_orders": 10, "shipping_cost_eligible_orders": 10,
    "seller_shipping_cost": 50.0,
}]


def test_summary_expoe_cobertura_e_nao_deixa_refreshed_at_falar_pelo_total():
    db = _Session(SUMMARY_ROW, DADOS_ATE_ROWS, CARGA_RECENTE_ML)
    r = svc.get_summary(db, [TIKTOK_ID, ML_ID, SHOPEE_ID], None, SET_OUT, channels="all", hoje=HOJE)

    assert r["refreshed_at"].startswith("2026-10-16")  # a carga do ML e' recente...
    assert r["dados_completos_ate"] == date(2026, 8, 24)  # ...mas o total nao.
    assert r["canais_defasados"] == ["shopee"]
    assert _por_canal(r)["shopee"]["status"] == "defasada"
    assert r["channels_sem_cobertura_regional"] == ["tiktok"]


def test_trend_marca_shopee_ausente_nos_dias_apos_o_congelamento():
    periodo = EffectivePeriod(start=date(2026, 8, 23), end=date(2026, 8, 26))
    rows = [{"bucket": date(2026, 8, d), "gmv": 10.0, "orders": 1,
             "uf_known_orders": 1, "uf_eligible_orders": 1} for d in (23, 24, 25, 26)]
    db = _Session(rows, DADOS_ATE_ROWS, CARGA_RECENTE_ML)
    r = svc.get_trend(db, [ML_ID, SHOPEE_ID], None, periodo, hoje=HOJE)
    assert [p["canais_ausentes"] for p in r["data"]] == [[], [], ["shopee"], ["shopee"]]


def test_brand_filter_tambem_chega_na_consulta_de_dados_ate():
    capturados = []

    class _Captura(_Session):
        def execute(self, stmt, params=None):
            if "MAX(f.date) AS dados_ate" in str(stmt):
                capturados.append(params)
            return super().execute(stmt, params)

    db = _Captura(SUMMARY_ROW, DADOS_ATE_ROWS, None)
    svc.get_summary(db, [ML_ID, SHOPEE_ID], ["barbours"], SET_OUT, hoje=HOJE)
    assert capturados and capturados[0]["brand_keys"] == ["barbours"]
    assert "start" not in capturados[0]  # dados_ate nunca e' recortado pelo periodo


# ---------------------------------------------------------------------------
# Borda HTTP — o response_model preserva os campos novos
# ---------------------------------------------------------------------------
@pytest.fixture
def client_com_carga_atual(monkeypatch):
    monkeypatch.setattr(svc, "today_brt", lambda: HOJE)
    app.dependency_overrides[get_db] = lambda: _Session(SUMMARY_ROW, DADOS_ATE_ROWS, CARGA_RECENTE_ML)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_http_summary_serializa_cobertura_por_canal(client_com_carga_atual):
    resp = client_com_carga_atual.get(
        "/api/v1/regioes/summary",
        params={"channels": "tiktok,ml,shopee", "date_from": "2026-09-01", "date_to": "2026-10-15"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dados_completos_ate"] == "2026-08-24"
    assert body["canais_defasados"] == ["shopee"]
    shopee = next(c for c in body["cobertura_por_canal"] if c["channel"] == "shopee")
    assert shopee == {
        "channel": "shopee", "marketplace_id": SHOPEE_ID, "status": "defasada",
        "dados_ate": "2026-08-24", "esperado_ate": "2026-10-15",
        "motivo": "carga_defasada", "motivo_detalhe": shopee["motivo_detalhe"],
    }
    assert shopee["motivo_detalhe"]


def test_http_trend_serializa_canais_ausentes(client_com_carga_atual):
    resp = client_com_carga_atual.get(
        "/api/v1/regioes/trend",
        params={"channels": "ml,shopee", "date_from": "2026-09-01", "date_to": "2026-10-15"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["canais_defasados"] == ["shopee"]
    assert all(p["canais_ausentes"] == ["shopee"] for p in body["data"])


# ---------------------------------------------------------------------------
# T-0088 — `coverage_level` segue o frescor por canal
#
# Medido em producao em 11/11/2026, out/2026, ml+shopee: UF 100% preenchida
# nos pedidos CARREGADOS, mas o ML so' tem dado ate 25/10 e a Shopee ate 24/08.
# A API devolvia `coverage_level "ok"` com os dois canais `defasada`.
# ---------------------------------------------------------------------------
HOJE_T0088 = date(2026, 11, 11)
OUTUBRO = EffectivePeriod(start=date(2026, 10, 1), end=date(2026, 10, 31))
DADOS_ATE_PROD = [
    {"marketplace_id": ML_ID, "dados_ate": date(2026, 10, 25)},
    {"marketplace_id": SHOPEE_ID, "dados_ate": date(2026, 8, 24)},
]
SUMMARY_UF_CHEIA = [{
    "gmv": 5000.0, "orders": 50, "units_sold": 60, "ufs_com_venda": 20,
    "uf_known_orders": 50, "uf_eligible_orders": 50,
    "shipping_cost_covered_orders": 50, "shipping_cost_eligible_orders": 50,
    "seller_shipping_cost": 300.0,
}]


def _canal(channel, status):
    return {"channel": channel, "status": status}


@pytest.mark.parametrize("statuses, esperado", [
    ([("ml", "atualizada"), ("shopee", "atualizada")], "ok"),
    ([("ml", "atraso_leve"), ("shopee", "atualizada")], "ok"),     # D-2 nao rebaixa
    ([("ml", "atualizada"), ("shopee", "defasada")], "partial"),
    ([("ml", "atualizada"), ("shopee", "sem_carga")], "partial"),
    ([("ml", "atraso_leve"), ("shopee", "defasada")], "partial"),
    ([("ml", "defasada"), ("shopee", "defasada")], "low"),
    ([("ml", "defasada"), ("shopee", "sem_carga")], "low"),
    ([("tiktok", "sem_cobertura"), ("ml", "defasada")], "low"),   # TikTok nao conta
    ([("tiktok", "sem_cobertura")], "ok"),                        # sem frescor a cobrar
])
def test_coverage_level_frescor(statuses, esperado):
    assert svc.coverage_level_frescor([_canal(c, s) for c, s in statuses]) == esperado


@pytest.mark.parametrize("uf, frescor, esperado", [
    ("ok", "ok", "ok"),
    ("partial", "ok", "partial"),
    ("not_applicable", "ok", "not_applicable"),
    ("ok", "partial", "partial"),
    ("ok", "low", "low"),
    ("low", "partial", "low"),            # o pior vence, nunca melhora a UF
    ("not_applicable", "partial", "partial"),
    ("not_applicable", "low", "low"),
])
def test_pior_coverage_level(uf, frescor, esperado):
    assert svc.pior_coverage_level(uf, frescor) == esperado


def test_t0088_summary_out_2026_com_os_dois_canais_defasados_nao_e_ok():
    db = _Session(SUMMARY_UF_CHEIA, DADOS_ATE_PROD, CARGA_RECENTE_ML)
    r = svc.get_summary(db, [ML_ID, SHOPEE_ID], None, OUTUBRO, channels="ml,shopee", hoje=HOJE_T0088)

    assert r["uf_fill_pct"] == 100.0           # significado de uf_fill_pct intacto
    assert r["uf_coverage_level"] == "ok"      # o nivel so' de UF continua exposto
    assert r["coverage_level"] != "ok"
    assert r["coverage_level"] == "low"        # todos os canais com fonte defasados
    assert r["coverage_warning"] is True
    assert r["canais_defasados"] == ["ml", "shopee"]
    assert {c["channel"]: c["dados_ate"] for c in r["cobertura_por_canal"]} == {
        "ml": date(2026, 10, 25), "shopee": date(2026, 8, 24),
    }
    # Estrutural continua so' TikTok — e TikTok nao foi pedido.
    assert r["channels_sem_cobertura_regional"] == []


def test_t0088_so_um_canal_defasado_e_parcial_e_tiktok_segue_estrutural():
    db = _Session(SUMMARY_UF_CHEIA, DADOS_ATE_ROWS, CARGA_RECENTE_ML)
    r = svc.get_summary(db, [TIKTOK_ID, ML_ID, SHOPEE_ID], None, SET_OUT, channels="all", hoje=HOJE)

    assert r["coverage_level"] == "partial"
    assert r["uf_coverage_level"] == "ok"
    assert r["canais_defasados"] == ["shopee"]
    assert r["channels_sem_cobertura_regional"] == ["tiktok"]


def test_t0088_sem_defasagem_continua_ok():
    em_dia = [{"marketplace_id": m, "dados_ate": date(2026, 10, 15)} for m in (ML_ID, SHOPEE_ID)]
    db = _Session(SUMMARY_UF_CHEIA, em_dia, CARGA_RECENTE_ML)
    r = svc.get_summary(db, [ML_ID, SHOPEE_ID], None, SET_OUT, hoje=HOJE)

    assert r["coverage_level"] == "ok"
    assert r["uf_coverage_level"] == "ok"
    assert r["coverage_warning"] is False
    assert r["canais_defasados"] == []


def test_t0088_atraso_leve_nao_rebaixa_o_nivel():
    d2 = [{"marketplace_id": ML_ID, "dados_ate": date(2026, 10, 14)}]
    db = _Session(SUMMARY_UF_CHEIA, d2, CARGA_RECENTE_ML)
    r = svc.get_summary(db, [ML_ID], None, SET_OUT, hoje=HOJE)
    assert r["canais_com_atraso"] == ["ml"]
    assert r["coverage_level"] == "ok"


def test_t0088_uf_baixa_continua_baixa_mesmo_com_canal_em_dia():
    linha = [{**SUMMARY_UF_CHEIA[0], "uf_known_orders": 10, "uf_eligible_orders": 50}]
    em_dia = [{"marketplace_id": ML_ID, "dados_ate": date(2026, 10, 15)}]
    r = svc.get_summary(_Session(linha, em_dia, None), [ML_ID], None, SET_OUT, hoje=HOJE)
    assert r["coverage_level"] == "low"
    assert r["uf_coverage_level"] == "low"


def test_t0088_by_uf_rebaixa_toda_uf_com_o_frescor_do_pedido():
    rows = [{"uf": "SP", "gmv": 100.0, "orders": 5, "units_sold": 5, "canceled_orders": 0,
             "returned_orders": 0, "seller_shipping_cost": None, "uf_known_orders": 5,
             "uf_eligible_orders": 5, "shipping_cost_covered_orders": 0, "shipping_cost_eligible_orders": 0}]
    db = _Session(rows, DADOS_ATE_PROD, CARGA_RECENTE_ML)
    r = svc.get_by_uf(db, [ML_ID, SHOPEE_ID], None, OUTUBRO, hoje=HOJE_T0088)
    sp = r["data"][0]
    assert sp["uf_fill_pct"] == 100.0
    assert sp["uf_coverage_level"] == "ok"
    assert sp["coverage_level"] == "low"
    assert sp["coverage_warning"] is True


def test_t0088_by_brand_usa_o_frescor_do_canal_da_linha():
    rows = [
        {"brand_key": "barbours", "marketplace_id": m, "gmv": 100.0, "orders": 5, "units_sold": 5,
         "uf_known_orders": 5, "uf_eligible_orders": 5,
         "shipping_cost_covered_orders": 5, "shipping_cost_eligible_orders": 5}
        for m in (ML_ID, SHOPEE_ID)
    ]
    # ML em dia, Shopee congelada: so' a linha da Shopee cai.
    db = _Session(rows, DADOS_ATE_ROWS, None)
    r = svc.get_by_brand(db, [ML_ID, SHOPEE_ID], None, SET_OUT, hoje=HOJE)
    nivel = {row["marketplace"]: row["coverage_level"] for row in r["data"]}
    assert nivel == {"ml": "ok", "shopee": "low"}
    assert all(row["uf_coverage_level"] == "ok" for row in r["data"])


@pytest.fixture
def client_out_2026(monkeypatch):
    monkeypatch.setattr(svc, "today_brt", lambda: HOJE_T0088)
    app.dependency_overrides[get_db] = lambda: _Session(SUMMARY_UF_CHEIA, DADOS_ATE_PROD, CARGA_RECENTE_ML)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_http_t0088_summary_nao_devolve_ok_com_canal_defasado(client_out_2026):
    resp = client_out_2026.get(
        "/api/v1/regioes/summary",
        params={"channels": "ml,shopee", "date_from": "2026-10-01", "date_to": "2026-10-31"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["coverage_level"] == "low"
    assert body["uf_coverage_level"] == "ok"
    assert body["coverage_warning"] is True
    assert body["canais_defasados"] == ["ml", "shopee"]
    assert body["channels_sem_cobertura_regional"] == []
