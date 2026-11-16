"""API-3 — periodo anterior e serie diaria da aba CX (`/api/v1/cx/shopee`).

O que estes testes existem para impedir:
  1. janela anterior antes da coleta virar numero parcial (tem de ser None + motivo + a_partir_de);
  2. dia sem medida virar zero na serie;
  3. `resposta_anterior_pct` sair do `last_period` da Shopee (foto do dia anterior);
  4. falha da comparacao derrubar a aba ou vazar o texto da excecao.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from app.services import cx_atendimento_service as svc
from tests import test_cx_atendimento as base_cx
from tests import test_performance_oficial as base_po
from tests.test_cx_shopee import FonteCx, TorreCx

D = date


def _po(dia: date, valor: float = 80.0) -> base_po.Fonte:
    """Saude da Conta so' da Apice, com a foto em `dia`."""
    foto = dict(base_po._shopee()[0], captured_date=dia)
    metricas = [dict(m, captured_date=dia, current_period=valor if m["metric_id"] == 11 else m["current_period"])
                for m in base_po._shopee_metricas()]
    return base_po.Fonte(shopee=[foto], metricas=metricas)


def _fonte(*, hoje: date, falhas=(), resposta=(), chat=(), pedidos=(), devolucoes=()) -> FonteCx:
    fonte = FonteCx(nao_lidas=[
        {"marca": "apice", "unread_count": 3, "captured_at": datetime(2026, 11, 1, tzinfo=timezone.utc),
         "conversas_7d": 120, "conversas_30d": 400},
        {"marca": "barbours", "unread_count": 1, "captured_at": datetime(2026, 11, 1, tzinfo=timezone.utc),
         "conversas_7d": 90, "conversas_30d": 300},
    ], falhas_coleta=falhas)
    fonte.po = _po(hoje)
    # T-0114: carga da Silver em dia no `hoje` do cenario (carga velha corta a serie)
    carga = datetime(hoje.year, hoje.month, hoje.day, 14, 0, tzinfo=timezone.utc)
    fonte.cx.dados["shopee_marcas"] = [dict(r, atualizado_em=carga) for r in fonte.cx.dados["shopee_marcas"]]
    fonte.coleta.update(_rotas_comparacao(False, resposta=resposta, chat=chat, pedidos=pedidos,
                                          devolucoes=devolucoes))
    return fonte


def _linhas(resposta=(), chat=(), pedidos=(), devolucoes=()) -> list[dict]:
    """As linhas da consulta unica (`parte`, `marca`, `dia`, `a`, `b`)."""
    return ([{"parte": "resposta", "marca": r["marca"], "dia": r["dia"], "a": r["valor"], "b": None}
             for r in resposta]
            + [{"parte": "chat", "marca": r["marca"], "dia": None, "a": r["conversas_7d"], "b": r["conversas_30d"]}
               for r in chat]
            + [{"parte": "pedidos", "marca": r["marca"], "dia": r["dia"], "a": r["pedidos"], "b": r["cancelados"]}
               for r in pedidos]
            + [{"parte": "devolucoes", "marca": r["marca"], "dia": r["dia"], "a": r["aceitas"], "b": r["reembolsado"]}
               for r in devolucoes])


def _rotas_comparacao(exportar: bool, **dados) -> dict:
    """A consulta unica em todas as combinacoes; a fonte devolve as linhas de todas as partes."""
    nome = "comparacao_export" if exportar else "comparacao"
    return {svc.sql_comparacao(exportar=exportar, com_chat=ch): (nome, _linhas(**dados)) for ch in (True, False)}


def _montar(fonte, agora, dias, brands=("apice", "barbours"), torre=None):
    return svc.montar_cx_shopee(brands=list(brands), dias=dias, consultar=fonte,
                                consultar_torre=torre or TorreCx(), agora=agora)


# 20/11 12:00 BRT: janela de 7 = 13/11..19/11, anterior = 06/11..12/11 (coleta coberta)
AGORA_COBERTO = datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc)


