"""T-0117 (A2-104) — oferta da MESMA carga nao conta como atrasada.

Medido em 13/11 na Shopee: a ingestao carimba `ingested_at` por linha ao longo
de ate' ~30 min dentro da carga de uma conta. Com `ingested_at >= watermark`
exato, 444 das 618 ofertas `stale` eram da propria carga (ex.: item
21398274894 ingerido 46 s antes do watermark da barbours). A regra agora
compara com o INICIO da ultima carga da conta (`load_started_at`), identificado
na fonte pelo buraco de `SHOPEE_LOAD_GAP_MINUTES` sem gravacao.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from apps.api.app.services import pma_domain as dom
from pipelines import channel_offer_sync as cos

# Forma da barbours em 13/11: carga das 08:45 as 09:12:09Z.
WATERMARK = datetime(2026, 11, 13, 9, 12, 9, tzinfo=timezone.utc)
INICIO_CARGA = datetime(2026, 11, 13, 8, 45, 0, tzinfo=timezone.utc)


def _relogio(load_started_at=INICIO_CARGA):
    return cos.AccountClock("shopee", "barbours", WATERMARK, rows_seen=318,
                            load_started_at=load_started_at)


def test_oferta_da_mesma_carga_minutos_antes_do_watermark_nao_e_atrasada():
    relogio = _relogio()
    # 46 s antes do watermark (o item 21398274894) e 27 min antes (inicio da carga).
    assert relogio.snapshot_status_for(WATERMARK - timedelta(seconds=46)) == dom.SNAPSHOT_CURRENT
    assert relogio.snapshot_status_for(INICIO_CARGA) == dom.SNAPSHOT_CURRENT
    assert relogio.snapshot_status_for(WATERMARK) == dom.SNAPSHOT_CURRENT


def test_oferta_de_carga_anterior_e_atrasada():
    relogio = _relogio()
    assert relogio.snapshot_status_for(INICIO_CARGA - timedelta(seconds=1)) == dom.SNAPSHOT_STALE
    # A carga de ontem (as 174 linhas sem toque ha' mais de 24 h).
    assert relogio.snapshot_status_for(WATERMARK - timedelta(days=1)) == dom.SNAPSHOT_STALE
    assert relogio.snapshot_status_for(None) == dom.SNAPSHOT_STALE


def test_contraprova_sem_inicio_de_carga_vale_a_regra_antiga_do_watermark_exato():
    """Sem `load_started_at` (TikTok, leitor antigo) a regra e' a anterior —
    e ela marca a linha da mesma carga como atrasada: o defeito do A2-104."""
    antigo = _relogio(load_started_at=None)
    assert antigo.snapshot_status_for(WATERMARK - timedelta(seconds=46)) == dom.SNAPSHOT_STALE
    assert antigo.snapshot_status_for(WATERMARK) == dom.SNAPSHOT_CURRENT


def test_inicio_de_carga_depois_do_watermark_nunca_afrouxa_nem_aperta_alem_do_watermark():
    inconsistente = _relogio(load_started_at=WATERMARK + timedelta(hours=1))
    assert inconsistente.snapshot_status_for(WATERMARK) == dom.SNAPSHOT_CURRENT
    assert inconsistente.snapshot_status_for(WATERMARK - timedelta(seconds=1)) == dom.SNAPSHOT_STALE


def test_conta_parada_e_fotografia_parcial_continuam_iguais():
    assert cos.AccountClock("shopee", "x", None, load_started_at=INICIO_CARGA) \
        .snapshot_status_for(WATERMARK) == dom.SNAPSHOT_ACCOUNT_DID_NOT_RUN
    assert cos.AccountClock("shopee", "x", WATERMARK, complete=False,
                            load_started_at=INICIO_CARGA) \
        .snapshot_status_for(WATERMARK) == dom.SNAPSHOT_PARTIAL_LOAD


def test_build_shopee_records_usa_o_inicio_da_carga():
    relogios = {"barbours": _relogio()}
    base = {
        "is_model": False, "has_model": False, "shop_account": "barbours",
        "model_id": None, "brand": "barbours", "seller_sku": "SKU", "gtin": None,
        "listing_title": "Geleia", "is_kit": False, "internal_is_kit": None,
        "internal_has_bom": None, "is_active": True,
        "current_price": Decimal("19.90"), "original_price": Decimal("70.90"),
        "promotion_id": None, "discount_pct": None,
    }
    linhas = [
        {**base, "item_id": 21398274894, "ingested_at": WATERMARK - timedelta(seconds=46)},
        {**base, "item_id": 1, "ingested_at": WATERMARK - timedelta(days=2)},
    ]
    registros = {r["parent_item_id"]: r for r in cos.build_shopee_records(linhas, relogios)}
    assert registros["21398274894"]["snapshot_status"] == dom.SNAPSHOT_CURRENT
    assert registros["1"]["snapshot_status"] == dom.SNAPSHOT_STALE
    # O watermark publicado continua o FIM da carga (trava de regressao intacta).
    assert registros["21398274894"]["account_watermark_at"] == WATERMARK


class _Cursor:
    def __init__(self, linhas, log):
        self._linhas, self._log = linhas, log

    def execute(self, sql, params=None):
        self._log.append(sql)

    def fetchall(self):
        return self._linhas

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Conexao:
    def __init__(self, linhas):
        self.linhas, self.log = linhas, []

    def cursor(self, cursor_factory=None):
        return _Cursor(self.linhas, self.log)


def test_load_shopee_account_clocks_le_o_inicio_da_carga():
    conn = _Conexao([{"shop_account": "barbours", "watermark_at": WATERMARK,
                      "rows_seen": 318, "load_started_at": INICIO_CARGA}])
    relogio = cos.load_shopee_account_clocks(conn)["barbours"]
    assert relogio.load_started_at == INICIO_CARGA
    assert relogio.watermark_at == WATERMARK
    assert conn.log == [cos.SQL_SHOPEE_ACCOUNT_CLOCKS]


def test_sql_identifica_a_carga_pelo_buraco_nomeado_por_conta():
    sql = cos.SQL_SHOPEE_ACCOUNT_CLOCKS
    assert "load_started_at" in sql
    assert "lag(ingested_at) OVER (PARTITION BY shop_account" in sql
    assert f"interval '{cos.SHOPEE_LOAD_GAP_MINUTES} minutes'" in sql
    # A tolerancia e' maior que o espalhamento medido (~30 min) e bem menor
    # que o intervalo entre cargas diarias.
    assert 30 < cos.SHOPEE_LOAD_GAP_MINUTES < 24 * 60
