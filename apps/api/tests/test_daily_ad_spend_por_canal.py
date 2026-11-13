"""
T-0113 — Ads POR CANAL na serie diaria (`get_daily`).

O ROAS da Marca 360 dividia o GMV de todos os canais selecionados pelo
`ad_spend` combinado (ML + Shopee, sem dizer de qual canal veio). Para casar
numerador e denominador no mesmo conjunto de canais, cada dia ganha campos
ADITIVOS `ml_ad_spend` e `shopee_ad_spend`. Estes testes travam:

1. canal sem linha de Ads no dia -> None (nunca 0 inventado);
2. `ad_spend` NULL na fonte -> None; 0 gravado na fonte -> 0;
3. o `ad_spend` combinado continua exatamente igual ao de antes;
4. o TikTok continua sem Ads na serie diaria.

Testam o retorno do SERVICO (dict); nenhum banco e' tocado.
"""
from datetime import date

from app.services import performance_service as perf_svc

HOJE = date(2026, 11, 9)
D1 = date(2026, 10, 1)
D2 = date(2026, 10, 2)
D3 = date(2026, 10, 3)


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return None


class FakeSession:
    """Devolve as linhas na ordem do `ORDER BY f.date, f.marketplace_id`."""

    def __init__(self, rows):
        self.rows = sorted(rows, key=lambda r: (r["date"], r["marketplace_id"]))

    def execute(self, stmt, params=None):
        return _Rows(self.rows)


def _linha(d, mkt, gmv, ad_spend=None):
    return {"date": d, "marketplace_id": mkt, "gmv": gmv, "orders": 1, "ad_spend": ad_spend}


def _por_dia(rows, marketplace="all"):
    res = perf_svc.get_daily(FakeSession(rows), "apice", marketplace, today=HOJE)
    return {r["date"]: r for r in res["data"]}


def test_dia_so_com_ads_shopee_ml_fica_none():
    dias = _por_dia([
        _linha(D1, perf_svc.ML_ID, 1000),  # ML com linha de GMV, Ads NULL
        _linha(D1, perf_svc.SHOPEE_ID, 2000, 150),
    ])
    assert dias[D1]["ml_ad_spend"] is None
    assert dias[D1]["shopee_ad_spend"] == 150.0
    assert dias[D1]["ad_spend"] == 150.0


def test_dia_so_shopee_sem_linha_ml():
    dias = _por_dia([_linha(D1, perf_svc.SHOPEE_ID, 2000, 80)])
    assert dias[D1]["ml_ad_spend"] is None
    assert dias[D1]["shopee_ad_spend"] == 80.0


def test_dia_com_os_dois_canais():
    dias = _por_dia([
        _linha(D1, perf_svc.ML_ID, 1000, 100),
        _linha(D1, perf_svc.SHOPEE_ID, 2000, 50),
    ])
    assert dias[D1]["ml_ad_spend"] == 100.0
    assert dias[D1]["shopee_ad_spend"] == 50.0
    assert dias[D1]["ad_spend"] == 150.0


def test_dia_sem_ads_tudo_none():
    dias = _por_dia([
        _linha(D1, perf_svc.TIKTOK_ID, 500),
        _linha(D1, perf_svc.ML_ID, 1000),
        _linha(D1, perf_svc.SHOPEE_ID, 2000),
    ])
    assert dias[D1]["ml_ad_spend"] is None
    assert dias[D1]["shopee_ad_spend"] is None
    assert dias[D1]["ad_spend"] is None


def test_zero_gravado_na_fonte_e_zero_no_canal():
    """0 da fonte e' medido: o campo por canal devolve 0. O combinado mantem a
    regra antiga (0 -> None) — contrato inalterado."""
    dias = _por_dia([
        _linha(D1, perf_svc.ML_ID, 1000, 0),
        _linha(D1, perf_svc.SHOPEE_ID, 2000, 0),
    ])
    assert dias[D1]["ml_ad_spend"] == 0.0
    assert dias[D1]["shopee_ad_spend"] == 0.0
    assert dias[D1]["ad_spend"] is None


def test_tiktok_nao_ganha_ads_na_serie():
    dias = _por_dia([_linha(D1, perf_svc.TIKTOK_ID, 500, 999)], marketplace="tiktok")
    assert dias[D1]["ml_ad_spend"] is None
    assert dias[D1]["shopee_ad_spend"] is None
    assert dias[D1]["ad_spend"] is None
    assert "tiktok_ad_spend" not in dias[D1]


def test_ad_spend_combinado_igual_ao_de_antes():
    """O `ad_spend` combinado e' a mesma conta de antes da T-0113 (ML + Shopee,
    0 -> None, TikTok descartado) e bate com a soma dos campos por canal."""
    rows = [
        _linha(D1, perf_svc.ML_ID, 1000, 100),
        _linha(D1, perf_svc.SHOPEE_ID, 2000, 50),
        _linha(D1, perf_svc.TIKTOK_ID, 500, 999),
        _linha(D2, perf_svc.SHOPEE_ID, 2000, 70),
        _linha(D2, perf_svc.ML_ID, 1000),
        _linha(D3, perf_svc.ML_ID, 1000, 40),
        _linha(D3, perf_svc.SHOPEE_ID, 2000, 0),
    ]
    dias = _por_dia(rows)
    assert [dias[d]["ad_spend"] for d in (D1, D2, D3)] == [150.0, 70.0, 40.0]
    for d in (D1, D2, D3):
        soma = (dias[d]["ml_ad_spend"] or 0) + (dias[d]["shopee_ad_spend"] or 0)
        assert (soma or None) == dias[d]["ad_spend"]
    # GMV, pedidos e ticket nao mudam com os campos novos
    assert dias[D1]["total_gmv"] == 3500.0
    assert dias[D1]["orders"] == 3
