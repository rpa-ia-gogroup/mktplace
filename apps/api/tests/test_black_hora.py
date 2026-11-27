"""BLACK-HORA — meta da aba 'Meta hora Black' x realizado por hora (sem banco)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.services import black_hora_service as S

BRT = timezone(timedelta(hours=-3))
DIA = date(2026, 11, 27)

# Igual ao print da planilha: título, premissas, depois o bloco "Hora".
CAB = ["Hora", "Ápice Shopee", "Kokeshi Shopee", "Kokeshi Meli", "Total Shopee", "Total Meli", "Total", "Acumulado", "% do dia acumulado"]


def aba(horas=24):
    v = [["Meta hora a hora — Black Friday 27/11"], [], ["Meta do dia (R$)", "R$ 2.000.000"], [], ["Meta por hora (R$)"], CAB,
         ["Meta do dia", "R$ 152.465", "R$ 598.618", "R$ 385.347", "R$ 751.083", "R$ 385.347", "R$ 1.136.430"]]
    for h in range(horas):
        v.append([f"{h:02d}h", "R$ 1.000", "R$ 2.000,50", "R$ 3.000", "x", "x", "x", "x", "1,0%"])
    return v


def test_interpretar_le_so_marca_x_canal_e_a_meta_do_dia():
    linhas = S.interpretar(aba())
    assert [(x["marca"], x["canal"]) for x in linhas] == [("apice", "shopee"), ("kokeshi", "shopee"), ("kokeshi", "ml")]
    k = linhas[1]
    assert k["meta_dia"] == 598618.0
    assert k["meta_hora"][0] == 2000.5 and len(k["meta_hora"]) == 24


def test_interpretar_para_no_fim_do_bloco_mesmo_com_outro_bloco_hora_abaixo():
    """25/11: a aba ganhou 'Total' e um 2o bloco 'Hora' (base do 11/11) abaixo; so' o 1o vale."""
    v = aba() + [["Total", "R$ 24.000", "R$ 48.012", "R$ 72.000"], [], ["Base: venda do 11/11 por hora"], CAB]
    v += [[f"{h:02d}h", "R$ 9", "R$ 9", "R$ 9"] for h in range(24)]
    k = S.interpretar(v)[1]
    assert k["meta_hora"][0] == 2000.5 and k["meta_dia"] == 598618.0


def test_interpretar_formato_quebrado_vira_erro_de_formato():
    with pytest.raises(S.FormatoInesperado):
        S.interpretar([["sem cabecalho"]])
    with pytest.raises(S.FormatoInesperado):
        S.interpretar(aba(horas=23))


def test_cache_de_10_min_e_falha_devolve_a_ultima_meta():
    cache = {"meta": None, "lida_em": None, "em_s": 0.0, "motivo": None}
    t = [1000.0]
    chamadas = []

    def ler():
        chamadas.append(1)
        return aba()

    meta, motivo, _ = S.obter_meta(ler=ler, relogio=lambda: t[0], cache=cache)
    assert meta and motivo is None
    t[0] += 300
    S.obter_meta(ler=ler, relogio=lambda: t[0], cache=cache)
    assert len(chamadas) == 1, "dentro dos 10 min não relê"

    def quebra():
        raise RuntimeError("403")

    t[0] += 601
    meta2, motivo2, _ = S.obter_meta(ler=quebra, relogio=lambda: t[0], cache=cache)
    assert meta2 == meta and motivo2 is None, "falha serve a última meta boa"

    vazio = {"meta": None, "lida_em": None, "em_s": 0.0, "motivo": None}
    assert S.obter_meta(ler=quebra, relogio=lambda: 1.0, cache=vazio)[1] == S.MOTIVO_LEITURA


class _R:
    def __init__(self, linhas=None, escalar=None):
        self._l, self._e = linhas or [], escalar

    def scalar(self):
        return self._e

    def mappings(self):
        return self

    def all(self):
        return self._l

    def __iter__(self):
        return iter(self._l)


