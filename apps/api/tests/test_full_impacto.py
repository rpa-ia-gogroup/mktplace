"""FULL-IMPACTO-1 — rota `/api/v1/performance/full-impacto-ruptura`.

Protege: a conta (media x preco), o fallback de preco do ML, item sem preco
fora da soma (nunca zero), o "sem estoque do vendedor" da Shopee (`None` nao
conta como zero), % so' com 28 dias de GMV, R$ nunca somado entre canais e
flag desligada sem tocar o banco. Sessao FALSA por constante SQL; dados
ficticios.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services import full_impacto_service as svc
from app.services import ml_full_stock_service as ml_stock_svc

REF_ML = date(2026, 11, 4)
REF_SH = date(2026, 11, 8)


class _R:
    def __init__(self, linhas=None, escalar=None):
        self._l, self._e = linhas or [], escalar

    def mappings(self):
        return self

    def all(self):
        return list(self._l)

    def one(self):
        return self._l[0]

    def scalar(self):
        return self._e


ML_RUPTURAS = [
    # preco de vendas 30d
    {"brand": "kokeshi", "media": Decimal("2"), "sku": "K1", "titulo": "Kit K1",
     "preco_vendas": Decimal("100"), "preco_anuncio": Decimal("120")},
    # sem venda na janela -> fallback do anuncio
    {"brand": "kokeshi", "media": Decimal("1"), "sku": "K2", "titulo": "K2",
     "preco_vendas": None, "preco_anuncio": Decimal("50")},
    # sem preco nenhum -> fora da soma
    {"brand": "barbours", "media": Decimal("3"), "sku": None, "titulo": None,
     "preco_vendas": None, "preco_anuncio": None},
]
ML_GMV = [{"brand": "kokeshi", "gmv": Decimal("28000"), "dias": 28},
          {"brand": "barbours", "gmv": Decimal("56000"), "dias": 28}]

SH_RUPTURAS = [
    {"brand": "apice", "sku": "A1", "titulo": "A1", "media": Decimal("1"),
     "estoque_vendedor": 0, "preco": Decimal("40"), "mes_preco": date(2026, 11, 1)},
    {"brand": "apice", "sku": "A2", "titulo": "A2", "media": Decimal("2"),
     "estoque_vendedor": 30, "preco": Decimal("10"), "mes_preco": date(2026, 10, 1)},
    # estoque do vendedor desconhecido: nao entra no "sem vendedor"
    {"brand": "apice", "sku": "A3", "titulo": "A3", "media": Decimal("1"),
     "estoque_vendedor": None, "preco": Decimal("5"), "mes_preco": date(2026, 11, 1)},
    {"brand": "barbours", "sku": "B1", "titulo": "B1", "media": Decimal("1"),
     "estoque_vendedor": 0, "preco": None, "mes_preco": None},
]
SH_GMV = [{"brand": "apice", "gmv": Decimal("2800"), "dias": 28}]


class Sessao:
    def __init__(self, tabelas=True, ancora=True, ml_gmv=ML_GMV, sh_gmv=SH_GMV,
                 ref_ml=REF_ML):
        self.tabelas, self.ancora = tabelas, ancora
        self.ml_gmv, self.sh_gmv, self.ref_ml = ml_gmv, sh_gmv, ref_ml
        self.comandos: list[str] = []

    def _nome(self, stmt):
        for mod in (svc, ml_stock_svc):
            for n in dir(mod):
                if n.startswith("SQL_") and getattr(mod, n) is stmt:
                    return n
        raise AssertionError(f"SQL desconhecido: {stmt}")

    def execute(self, stmt, params=None):
        n = self._nome(stmt)
        self.comandos.append(n)
        return {
            "SQL_SOMENTE_LEITURA": lambda: _R(),
            "SQL_TABELAS_EXISTEM": lambda: _R(escalar=self.tabelas),
            "SQL_IDENTIFICACAO_DISPONIVEL": lambda: _R([{"tem_ancora": self.ancora, "tem_precos": True}]),
            "SQL_ML_ULTIMA_FOTO": lambda: _R(escalar=self.ref_ml),
            "SQL_ML_RUPTURAS": lambda: _R(ML_RUPTURAS),
            "SQL_ML_GMV": lambda: _R(self.ml_gmv),
            "SQL_SHOPEE_ULTIMA_FOTO": lambda: _R(escalar=REF_SH),
            "SQL_SHOPEE_RUPTURAS": lambda: _R(SH_RUPTURAS),
            "SQL_SHOPEE_GMV": lambda: _R(self.sh_gmv),
        }[n]()


def _bloco(sessao=None, ml=True, shopee=True):
    return svc.get_impacto_ruptura(sessao or Sessao(), ml_ligado=ml, shopee_ligado=shopee)


# ---------------------------------------------------------------------------
# Conta
# ---------------------------------------------------------------------------

def test_ml_media_vezes_preco_com_fallback_contado():
    ml = _bloco()["ml"]
    assert ml["status"] == "ok" and ml["ref_date"] == REF_ML
    # 2x100 + 1x50; o item sem preco fica fora da soma
    assert ml["perda_dia"] == 250.0
    assert ml["preco_fallback"] == 1
    assert ml["sem_preco"] == 1
    assert ml["rupturas"] == 3
    # GMV Full/dia = (28000 + 56000) / 28 = 3000
    assert ml["gmv_full_dia"] == 3000.0
    assert ml["pct_gmv_full"] == round(250 / 3000, 4)
    fontes = [i["fonte_preco"] for i in ml["itens"]]
    assert fontes == ["vendas_30d", "anuncio", None], "ordenado por perda, sem preco no fim"


def test_item_sem_preco_e_ausencia_nunca_zero():
    ml = _bloco()["ml"]
    sem = ml["itens"][-1]
    assert sem["preco_medio"] is None and sem["perda_dia"] is None
    barbours = next(m for m in ml["marcas"] if m["brand"] == "barbours")
    assert barbours["sem_preco"] == 1
    assert barbours["rupturas"] == 1


def test_shopee_sem_estoque_do_vendedor_e_o_numero_que_para_a_venda():
    sh = _bloco()["shopee"]
    # bruto: 1x40 + 2x10 + 1x5 = 65; B1 sem preco fica fora
    assert sh["perda_dia"] == 65.0
    # so' o zero MEDIDO conta: A1 (40). A3 (vendedor None) e B1 (sem preco) nao.
    assert sh["perda_dia_sem_vendedor"] == 40.0
    assert sh["sem_estoque_vendedor"] == 2
    assert sh["gmv_full_dia"] == 100.0
    assert sh["pct_gmv_full_sem_vendedor"] == 0.4
    assert sh["itens"][0]["fonte_preco"] == "mes"
    assert sh["preco_fallback"] == 0


def test_gmv_incompleto_nao_vira_percentual():
    s = Sessao(sh_gmv=[{"brand": "apice", "gmv": Decimal("2000"), "dias": 20}])
    sh = _bloco(s)["shopee"]
    assert sh["pct_gmv_full"] is None and sh["gmv_full_dia"] is None
    assert sh["motivo_pct"] == svc.MOTIVO_GMV_INCOMPLETO
    assert sh["perda_dia"] == 65.0, "a perda continua medida"


def test_r_nunca_e_somado_entre_canais():
    b = _bloco()
    assert set(b) == {"ml", "shopee", "janela_gmv_dias", "limitacoes"}
    assert b["ml"]["ref_date"] != b["shopee"]["ref_date"]


# ---------------------------------------------------------------------------
# Ausencia e flags
# ---------------------------------------------------------------------------

def test_flags_desligadas_nao_tocam_o_banco():
    class Proibida:
        def __getattr__(self, nome):
            raise AssertionError("tocou o banco")
    b = _bloco(Proibida(), ml=False, shopee=False)
    assert b["ml"] == {"canal": "ml", "status": "unavailable", "motivo": svc.MOTIVO_FLAG_ML}
    assert b["shopee"]["status"] == "unavailable"


def test_um_canal_desligado_nao_consulta_o_outro():
    s = Sessao()
    b = _bloco(s, ml=False)
    assert b["ml"]["status"] == "unavailable" and b["shopee"]["status"] == "ok"
    assert not [c for c in s.comandos if c.startswith("SQL_ML")]


def test_tabela_ausente_sem_ancora_ou_sem_foto_e_indisponivel():
    assert _bloco(Sessao(tabelas=False))["ml"]["motivo"] == svc.MOTIVO_TABELA
    assert _bloco(Sessao(ancora=False))["ml"]["motivo"] == svc.MOTIVO_SEM_ANCORA
    assert _bloco(Sessao(ref_ml=None))["ml"]["motivo"] == svc.MOTIVO_SEM_FOTO


def test_somente_leitura_primeiro_e_sem_select_estrela():
    s = Sessao()
    _bloco(s)
    assert s.comandos[0] == "SQL_SOMENTE_LEITURA"
    src = open(svc.__file__, encoding="utf-8").read().upper()
    for escrita in ("INSERT ", "UPDATE ", "DELETE ", "DROP ", "TRUNCATE ", "ALTER ", "CREATE "):
        assert escrita not in src, escrita
    for n in dir(svc):
        if n.startswith("SQL_"):
            assert "SELECT *" not in str(getattr(svc, n)).upper(), n


def test_joins_de_preco_sao_1_para_1_por_construcao():
    ml = " ".join(str(svc.SQL_ML_RUPTURAS).split())
    assert "GROUP BY brand, item_id" in ml
    assert "SELECT DISTINCT ON (brand, item_id)" in ml
    sh = " ".join(str(svc.SQL_SHOPEE_RUPTURAS).split())
    assert "SELECT DISTINCT ON (brand, sku_ref)" in sh


# ---------------------------------------------------------------------------
# Rota
# ---------------------------------------------------------------------------

@pytest.fixture
def cliente(monkeypatch):
    from fastapi.testclient import TestClient
    from app.config import settings
    from app.database import get_db
    from app.main import app

    def fabricar(sessao, ml=True, shopee=True):
        monkeypatch.setattr(settings, "ml_full_stock_api_enabled", ml)
        monkeypatch.setattr(settings, "shopee_fbs_stock_enabled", shopee)
        app.dependency_overrides[get_db] = lambda: sessao
        return TestClient(app)

    yield fabricar
    app.dependency_overrides.pop(get_db, None)


def test_rota_responde_o_contrato(cliente):
    r = cliente(Sessao()).get("/api/v1/performance/full-impacto-ruptura")
    assert r.status_code == 200
    corpo = r.json()
    assert corpo["ml"]["perda_dia"] == 250.0
    assert corpo["shopee"]["perda_dia_sem_vendedor"] == 40.0
    assert corpo["ml"]["itens"][-1]["perda_dia"] is None


def test_rota_com_flags_desligadas(cliente):
    r = cliente(None, ml=False, shopee=False).get("/api/v1/performance/full-impacto-ruptura")
    assert r.status_code == 200
    assert r.json()["ml"]["status"] == "unavailable"