def _coberto(**kw):
    fonte = _fonte(
        hoje=D(2026, 11, 20),
        resposta=[{"marca": "apice", "dia": D(2026, 11, 13), "valor": 70},   # foto de 20/11 - 7
                  {"marca": "apice", "dia": D(2026, 11, 14), "valor": 72},
                  {"marca": "apice", "dia": "2026-11-15", "valor": 74}],      # texto ISO (Metabase)
        chat=[{"marca": "apice", "conversas_7d": 50, "conversas_30d": 200},
              {"marca": "barbours", "conversas_7d": 40, "conversas_30d": 150}],
        pedidos=[{"marca": "apice", "dia": D(2026, 11, 13), "pedidos": 10, "cancelados": 1}],
        devolucoes=[{"marca": "apice", "dia": D(2026, 11, 7), "aceitas": 2, "reembolsado": 30.0},
                    {"marca": "apice", "dia": D(2026, 11, 14), "aceitas": 1, "reembolsado": None}],
        **kw)
    return _montar(fonte, AGORA_COBERTO, 7), fonte


def test_anterior_de_cada_card_com_a_coleta_cobrindo():
    resp, _ = _coberto()
    assert resp.janela_anterior.inicio == D(2026, 11, 6) and resp.janela_anterior.fim == D(2026, 11, 12)
    apice = next(c for c in resp.chat.contas if c.marca == "apice")
    # foto de N dias antes da atual (20/11 - 7), nunca o last_period (75, a foto de ontem)
    assert apice.resposta_anterior_pct == 70
    assert apice.metricas[0].anterior == 75
    assert {n.marca: n.conversas_anterior for n in resp.chat.nao_lidas} == {"apice": 50, "barbours": 40}
    dev = {m.marca: m for m in resp.devolucoes.marcas}
    assert (dev["apice"].aceitas_anterior, dev["apice"].reembolsado_anterior) == (2, 30.0)
    # tabela com historico e sem linha da loja = zero medido
    assert (dev["barbours"].aceitas_anterior, dev["barbours"].reembolsado_anterior) == (0, 0.0)
    assert {m.marca: m.pedidos_anterior for m in resp.atendimento.marcas} == {"apice": 200, "barbours": 800}
    # so' falta o anterior da resposta da Barbours (sem foto da Saude da Conta)
    assert set(resp.sem_anterior) == {"resposta"}
    assert resp.sem_anterior["resposta"].motivo == "sem medida"
    assert resp.sem_anterior["resposta"].a_partir_de is None


def test_serie_um_ponto_por_dia_e_loja_e_ausencia_nunca_vira_zero():
    resp, _ = _coberto()
    assert len(resp.serie_diaria) == 7 * 2
    p = {(x.marca, x.dia): x for x in resp.serie_diaria}
    assert (p["apice", D(2026, 11, 13)].pedidos, p["apice", D(2026, 11, 13)].cancelamentos) == (10, 1)
    assert p["barbours", D(2026, 11, 13)].pedidos == 0               # Silver com historico: zero medido
    assert p["apice", D(2026, 11, 13)].resposta_pct == 70            # foto do proprio dia
    assert p["apice", D(2026, 11, 15)].resposta_pct == 74
    assert p["apice", D(2026, 11, 16)].resposta_pct is None         # sem foto no dia: None, nunca 0
    assert p["apice", D(2026, 11, 14)].devolucoes_aceitas == 1
    assert p["apice", D(2026, 11, 14)].reembolsado is None          # aceita sem valor: desconhecido
    assert p["apice", D(2026, 11, 15)].reembolsado == 0.0           # nenhuma aceita no dia
    assert resp.sem_serie["contact_rate"].motivo == "sem contagem diária"
    assert "cancelamento" not in resp.sem_serie and "reembolso" not in resp.sem_serie
    assert resp.sem_serie["resposta"].a_partir_de is None


