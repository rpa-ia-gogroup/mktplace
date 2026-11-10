"""Indicadores das abas Estoque ML/Shopee sem brinde e descontinuado (batem com a Visao geral).

Precedencia (definida em `interpretar_bd`, testada em test_full_situacao): brinde > descontinuado.
Aqui cada item traz UMA situacao, entao nunca e' descontado duas vezes.
"""
from __future__ import annotations

from types import SimpleNamespace as NS

from app.services import full_situacao_service as svc


def _ind_shopee():
    return NS(produtos_ruptura=3, produtos_baixo=1, produtos_excesso=0, produtos_sem_giro=0, produtos_suficientes=2,
              produtos_sem_demanda_medida=0, produtos_kit_nao_conciliado=0, produtos_exigem_acao=4, produtos_total=6,
              unidades_vendaveis_operacional=100, unidades_vendaveis_kits_contexto=10, unidades_vendaveis_total=110,
              situacao_aplicada=False, brindes_fora=0, descontinuados_fora=0)


def _p(c, s, saleable=0, kit=False):
    return NS(classificacao_torre=c, situacao=s, full_stock_saleable=saleable, is_kit=kit)


def test_shopee_desconta_brinde_e_descontinuado_e_sem_situacao_conta_normal():
    ind = _ind_shopee()
    svc.descontar_shopee(ind, [_p("RUPTURA_CANDIDATA", "brinde", 5), _p("RUPTURA_CANDIDATA", "descontinuado", 7, True),
                               _p("RUPTURA_CANDIDATA", None), _p("BAIXO_CANDIDATO", None), _p("SUFICIENTE", "brinde", 20),
                               _p("SUFICIENTE", None)])
    assert (ind.produtos_ruptura, ind.produtos_baixo, ind.produtos_suficientes) == (1, 1, 1)
    assert ind.produtos_total == 3 and ind.produtos_exigem_acao == 2
    assert ind.unidades_vendaveis_total == 110 - 32 and ind.unidades_vendaveis_kits_contexto == 3
    assert ind.unidades_vendaveis_operacional == 100 - 25
    assert (ind.brindes_fora, ind.descontinuados_fora, ind.situacao_aplicada) == (2, 1, True)


def _ml(**extra):
    ind = NS(inventarios=5, inventarios_full=5, inventarios_full_lidos=5, inventarios_fora_do_full=0, inventarios_compartilhados=1,
             inventarios_lidos=5, inventarios_sem_leitura=0, inventarios_ruptura=3, inventarios_baixo=0, inventarios_excesso=0,
             inventarios_sem_giro=0, inventarios_suficientes=2, inventarios_sem_demanda_medida=0, inventarios_exigem_acao=3,
             disponivel_full=50, nao_disponivel_full=30, transfer_full=10, situacao_aplicada=False, brindes_fora=0, descontinuados_fora=0)
    marca = NS(brand="kokeshi", inventarios=5, inventarios_full_lidos=5, inventarios_compartilhados=1, disponivel_full=50,
               nao_disponivel_full=30, transfer_full=10, por_classificacao={"RUPTURA_CANDIDATA": 3, "SUFICIENTE": 2},
               leitura=NS(inventarios=5, inventarios_lidos=5, inventarios_sem_leitura=0))
    return NS(indicadores=ind, marcas=[marca], limitacoes=[],
              cobertura=NS(leitura=NS(inventarios=5, inventarios_lidos=5, inventarios_sem_leitura=0)))


def _v(c, s, disp=0, nd=0, tr=0, comp=False):
    return NS(brand="kokeshi", classificacao_torre=c, situacao=s, eh_full=True, read_status="OK", compartilhado=comp,
              disponivel=disp, nao_disponivel=nd, transfer=tr)


def test_ml_desconta_contagens_quantidades_e_marca():
    r = _ml()
    svc.descontar_ml(r, [_v("RUPTURA_CANDIDATA", "brinde", 0, 12, 4, True), _v("RUPTURA_CANDIDATA", "descontinuado", 0, 3, 0),
                         _v("RUPTURA_CANDIDATA", None), _v("SUFICIENTE", None, 50, 15, 6)])
    i, m = r.indicadores, r.marcas[0]
    assert (i.inventarios_ruptura, i.inventarios, i.inventarios_full_lidos, i.inventarios_exigem_acao) == (1, 3, 3, 1)
    assert (i.nao_disponivel_full, i.transfer_full, i.disponivel_full) == (30 - 15, 10 - 4, 50)
    assert i.inventarios_compartilhados == 0
    assert (m.inventarios, m.por_classificacao["RUPTURA_CANDIDATA"], m.nao_disponivel_full) == (3, 1, 15)
    assert r.cobertura.leitura.inventarios == 3
    assert (i.brindes_fora, i.descontinuados_fora, i.situacao_aplicada) == (1, 1, True)
    assert svc.NOTA_ML in r.limitacoes


def test_sem_nenhum_brinde_nada_muda_mas_marca_como_aplicado():
    r = _ml()
    svc.descontar_ml(r, [_v("RUPTURA_CANDIDATA", None)])
    assert r.indicadores.inventarios_ruptura == 3 and r.indicadores.situacao_aplicada and not r.limitacoes