class Sessao:
    def __init__(self, fontes, vendas, existe=True, diaria=None):
        self.fontes, self.vendas, self.existe, self.diaria = fontes, vendas, existe, diaria or []

    def execute(self, sql, params=None):
        sql = str(sql)
        if "to_regclass" in sql:
            return _R(escalar=self.existe)
        if S.FONTES in sql:
            return _R(list(self.fontes.items()))
        if S.DIARIA in sql:
            return _R(self.diaria)
        return _R(self.vendas)


def test_realizado_corta_na_hora_fechada_de_cada_canal_e_so_pares_da_meta():
    agora = datetime(2026, 11, 27, 14, 20, tzinfo=BRT)
    fontes = {3: datetime(2026, 11, 27, 13, 5, tzinfo=BRT), 2: datetime(2026, 11, 27, 14, 2, tzinfo=BRT)}
    vendas = [
        {"brand": "kokeshi", "marketplace_id": 3, "hora": 0, "gmv": 100},
        {"brand": "kokeshi", "marketplace_id": 3, "hora": 13, "gmv": 999},  # Shopee só fechou até 13h
        {"brand": "kokeshi", "marketplace_id": 2, "hora": 13, "gmv": 50},
        {"brand": "denavita", "marketplace_id": 3, "hora": 1, "gmv": 70},  # fora da meta
    ]
    r = S.get_black_hora(Sessao(fontes, vendas), DIA, agora, obter=lambda: (S.interpretar(aba()), None, "x"))
    assert r["cortes"] == {"shopee": 13, "ml": 14}
    ks = next(x for x in r["linhas"] if x["marca"] == "kokeshi" and x["canal"] == "shopee")
    assert ks["realizado_hora"][0] == 100 and ks["realizado_hora"][12] == 0
    assert ks["realizado_hora"][13] is None, "hora não fechada é None, nunca 0"
    km = next(x for x in r["linhas"] if x["canal"] == "ml")
    assert km["realizado_hora"][13] == 50
    assert all(x["marca"] != "denavita" for x in r["linhas"])
    assert r["meta"]["disponivel"] is True


def test_sem_meta_segue_com_o_realizado_e_o_motivo():
    agora = datetime(2026, 11, 28, 9, 0, tzinfo=BRT)
    fontes = {3: datetime(2026, 11, 28, 8, 0, tzinfo=BRT), 2: datetime(2026, 11, 28, 8, 0, tzinfo=BRT)}
    r = S.get_black_hora(Sessao(fontes, [{"brand": "barbours", "marketplace_id": 2, "hora": 5, "gmv": 10}]), DIA, agora,
                         obter=lambda: (None, S.MOTIVO_LEITURA, None))
    assert r["meta"] == {"disponivel": False, "motivo": S.MOTIVO_LEITURA, "fonte": S.FONTE, "lida_em": None}
    assert r["cortes"] == {"shopee": 24, "ml": 24}, "dia passado: as 24 horas fechadas"
    assert r["linhas"][0]["meta_dia"] is None and r["linhas"][0]["realizado_hora"][5] == 10


def test_dia_futuro_nao_tem_hora_fechada():
    agora = datetime(2026, 11, 24, 18, 0, tzinfo=BRT)
    assert S.corte_do_dia(datetime(2026, 11, 24, 17, 0, tzinfo=BRT), DIA, agora) == 0