def test_janela_anterior_antes_da_coleta_e_none_com_motivo_e_data():
    # 09/11 12:00 BRT, 30 dias: janela 10/10..08/11, anterior 10/09..09/10
    fonte = _fonte(hoje=D(2026, 11, 9),
                   devolucoes=[{"marca": "apice", "dia": D(2026, 10, 6), "aceitas": 5, "reembolsado": 50.0}])
    resp = _montar(fonte, datetime(2026, 11, 9, 15, 0, tzinfo=timezone.utc), 30)
    assert all(m.aceitas_anterior is None and m.reembolsado_anterior is None for m in resp.devolucoes.marcas)
    assert all(n.conversas_anterior is None for n in resp.chat.nao_lidas)
    reemb = resp.sem_anterior["reembolso"]
    assert (reemb.motivo, reemb.a_partir_de) == ("devoluções desde 05/10", D(2026, 12, 4))
    cr = resp.sem_anterior["contact_rate"]
    assert (cr.motivo, cr.a_partir_de) == ("coleta desde 04/11", D(2026, 12, 4))
    assert resp.sem_anterior["resposta"].a_partir_de == D(2026, 12, 4)
    # serie de devolucoes: dias antes de 05/10 nao existem nesta janela; os de depois sao medidos
    assert "reembolso" not in resp.sem_serie
    # resposta: coleta so' desde 04/11, entao a serie de 30 dias e' parcial
    assert resp.sem_serie["resposta"].a_partir_de == D(2026, 12, 4)


def test_comparacao_e_uma_consulta_so_por_fonte():
    """Em producao cada consulta vira uma chamada ao Metabase, atendida em fila:
    4 consultas a mais custaram ~+1 s a frio. A comparacao inteira vai numa so'."""
    _, fonte = _coberto()
    assert [nome for nome, _ in fonte.chamadas].count("comparacao") == 1
    p = next(p for nome, p in fonte.chamadas if nome == "comparacao")
    assert (p["dev_inicio"], p["dev_fim"]) == (D(2026, 11, 6), D(2026, 11, 19))   # anterior + atual
    assert (p["ped_inicio"], p["ped_fim"]) == (D(2026, 11, 13), D(2026, 11, 19))
    assert (p["resp_inicio"], p["resp_fim"]) == (D(2026, 11, 6), D(2026, 11, 20))


def test_contact_rate_em_90_dias_nunca_tem_anterior_e_nem_consulta_o_chat():
    fonte = _fonte(hoje=D(2026, 11, 20))
    resp = _montar(fonte, AGORA_COBERTO, 90)
    assert resp.sem_anterior["contact_rate"].motivo == "só em 7 e 30 dias"
    assert resp.sem_anterior["contact_rate"].a_partir_de is None
    p = next(p for nome, p in fonte.chamadas if nome == "comparacao")
    assert "desde" not in p                                     # sem a foto do chat


def test_falha_na_comparacao_vira_fonte_indisponivel_sem_vazar_e_sem_derrubar_a_aba():
    resp, _ = _coberto(falhas=("comparacao",))
    assert resp.devolucoes.estado == "dado" and resp.devolucoes.total is not None
    assert all(m.aceitas_anterior is None for m in resp.devolucoes.marcas)
    assert resp.sem_anterior["reembolso"].motivo == "fonte indisponível"
    assert all(p.pedidos is None and p.devolucoes_aceitas is None for p in resp.serie_diaria)
    assert resp.sem_serie["cancelamento"].motivo == "fonte indisponível"
    assert base_cx.SEGREDO not in resp.model_dump_json()


# ---------------------------------------------------------------------------
# /api/v1/cx/site
# ---------------------------------------------------------------------------
from app.services import cx_site_service as site  # noqa: E402
from tests import test_cx_site as base_site  # noqa: E402


