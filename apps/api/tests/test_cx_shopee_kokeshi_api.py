"""T-0114 — Kokeshi da Shopee pela API (Data Mart) na aba CX, e dia sem carga = null.

O que estes testes existem para impedir:
  1. a Kokeshi voltar a ser lida do export do bot (parado desde ~11/11) em
     pedidos, devolucoes, chat, avaliacoes ou pedidos por motivo;
  2. dia depois da ultima carga de uma conta virar 0 na serie (sai None, com
     "carga parada desde dd/mm"), e o total parcial sair sem aviso;
  3. a Saude da Conta da Kokeshi perder a unica fonte que tem (o bot), C1-102.

Contraprova: `test_contraprova_...` tira a Kokeshi de `SHOPEE_MARCAS` e
mostra que o teste "pela API" passa a falhar.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.services import cx_atendimento_service as svc
from app.services import cx_avaliacoes_service as av
from app.services import cx_pedidos_service as ped
from app.services import performance_oficial_service as po
from tests import test_cx_avaliacoes as base_av
from tests import test_cx_comparacao as base_cmp
from tests import test_cx_pedidos_motivo as base_ped
from tests import test_performance_oficial as base_po
from tests.test_cx_shopee import AGORA, FonteCx, TorreCx


def _fonte_kokeshi() -> FonteCx:
    """Data Mart com a Kokeshi (numeros da VAL-C1, 14/10-12/11)."""
    fonte = FonteCx(
        devolucoes=[{"marca": "kokeshi", "devolucoes": 1338, "aceitas": 558, "em_andamento": 100,
                     "canceladas": 200, "reembolsado": 25948.31, "atualizado_em": AGORA}],
        nao_lidas=[{"marca": "kokeshi", "unread_count": 20, "captured_at": AGORA,
                    "aguardando_resposta": 148, "aguardando_mais_24h": 88}],
    )
    fonte.cx.dados["shopee_marcas"] = [
        {"marca": "kokeshi", "pedidos": 84980, "cancelados": 5241, "cancelados_comprador": 3000,
         "nao_pagos": 10, "atualizado_em": AGORA}]
    fonte.cx.dados["shopee_devolucao"] = [{"marca": "kokeshi", "em_devolucao": 12}]
    return fonte


def test_kokeshi_pela_api_em_pedidos_devolucoes_e_chat():
    fonte, torre = _fonte_kokeshi(), TorreCx()
    resp = svc.montar_cx_shopee(brands=["kokeshi"], consultar=fonte, consultar_torre=torre, agora=AGORA)
    # pedidos e cancelamentos: Silver, com quem cancelou e a fotografia de devolucao
    assert [m.marca for m in resp.atendimento.marcas] == ["kokeshi"]
    k = resp.atendimento.marcas[0]
    assert (k.marca, k.pedidos, k.cancelamentos, k.cancelamentos_comprador, k.em_devolucao) == (
        "kokeshi", 84980, 5241, 3000, 12)
    assert resp.atendimento.cobertura.fora == []
    assert dict(fonte.cx.chamadas)["shopee_marcas"]["marcas"] == ["kokeshi"]
    # devolucoes: raw.shopee_returns
    d = resp.devolucoes
    assert (d.estado, d.total, d.reembolsado) == ("dado", 1338, 25948.31)
    assert dict(fonte.chamadas)["devolucoes_marcas"]["marcas"] == ["kokeshi"]
    # conversas: raw.shopee_chat_snapshot
    nl = resp.chat.nao_lidas[0]
    assert (nl.marca, nl.aguardando_resposta, nl.aguardando_mais_24h) == ("kokeshi", 148, 88)
    assert dict(fonte.chamadas)["nao_lidas"]["marcas"] == ["kokeshi"]
    # no Neon, so' a taxa de resposta da Saude da Conta (a unica fonte dela)
    assert {n for n, _ in torre.chamadas} <= {"resposta_export"}


def test_avaliacoes_da_kokeshi_pela_api():
    fonte = base_av.Fonte(marcas=[base_av._marca("kokeshi", 164, 5000, 4800, 4.7, 200, 0)], produtos=[])
    r = av.montar_avaliacoes(brands=["kokeshi"], consultar=fonte, agora=base_av.AGORA)
    assert r.estado == "dado" and (r.marcas[0].marca, r.marcas[0].itens) == ("kokeshi", 164)
    assert all(p["marcas"] == ["kokeshi"] for n, p in fonte.chamadas if n != "existe")


def test_pedidos_do_motivo_da_kokeshi_pelo_data_mart():
    dm = base_ped._dm(**{ped.SQL_CANC_PEDIDOS: [
        {"marca": "kokeshi", "order_sn": "K1", "dia": date(2026, 11, 4), "autor": "seller"}]})
    codigo = svc.rotular_shopee("Out of Stock", "seller")[0]
    r = ped.montar_pedidos_motivo(tipo="cancelamento", codigo=codigo, brands=["kokeshi"], consultar=dm,
                                  agora=base_ped.AGORA)
    assert [(p.marca, p.situacao) for p in r.pedidos] == [("kokeshi", "Cancelado pela loja")]
    assert {tuple(p["marcas"]) for _, p in dm.chamadas} == {("kokeshi",)}


def test_saude_da_conta_da_kokeshi_continua_no_bot_com_aviso_de_atraso():
    foto = dict(base_po._shopee()[0], brand="kokeshi", captured_date=date(2026, 10, 30))
    torre = base_po.FonteTorre(existe=True, shopee=[foto],
                               metricas=[dict(m, brand="kokeshi") for m in base_po._shopee_metricas()[:2]])
    resp = po.montar_performance_oficial(canal="shopee", brands=["kokeshi"], consultar=base_po.Fonte(),
                                         consultar_torre=torre, agora=AGORA)
    k = resp.contas[0]
    assert k.marca == "kokeshi" and k.avisos[0] == po.AVISO_EXPORT
    assert any("atrasada há 5 dias" in a for a in k.avisos)
    assert resp.cobertura.marcas == ["kokeshi"] and resp.cobertura.fora == []
    assert all(p == {"marcas": ["kokeshi"]} for n, p in torre.chamadas if n != "existe")


# ---------------------------------------------------------------------------
# Dia sem carga = null (regra da T-0111). 20/11 12:00 BRT, janela 13..19/11.
# Kokeshi: Silver parou em 16/11 12:00 BRT, devolucoes em 15/11 12:00 BRT.
# ---------------------------------------------------------------------------
AGORA_C = base_cmp.AGORA_COBERTO


def _cenario_carga_parada():
    fonte = base_cmp._fonte(
        hoje=date(2026, 11, 20),
        pedidos=[{"marca": "kokeshi", "dia": date(2026, 11, d), "pedidos": 3000, "cancelados": 200}
                 for d in (13, 14, 15, 16)],
        devolucoes=[{"marca": "kokeshi", "dia": date(2026, 11, 14), "aceitas": 20, "reembolsado": 900.0}])
    fonte.cx.dados["shopee_marcas"] = [
        {"marca": "apice", "pedidos": 200, "cancelados": 10, "cancelados_comprador": 8, "nao_pagos": 1,
         "atualizado_em": AGORA_C - timedelta(hours=1)},
        {"marca": "kokeshi", "pedidos": 12000, "cancelados": 800, "cancelados_comprador": 500, "nao_pagos": 3,
         "atualizado_em": datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc)}]
    nome, _ = fonte.coleta[svc.SQL_DEVOLUCOES_MARCAS]
    fonte.coleta[svc.SQL_DEVOLUCOES_MARCAS] = (nome, [
        {"marca": "apice", "devolucoes": 5, "aceitas": 3, "em_andamento": 1, "canceladas": 1,
         "reembolsado": 120.5, "atualizado_em": AGORA_C - timedelta(hours=2)},
        {"marca": "kokeshi", "devolucoes": 40, "aceitas": 20, "em_andamento": 10, "canceladas": 10,
         "reembolsado": 900.0, "atualizado_em": datetime(2026, 11, 15, 15, 0, tzinfo=timezone.utc)}])
    return svc.montar_cx_shopee(brands=["apice", "kokeshi"], dias=7, consultar=fonte,
                                consultar_torre=TorreCx(), agora=AGORA_C)


def test_dia_depois_da_ultima_carga_sai_null_nunca_zero():
    resp = _cenario_carga_parada()
    p = {(x.marca, x.dia): x for x in resp.serie_diaria}
    d = lambda dia: date(2026, 11, dia)  # noqa: E731
    assert (p["kokeshi", d(16)].pedidos, p["kokeshi", d(16)].cancelamentos) == (3000, 200)
    for dia in (17, 18, 19):
        assert p["kokeshi", d(dia)].pedidos is None and p["kokeshi", d(dia)].cancelamentos is None
        assert p["apice", d(dia)].pedidos == 0, "loja com carga em dia: dia sem linha = zero medido"
    assert p["kokeshi", d(14)].devolucoes_aceitas == 20
    assert (p["kokeshi", d(15)].devolucoes_aceitas, p["kokeshi", d(15)].reembolsado) == (0, 0.0)
    for dia in (16, 17, 18, 19):
        assert p["kokeshi", d(dia)].devolucoes_aceitas is None and p["kokeshi", d(dia)].reembolsado is None
    assert resp.sem_serie["cancelamento"].motivo == "carga parada desde 16/11"
    assert resp.sem_serie["reembolso"].motivo == "carga parada desde 15/11"


def test_carga_parada_tira_o_anterior_e_marca_o_total_como_parcial():
    resp = _cenario_carga_parada()
    marcas = {m.marca: m for m in resp.atendimento.marcas}
    assert marcas["kokeshi"].pedidos_anterior is None and marcas["apice"].pedidos_anterior == 200
    assert resp.sem_anterior["cancelamento"].motivo == "carga parada desde 16/11"
    assert {m.marca: m for m in resp.devolucoes.marcas}["kokeshi"].aceitas_anterior is None
    assert resp.sem_anterior["reembolso"].motivo == "carga parada desde 15/11"
    canc = next(i for i in resp.atendimento.indicadores if i.codigo == "shopee_cancelamentos")
    assert canc.cobertura.startswith("Parcial:") and "kokeshi" in canc.cobertura.lower()
    assert "16/11" in canc.cobertura


def test_kokeshi_sem_silver_antes_de_31_08_nao_ganha_anterior_parcial():
    # 04/11, 90 dias: janela 06/08..03/11, anterior 08/05..05/08, antes da Kokeshi na Silver
    fonte = _fonte_kokeshi()
    resp = svc.montar_cx_shopee(brands=["kokeshi"], dias=90, consultar=fonte, consultar_torre=TorreCx(),
                                agora=AGORA)
    assert resp.atendimento.marcas[0].pedidos_anterior is None
    canc = resp.sem_anterior["cancelamento"]
    assert canc.motivo == "pedidos desde 31/08"


def test_contraprova_kokeshi_de_volta_ao_export_quebra_a_leitura_pela_api(monkeypatch):
    monkeypatch.setattr(svc, "SHOPEE_MARCAS", tuple(m for m in svc.SHOPEE_MARCAS if m != "kokeshi"))
    resp = svc.montar_cx_shopee(brands=["kokeshi"], consultar=_fonte_kokeshi(), consultar_torre=TorreCx(),
                                agora=AGORA)
    assert resp.atendimento.marcas == []
    assert [f.marca for f in resp.atendimento.cobertura.fora] == ["kokeshi"]
    assert resp.devolucoes.total is None and resp.chat.nao_lidas == []
    with pytest.raises(AssertionError):
        test_kokeshi_pela_api_em_pedidos_devolucoes_e_chat()
