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
    def __init__(self, fontes, vendas, existe=True):
        self.fontes, self.vendas, self.existe = fontes, vendas, existe

    def execute(self, sql, params=None):
        sql = str(sql)
        if "to_regclass" in sql:
            return _R(escalar=self.existe)
        if S.FONTES in sql:
            return _R(list(self.fontes.items()))
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