class FonteSite(base_site.Fonte):
    """A fonte do site + as consultas da API-3."""

    def __init__(self, nps=(), reviews=(), reenvio=None, fat=None, **kw):
        super().__init__(**kw)
        self.extra = {
            site.SQL_NPS_DIA: ("nps_dia", list(nps)),
            site.SQL_REVIEWS_DIA: ("reviews_dia", list(reviews)),
            site.SQL_REENVIO_SAFRA: ("reenvio_safra", reenvio if reenvio is not None else [
                {"marca": "barbours", "safra": D(2026, 9, 1), "linhas": 5, "valor_reenvio": 800, "valor_reembolso": 400},
                {"marca": "barbours", "safra": "2026-10-01", "linhas": 15, "valor_reenvio": 1000, "valor_reembolso": 500},
            ]),
            site.SQL_FATURAMENTO_SAFRA: ("faturamento_safra", fat if fat is not None else [
                {"marca": "barbours", "safra": D(2026, 9, 1), "faturamento": 80000},
                {"marca": "barbours", "safra": D(2026, 10, 1), "faturamento": 100000},
            ]),
        }

    def __call__(self, sql, params):
        if sql in self.extra:
            nome, dados = self.extra[sql]
            self.chamadas.append((nome, params))
            if nome in self.falhas:
                raise RuntimeError(f"falhou em {base_site.SEGREDO}")
            return dados
        return super().__call__(sql, params)


NPS_DIAS = [{"dia": D(2026, 9, 10), "respostas": 10, "promotores": 5, "detratores": 3},   # anterior
            {"dia": D(2026, 10, 8), "respostas": 4, "promotores": 2, "detratores": 1}]    # atual


def _site(dias=30, **kw):
    fonte = FonteSite(nps=NPS_DIAS, **kw)
    return site.montar_cx_site(dias=dias, consultar=fonte, agora=base_site.AGORA), fonte


def test_site_nps_anterior_e_serie_com_contagens():
    resp, _ = _site()   # 07/11: janela 08/10..06/11, anterior 08/09..07/10
    assert (resp.janela_anterior.inicio, resp.janela_anterior.fim) == (D(2026, 9, 8), D(2026, 10, 7))
    nps = resp.nps
    assert (nps.nps_anterior, nps.promotores_pct_anterior, nps.detratores_pct_anterior,
            nps.respostas_anterior) == (20.0, 50.0, 30.0, 10)
    assert nps.sem_anterior is None
    assert len(nps.serie) == 30
    p = {x.dia: x for x in nps.serie}
    assert (p[D(2026, 10, 8)].promotores, p[D(2026, 10, 8)].detratores, p[D(2026, 10, 8)].nps) == (2, 1, 25.0)
    # dia sem resposta: contagem 0 medida, NPS indefinido (nunca 0)
    assert (p[D(2026, 10, 9)].respostas, p[D(2026, 10, 9)].nps) == (0, None)


def test_site_nps_90_dias_antes_da_fonte_fica_sem_anterior_com_data():
    resp, _ = _site(dias=90)    # janela 09/08..06/11, anterior 11/05..08/08
    nps = resp.nps
    assert nps.nps_anterior is None and nps.respostas_anterior is None
    assert (nps.sem_anterior.motivo, nps.sem_anterior.a_partir_de) == ("nps desde 28/08", D(2027, 2, 24))
    p = {x.dia: x for x in nps.serie}
    assert p[D(2026, 8, 27)].respostas is None          # antes da fonte: nao medido
    assert p[D(2026, 8, 28)].respostas == 0


def test_site_reviews_com_carga_parada_sem_anterior_e_serie_cortada():
    resp, _ = _site(reviews=[{"dia": D(2026, 10, 20), "reviews": 8, "baixas": 2}])
    rv = resp.reviews
    assert rv.baixas_pct_anterior is None and rv.reviews_anterior is None
    assert (rv.sem_anterior.motivo, rv.sem_anterior.a_partir_de) == ("carga parada desde 26/10", None)
    p = {x.dia: x for x in rv.serie}
    assert (p[D(2026, 10, 20)].reviews, p[D(2026, 10, 20)].baixas, p[D(2026, 10, 20)].baixas_pct) == (8, 2, 25.0)
    assert p[D(2026, 10, 26)].reviews == 0
    assert p[D(2026, 10, 27)].reviews is None and p[D(2026, 10, 27)].baixas_pct is None