def test_hora_em_andamento_vem_da_diaria_como_parcial():
    """Hora em andamento = diária de hoje − horas fechadas; parcial {hora, ate (carga da diária), fracao}."""
    agora = datetime(2026, 11, 27, 9, 50, tzinfo=BRT)
    fontes = {3: datetime(2026, 11, 27, 9, 11, 6, tzinfo=BRT), 2: datetime(2026, 11, 27, 9, 33, tzinfo=BRT)}
    vendas = [  # a tabela por hora nao tem a hora 9 (so' hora inteira)
        {"brand": "kokeshi", "marketplace_id": 3, "hora": 8, "gmv": 100},
        {"brand": "kokeshi", "marketplace_id": 2, "hora": 8, "gmv": 10},
    ]
    carga = datetime(2026, 11, 27, 9, 42, tzinfo=BRT)
    diaria = [
        {"brand": "kokeshi", "marketplace_id": 3, "gmv": 140, "ate": carga},
        {"brand": "kokeshi", "marketplace_id": 2, "gmv": 17, "ate": datetime(2026, 11, 27, 9, 33, tzinfo=BRT)},
        {"brand": "denavita", "marketplace_id": 3, "gmv": 999, "ate": carga},  # fora da meta
    ]
    r = S.get_black_hora(Sessao(fontes, vendas, diaria=diaria), DIA, agora, obter=lambda: (S.interpretar(aba()), None, "x"))
    assert r["cortes"] == {"shopee": 9, "ml": 9}
    assert r["parcial"]["shopee"] == {"hora": 9, "ate": "2026-11-27T09:42:00-03:00", "fracao": 0.7}
    assert r["parcial"]["ml"]["fracao"] == 0.55
    ks = next(x for x in r["linhas"] if x["marca"] == "kokeshi" and x["canal"] == "shopee")
    assert ks["realizado_hora"][9] is None and ks["realizado_parcial"] == 40
    a = next(x for x in r["linhas"] if x["marca"] == "apice")
    assert a["realizado_parcial"] == 0, "canal com parcial: marca sem venda = 0 de verdade"
    # fechado + parcial = a diária de hoje (o GMV da Gerencial) das marcas da meta
    fechado = sum(v or 0 for x in r["linhas"] for v in x["realizado_hora"])
    assert fechado + sum(x["realizado_parcial"] for x in r["linhas"]) == 157


def test_sem_parcial_quando_a_diaria_e_velha_ou_o_dia_fechou():
    assert S.parcial_do_canal(None, 9, DIA) is None
    assert S.parcial_do_canal(datetime(2026, 11, 26, 23, 0, tzinfo=BRT), 0, DIA) is None, "carga de ontem"
    assert S.parcial_do_canal(datetime(2026, 11, 28, 1, 0, tzinfo=BRT), 24, DIA) is None, "dia fechado"
    assert S.parcial_do_canal(datetime(2026, 11, 27, 8, 50, tzinfo=BRT), 9, DIA) is None, "diaria mais velha que o corte"
    assert S.parcial_do_canal(datetime(2026, 11, 27, 9, 0, tzinfo=BRT), 9, DIA)["fracao"] == 0.0
    assert S.parcial_do_canal(datetime(2026, 11, 27, 10, 30, tzinfo=BRT), 9, DIA)["fracao"] == 1.0, "limitado a 1"


_HOJE_DM = S.hoje_do_datamart  # o original, antes do fixture trocar


@pytest.fixture(autouse=True)
def _sem_datamart_real(monkeypatch):
    """Nenhum teste chama o Data Mart de verdade: o padrão vira 'falhou' (a Torre responde)."""
    monkeypatch.setattr(S, "hoje_do_datamart", lambda dia: None)


def _dm_real(pares):
    real = {}
    for (marca, canal, hora), gmv in pares.items():
        real.setdefault((marca, canal), [0.0] * 24)[hora] += gmv
    return real


def test_hoje_vem_do_datamart_com_corte_e_parcial_da_fonte():
    agora = datetime(2026, 11, 27, 10, 47, tzinfo=BRT)
    fontes = {3: datetime(2026, 11, 27, 9, 11, tzinfo=BRT), 2: datetime(2026, 11, 27, 9, 33, tzinfo=BRT)}
    torre = [{"brand": "kokeshi", "marketplace_id": 3, "hora": 8, "gmv": 100}]
    real = _dm_real({("kokeshi", "shopee", 8): 102.0, ("kokeshi", "shopee", 9): 50.0, ("kokeshi", "shopee", 10): 7.0,
                     ("kokeshi", "ml", 10): 3.0})
    dm_fontes = {"shopee": datetime(2026, 11, 27, 10, 11, tzinfo=BRT), "ml": datetime(2026, 11, 27, 10, 31, tzinfo=BRT)}
    r = S.get_black_hora(Sessao(fontes, torre), DIA, agora, obter=lambda: (S.interpretar(aba()), None, "x"),
                         datamart=lambda dia: (real, dm_fontes))
    assert r["fonte"] == "datamart"
    assert r["cortes"] == {"shopee": 10, "ml": 10}, "corte = a fonte do Data Mart, não a da Torre (9h)"
    assert r["parcial"]["ml"] == {"hora": 10, "ate": "2026-11-27T10:31:00-03:00", "fracao": 0.5167}
    ks = next(x for x in r["linhas"] if x["marca"] == "kokeshi" and x["canal"] == "shopee")
    assert ks["realizado_hora"][8] == 102 and ks["realizado_hora"][9] == 50 and ks["realizado_hora"][10] is None
    assert ks["realizado_parcial"] == 7
    a = next(x for x in r["linhas"] if x["marca"] == "apice")
    assert a["realizado_parcial"] == 0 and a["realizado_hora"][0] == 0


