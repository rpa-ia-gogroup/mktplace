"""T-0068 — receita TikTok da DRE sem o frete pago pelo comprador.

O GMV TikTok (`SUM(total_amount)`) contem o frete pago pelo comprador, e o
frete da DRE (`shipping_cost_amount` do repasse) ja' vem liquido dele: a margem
contava esse frete duas vezes. Decisao D6 opcao (a), via B: a receita passa a
ser GMV − `buyer_shipping_fee` da fato de descontos, so' quando o dado existe.

O que se prova:
  * com o frete presente em todos os dias com GMV, a receita cai pelo valor e a
    margem cai pelo MESMO valor;
  * coluna ausente (Neon antes da 041), dia nulo ou sem linha: receita igual a
    de hoje, com o motivo explicito;
  * a razao do CMV continua sobre o GMV do mart;
  * ML e Shopee nao mudam;
  * a rota le a coluna so' depois de confirmar que ela existe.

Numeros SINTETICOS (repo publico): a celula e' set/barbours, os valores nao.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from app import database
from app.database import get_db
from app.main import app
from app.routers import dre as dre_router
from app.services import dre_service as dre
from fastapi.testclient import TestClient

from tests.test_dre_mvp import (
    FakeNeon,
    _DataMartQueExplode,
    afiliado,
    cmv,
    mart,
    repasse,
)

SET = date(2026, 9, 1)
#: Setembro maduro (M+2 = novembro terminou).
HOJE = date(2026, 12, 15)
AGORA = datetime(2026, 12, 15, 12, 0, tzinfo=timezone.utc)
PUB = AGORA - timedelta(hours=6)
GMV = 2_000_000.0
FRETE_COMPRADOR = 40_000.0


def _mart(canal="tiktok", gmv=GMV):
    return mart(canal, marca="barbours", mes=SET, dias=30, gmv=gmv)


def _frete(dias_com_gmv=30, dias_com_frete=30, frete=FRETE_COMPRADOR):
    return {"mes": SET, "marca": "barbours", "dias_com_gmv": dias_com_gmv,
            "dias_com_frete": dias_com_frete, "frete": frete}


def _insumos(canal="tiktok"):
    linhas = cmv(canal, marca="barbours", mes=SET, receita_fiscal=GMV, custo=600_000.0, publicado_em=PUB)
    if canal == "tiktok":
        linhas += repasse(marca="barbours", mes=SET, publicado_em=PUB)
    return linhas


def celula(frete=None, coluna=True, canal="tiktok", gmv=GMV):
    cmv_idx, rep_idx = dre.indexar_insumos(_insumos(canal), AGORA)
    k = (SET, canal, "barbours")
    ins = dre.InsumosCelula(
        mes=SET, canal=canal, marca="barbours", mart=_mart(canal, gmv),
        afiliado=afiliado(marca="barbours", mes=SET) if canal == "tiktok" else None,
        cmv=cmv_idx.get(k), repasse=rep_idx.get(k),
        frete_comprador=frete, frete_comprador_coluna=coluna,
    )
    return dre.montar_celula_base(ins, HOJE)


def _margem(c):
    return c["margem_contribuicao_conhecida"]["valor"]


# ---------------------------------------------------------------------------
# Frete presente
# ---------------------------------------------------------------------------

def test_receita_e_margem_caem_exatamente_pelo_frete_do_comprador():
    antes = celula(frete=None, coluna=False)
    depois = celula(frete=_frete())

    assert antes["componentes"]["receita"]["valor"] == GMV
    assert depois["componentes"]["receita"]["valor"] == GMV - FRETE_COMPRADOR
    assert _margem(antes) is not None
    assert _margem(depois) == pytest.approx(_margem(antes) - FRETE_COMPRADOR, abs=0.01)
    # Nada mais muda: mesmos custos, mesma classificacao.
    for nome in dre.CUSTOS_SOMAVEIS:
        assert depois["componentes"][nome]["valor"] == antes["componentes"][nome]["valor"], nome
    assert depois["classificacao"] == antes["classificacao"]


def test_receita_com_frete_declara_fonte_e_nao_tem_motivo_de_ausencia():
    rec = celula(frete=_frete())["componentes"]["receita"]
    assert rec["status"] == dre.DISPONIVEL
    assert rec["motivo"] is None
    assert dre.FONTE_FRETE_COMPRADOR in rec["fonte"]
    assert "buyer_shipping_fee" in rec["fonte"]


def test_aviso_antigo_de_frete_incluido_some_quando_o_frete_sai():
    avisos = celula(frete=_frete())["avisos_qualidade"]
    assert not any("inclui o frete" in a for a in avisos)
    assert any("sem o frete pago pelo comprador" in a for a in avisos)


def test_razao_do_cmv_continua_sobre_o_gmv_do_mart():
    c = celula(frete=_frete())
    # receita fiscal = GMV: a razao sobre o GMV e' 1,000; sobre a receita sem
    # frete seria 1,020.
    assert "CMV fiscal reconciliado: receita fiscal / GMV = 1.000." in c["avisos_qualidade"]


def test_frete_zero_medido_mantem_a_receita_sem_motivo():
    rec = celula(frete=_frete(frete=0.0))["componentes"]["receita"]
    assert rec["valor"] == GMV and rec["motivo"] is None


# ---------------------------------------------------------------------------
# Frete ausente: receita de hoje + motivo
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("frete,coluna,trecho", [
    (None, False, "migration 041 nao aplicada"),
    (_frete(dias_com_frete=29, frete=39_000.0), True, "nulo ou sem linha em 1 de 30 dias com GMV"),
    (_frete(dias_com_frete=0, frete=None), True, "nulo ou sem linha em 30 de 30 dias com GMV"),
    (None, True, "nenhum dia com GMV encontrado"),
    (_frete(frete=-1.0), True, "nula ou negativa"),
])
def test_frete_ausente_mantem_a_receita_e_explica(frete, coluna, trecho):
    c = celula(frete=frete, coluna=coluna)
    rec = c["componentes"]["receita"]
    assert rec["valor"] == GMV
    assert rec["fonte"] == "marts.fact_marketplace_daily_performance.gmv"
    assert rec["motivo"].startswith(dre.MOTIVO_FRETE_COMPRADOR_AUSENTE)
    assert trecho in rec["motivo"]
    assert any("inclui o frete pago pelo comprador" in a for a in c["avisos_qualidade"])
    # Receita de hoje: margem identica a da celula sem a coluna.
    assert _margem(c) == _margem(celula(frete=None, coluna=False))


def test_receita_parcial_acumula_os_dois_motivos():
    cmv_idx, rep_idx = dre.indexar_insumos(_insumos(), AGORA)
    k = (SET, "tiktok", "barbours")
    ins = dre.InsumosCelula(mes=SET, canal="tiktok", marca="barbours",
                            mart=mart("tiktok", marca="barbours", mes=SET, dias=20),
                            cmv=cmv_idx.get(k), repasse=rep_idx.get(k))
    rec = dre.montar_celula_base(ins, HOJE)["componentes"]["receita"]
    assert rec["status"] == dre.COBERTURA_PARCIAL
    assert rec["motivo"].startswith("receita presente em 20 de 30 dias do mes; ")
    assert dre.MOTIVO_FRETE_COMPRADOR_AUSENTE in rec["motivo"]


# ---------------------------------------------------------------------------
# ML e Shopee intactos
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("canal", ["ml", "shopee"])
def test_ml_e_shopee_nao_mudam(canal):
    com = celula(frete=_frete(), coluna=True, canal=canal)
    sem = celula(frete=None, coluna=False, canal=canal)
    assert com["componentes"]["receita"] == sem["componentes"]["receita"]
    assert com["componentes"]["receita"]["valor"] == GMV
    assert com["componentes"]["receita"]["motivo"] is None
    assert not any("frete pago pelo comprador" in a for a in com["avisos_qualidade"])


def test_montar_dre_casa_o_frete_so_na_celula_tiktok_da_mesma_marca_e_mes():
    linhas_fc = [_frete()]
    res = dre.montar_dre(
        inicio=SET, fim=date(2026, 9, 30), canais=["tiktok", "ml"], marcas=["barbours", "kokeshi"],
        mart_rows=[_mart("tiktok"), _mart("ml"), mart("tiktok", marca="kokeshi", mes=SET, dias=30)],
        afiliado_rows=[], insumos=dre.LeituraInsumos(tabela_existe=True, linhas=_insumos()),
        hoje=HOJE, agora=AGORA,
        frete_comprador=dre.LeituraFreteComprador(coluna_existe=True, linhas=linhas_fc),
    )
    rec = {(c["canal"], c["marca"]): c["componentes"]["receita"] for c in res["celulas_base"]}
    assert rec[("tiktok", "barbours")]["valor"] == GMV - FRETE_COMPRADOR
    assert rec[("ml", "barbours")]["valor"] == GMV
    # kokeshi sem linha na leitura: receita de hoje, com motivo.
    assert rec[("tiktok", "kokeshi")]["valor"] == 1_000_000.0
    assert dre.MOTIVO_FRETE_COMPRADOR_AUSENTE in rec[("tiktok", "kokeshi")]["motivo"]


# ---------------------------------------------------------------------------
# Rota
# ---------------------------------------------------------------------------

@pytest.fixture
def rota(monkeypatch):
    def _abrir(frete_comprador):
        neon = FakeNeon(mart_rows=[_mart("tiktok"), _mart("ml")], afiliado_rows=[afiliado("barbours", SET)],
                        insumos=_insumos() + cmv("ml", marca="barbours", mes=SET, receita_fiscal=GMV,
                                                 publicado_em=PUB),
                        marcas=("barbours",), frete_comprador=frete_comprador)
        app.dependency_overrides[get_db] = lambda: neon
        monkeypatch.setattr(database, "datamart_engine", _DataMartQueExplode())
        monkeypatch.setattr(dre_router, "today_brt", lambda: HOJE)

        class _Relogio(datetime):
            @classmethod
            def now(cls, tz=None):
                return AGORA

        monkeypatch.setattr(dre_router, "datetime", _Relogio)
        import app.deps.filters as filtros
        monkeypatch.setattr(filtros, "today_brt", lambda: HOJE)
        return TestClient(app), neon
    yield _abrir
    app.dependency_overrides.pop(get_db, None)


def _receita_tiktok(tc):
    r = tc.get("/api/v1/dre", params={"ref_month": "2026-09", "brands": "barbours"})
    assert r.status_code == 200, r.text
    cel = next(c for c in r.json()["celulas_base"] if c["canal"] == "tiktok")
    return cel["componentes"]["receita"]


def test_rota_com_coluna_serve_receita_sem_frete(rota):
    tc, neon = rota([_frete()])
    rec = _receita_tiktok(tc)
    assert rec["valor"] == GMV - FRETE_COMPRADOR
    leitura = next(p for p, s in zip(neon.params, neon.sqls)
                   if "buyer_shipping_fee" in s and "pg_attribute" not in s)
    assert leitura["mkt_id"] == dre.TIKTOK_ID
    assert leitura["inicio"] == SET and leitura["fim"] == date(2026, 9, 30)


def test_rota_sem_coluna_nao_le_a_coluna_e_mantem_a_receita(rota):
    tc, neon = rota(None)
    rec = _receita_tiktok(tc)
    assert rec["valor"] == GMV
    assert dre.MOTIVO_FRETE_COMPRADOR_AUSENTE in rec["motivo"]
    lidas = [s for s in neon.sqls if "buyer_shipping_fee" in s]
    assert len(lidas) == 1 and "pg_attribute" in lidas[0]


def test_sql_so_conta_dias_com_gmv_e_nao_usa_coalesce():
    sql = " ".join(dre.SQL_FRETE_COMPRADOR.split())
    assert "HAVING SUM(f.gmv) <> 0" in sql
    assert "LEFT JOIN marts.fact_tiktok_order_discounts_daily t" in sql
    assert "COUNT(t.buyer_shipping_fee) AS dias_com_frete" in sql
    assert "COALESCE" not in sql.upper()