def test_site_reviews_em_dia_tem_anterior():
    em_dia = {"reviews_carga": [{"carregado_em": base_site.CARGA_EM_DIA,
                                 "ultima_review_em": base_site.CARGA_EM_DIA}]}
    resp, _ = _site(reviews=[{"dia": D(2026, 9, 9), "reviews": 20, "baixas": 5}], sobrepor=em_dia)
    assert (resp.reviews.reviews_anterior, resp.reviews.baixas_pct_anterior) == (20, 25.0)
    assert resp.reviews.sem_anterior is None


def test_site_reenvio_safra_anterior_mesma_regra_e_serie_por_safra():
    resp, _ = _site()   # safra atual = 10/2026, anterior = 09/2026; recorte = Barbours (com faturamento)
    rr = resp.reenvio_reembolso
    assert (rr.safra_anterior_inicio, rr.safra_anterior_fim) == (D(2026, 9, 1), D(2026, 9, 30))
    assert (rr.taxa_reenvio_pct_anterior, rr.taxa_reembolso_pct_anterior) == (1.0, 0.5)
    assert [(p.safra, p.taxa_reenvio_pct, p.taxa_reembolso_pct) for p in rr.serie] == [
        (D(2026, 9, 1), 1.0, 0.5), (D(2026, 10, 1), 1.0, 0.5)]
    # a safra atual da serie bate com a taxa do card (mesma regra)
    assert (rr.serie[-1].taxa_reenvio_pct, rr.serie[-1].taxa_reembolso_pct) == (rr.taxa_reenvio_pct,
                                                                                rr.taxa_reembolso_pct)


def test_site_reenvio_marca_do_recorte_sem_safra_anterior_nao_vira_taxa_parcial():
    resp, _ = _site(fat=[{"marca": "barbours", "safra": D(2026, 10, 1), "faturamento": 100000}])
    rr = resp.reenvio_reembolso
    assert rr.taxa_reenvio_pct_anterior is None
    assert rr.sem_anterior.motivo == "safra anterior incompleta"
    assert rr.serie[0].taxa_reenvio_pct is None


def test_site_falha_na_comparacao_nao_derruba_bloco_nem_vaza():
    resp, _ = _site(falhas=("nps_dia", "reenvio_safra"))
    assert resp.nps.estado == "dado" and resp.nps.nps is not None
    assert resp.nps.sem_anterior.motivo == "fonte indisponível" and resp.nps.serie == []
    assert resp.reenvio_reembolso.sem_anterior.motivo == "fonte indisponível"
    assert base_site.SEGREDO not in resp.model_dump_json()


def test_site_rota_traz_os_campos_novos():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routers import cx_site as rota

    app = FastAPI()
    app.include_router(rota.router)
    fonte = FonteSite(nps=NPS_DIAS)
    orig = site.montar_cx_site
    try:
        site.montar_cx_site = lambda **kw: orig(consultar=fonte, agora=base_site.AGORA, **kw)
        corpo = TestClient(app).get("/api/v1/cx/site", params={"dias": "30"}).json()
    finally:
        site.montar_cx_site = orig
    assert corpo["janela_anterior"] == {"inicio": "2026-09-08", "fim": "2026-10-07", "dias": 30}
    assert corpo["reviews"]["sem_anterior"] == {"motivo": "carga parada desde 26/10", "a_partir_de": None,
                                                "detalhe": corpo["reviews"]["aviso_frescor"]}
    assert set(corpo["nps"]["serie"][0]) == {"dia", "respostas", "promotores", "detratores", "nps"}