def test_datamart_falhou_cai_para_a_torre_com_o_selo_e_dia_passado_nem_tenta():
    agora = datetime(2026, 11, 27, 10, 47, tzinfo=BRT)
    fontes = {3: datetime(2026, 11, 27, 9, 11, tzinfo=BRT), 2: datetime(2026, 11, 27, 9, 33, tzinfo=BRT)}
    meta = lambda: (S.interpretar(aba()), None, "x")  # noqa: E731
    r = S.get_black_hora(Sessao(fontes, []), DIA, agora, obter=meta, datamart=lambda dia: None)
    assert r["fonte"] == "torre" and r["cortes"] == {"shopee": 9, "ml": 9}
    chamadas = []
    passado = S.get_black_hora(Sessao(fontes, []), date(2026, 11, 26), agora, obter=meta,
                               datamart=lambda dia: chamadas.append(dia))
    assert passado["fonte"] is None and chamadas == []
    assert S.get_black_hora(Sessao(fontes, []), DIA, agora, obter=meta, datamart=None)["fonte"] is None


def test_ler_hoje_datamart_uma_consulta_relogios_do_pipeline():
    vistos = []

    def consultar(sql, params):
        vistos.append(params)
        return [
            {"canal": "ml", "brand": "Kokeshi", "hora": 9, "gmv": 10, "ml_fonte_at": datetime(2026, 11, 27, 10, 31),
             "shopee_fonte_at": datetime(2026, 11, 27, 13, 21, tzinfo=timezone.utc)},
            {"canal": "shopee", "brand": "barbours", "hora": 9, "gmv": 5.5, "ml_fonte_at": None, "shopee_fonte_at": None},
        ]
    real, fontes = S.ler_hoje_datamart(DIA, consultar=consultar)
    assert len(vistos) == 1 and vistos[0]["marcas_ml"] == S.DM_MARCAS_ML and vistos[0]["fim"] == date(2026, 11, 28)
    assert real[("kokeshi", "ml")][9] == 10 and real[("barbours", "shopee")][9] == 5.5
    assert fontes["ml"] == datetime(2026, 11, 27, 10, 31, tzinfo=BRT), "ML: já em BRT depois do +1 h (sem fuso)"
    assert fontes["shopee"] == datetime(2026, 11, 27, 10, 11, tzinfo=BRT), "Shopee: carga − 10 min (FOLGA_SHOPEE)"
    with pytest.raises(RuntimeError):
        S.ler_hoje_datamart(DIA, consultar=lambda sql, params: [])


def test_sql_do_datamart_usa_as_regras_do_pipeline():
    q = S.SQL_HOJE_DM
    assert "status = 'paid'" in q and "date_created + interval '1 hour'" in q
    assert "NOT IN ('cancelled', 'unpaid')" in q and "SUM(item_total)" in q
    assert "create_time AT TIME ZONE 'America/Sao_Paulo'" in q and "max(ingested_at)" in q


def test_datamart_lento_ou_com_erro_vira_none():
    import time as _t

    def lento(dia):
        _t.sleep(0.5)
        return ({}, {})

    def quebra(dia):
        raise RuntimeError("fora")
    assert _HOJE_DM(DIA, ler=lento, espera_s=0.05) is None, "passou do teto: a Torre responde"
    assert _HOJE_DM(DIA, ler=quebra) is None
    assert _HOJE_DM(DIA, ler=lambda dia: ({}, {"ml": None})) == ({}, {"ml": None})
