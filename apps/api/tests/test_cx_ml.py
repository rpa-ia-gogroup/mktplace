"""CX do Mercado Livre — `GET /api/v1/cx/mercadolivre` (10/11/2026).

Duas consultas (view diaria e reclamacoes); uma caindo nao derruba a outra;
ausencia nunca vira zero; apice fica fora; periodo anterior so' quando coberto.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.routers import cx_atendimento as rota
from app.services import cx_ml_service as ml
from app.services import performance_oficial_service as po

URL = "/api/v1/cx/mercadolivre"
SEGREDO = "postgresql://usuario:senha-NAO-PODE-VAZAR@host/db"
AGORA = datetime(2026, 11, 10, 20, 0, tzinfo=timezone.utc)  # 17:00 em Sao Paulo
FIM = date(2026, 11, 9)  # ultimo dia fechado


def _dias(n: int, fim: date = FIM):
    return [fim - timedelta(days=i) for i in range(n)]


def reputacao(marca="kokeshi", claims=0.0115, cor="green"):
    return {"brand": marca, "captured_date": date(2026, 11, 10), "captured_at": AGORA, "level_id": f"5_{cor}",
            "power_seller_status": "platinum", "real_level": None, "protection_end_date": None,
            "sales_period": "60 days", "sales_completed": 5000,
            "seller_reputation": {"metrics": {"claims": {"rate": claims, "value": 30}}}}


def diario(marca="kokeshi", dias=60, **extra):
    """Uma linha por dia, de FIM para tras: 100 pedidos, 2 reclamacoes, 2 pedidos cancelados,
    3 reembolsos (R$ 150), 1 mediacao."""
    linhas = [{"marca": marca, "dia": d.isoformat() + "T00:00:00-03:00", "pedidos": 100, "reclamacoes": 2,
               "pedidos_cancelados": 2, "reembolsos": 3, "valor_reembolsado": 150.0, "mediacoes": 1,
               "perguntas": 3, "perguntas_respondidas": 2, "perguntas_sem_resposta_24h": None,
               "tempo_resposta_min": None, "mensagens_pendentes": None} for d in _dias(dias)]
    # a foto da conta e' do dia de hoje
    linhas.append({"marca": marca, "dia": "2026-11-10T00:00:00-03:00", "pedidos": 10, "reclamacoes": 1,
                   "pedidos_cancelados": None, "reembolsos": None, "valor_reembolsado": None, "mediacoes": None,
                   "perguntas": None, "perguntas_respondidas": None, "perguntas_sem_resposta_24h": None,
                   "tempo_resposta_min": 2737.0, "mensagens_pendentes": 20})
    for linha in linhas:
        linha.update(extra)
    return linhas


def reclamacoes(marca="kokeshi"):
    return [
        {"bloco": "motivo", "marca": marca, "k1": "reclamacao", "k2": "repentant_buyer", "n1": 30},
        {"bloco": "motivo", "marca": marca, "k1": "reclamacao", "k2": "broken_item", "n1": 10},
        {"bloco": "motivo", "marca": marca, "k1": "reclamacao", "k2": "motivo_novo_xyz", "n1": 2},
        {"bloco": "motivo", "marca": marca, "k1": "cancelamento", "k2": "out_of_stock", "n1": 5},
        {"bloco": "fila", "marca": marca, "n1": 7, "n2": 2, "n3": 1, "instante_em": AGORA - timedelta(days=3)},
        {"bloco": "resposta", "marca": marca, "n1": 40, "n2": 30, "n3": 60, "x": 5.26},
        {"bloco": "perguntas", "marca": marca, "n1": 4, "n2": 1, "instante_em": AGORA - timedelta(days=2)},
        {"bloco": "fonte", "marca": marca, "instante_em": AGORA - timedelta(hours=1)},
    ]


class Fonte:
    def __init__(self, marcas=("kokeshi",), falhas=(), dias=60, recl=None, diar=None, rep=None):
        self.falhas = set(falhas)
        self.chamadas = []
        self.diar = diar if diar is not None else [r for m in marcas for r in diario(m, dias)]
        self.recl = recl if recl is not None else [r for m in marcas for r in reclamacoes(m)]
        self.rep = rep if rep is not None else [reputacao(m) for m in marcas]

    def __call__(self, sql, params):
        nome = {ml.SQL_DIARIO: "diario", po.SQL_ML: "reputacao"}.get(sql, "reclamacoes")
        self.chamadas.append((nome, params))
        if nome in self.falhas:
            raise RuntimeError(f"falhou em {SEGREDO}")
        return {"diario": self.diar, "reputacao": self.rep}.get(nome, self.recl)


def montar(fonte=None, dias=30, brands=None):
    fonte = fonte or Fonte()
    return ml.montar_cx_ml(brands=brands, dias=dias, consultar=fonte, agora=AGORA), fonte


def test_janela_e_tres_consultas_so():
    r, f = montar()
    assert (r.janela.inicio, r.janela.fim) == (date(2026, 10, 11), FIM)
    assert (r.janela_anterior.inicio, r.janela_anterior.fim) == (date(2026, 9, 11), date(2026, 10, 10))
    assert sorted(n for n, _ in f.chamadas) == ["diario", "reclamacoes", "reputacao"]
    assert r.cobertura.marcas == ["barbours", "kokeshi", "lescent", "rituaria"]


def test_totais_da_janela_e_do_periodo_anterior():
    r, _ = montar()
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.pedidos, k.reclamacoes, k.cancelamentos, k.mediacoes, k.perguntas) == (3000, 60, 60, 30, 90)
    assert (k.reembolsos, k.valor_reembolsado) == (90, 4500.0)
    assert (k.pedidos_anterior, k.reclamacoes_anterior, k.cancelamentos_anterior, k.mediacoes_anterior) == (3000, 60, 60, 30)
    assert k.reembolsos_anterior == 90
    assert r.sem_anterior == {}


def test_fila_vem_da_ultima_leitura_e_nao_da_janela():
    r, _ = montar(dias=7)
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.aguardando_nos, k.vencidas, k.vencem_24h) == (7, 2, 1)
    assert k.prazo_mais_antigo == AGORA - timedelta(days=3)


def test_perguntas_sem_resposta_vem_do_estado_de_agora_e_as_de_24h_da_view_somando_todos_os_dias():
    # cada pergunta conta no dia em que foi criada: uma recente (dentro da janela) e uma de 60 dias atras
    diar = diario(dias=60)
    diar[0]["perguntas_sem_resposta_24h"] = 1
    diar[59]["perguntas_sem_resposta_24h"] = 2
    diar[1]["perguntas_sem_resposta_24h"] = 0
    r, _ = montar(Fonte(diar=diar), dias=7)
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.perguntas_sem_resposta, k.perguntas_sem_resposta_24h) == (4, 3)
    assert k.pergunta_mais_antiga == AGORA - timedelta(days=2)


def test_perguntas_de_24h_sem_leitura_na_view_e_none_nunca_zero():
    r, _ = montar(dias=7)
    assert next(m for m in r.marcas if m.marca == "kokeshi").perguntas_sem_resposta_24h is None


def test_cancelamento_e_reembolso_vem_da_view_e_valor_reembolsado_soma_a_janela():
    r, _ = montar(dias=7)
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.pedidos, k.cancelamentos, k.reembolsos, k.valor_reembolsado) == (700, 14, 21, 1050.0)


def test_reembolso_e_cancelado_sem_leitura_na_view_ficam_none_nunca_zero():
    diar = [{**x, "pedidos_cancelados": None, "reembolsos": None, "valor_reembolsado": None} for x in diario()]
    r, _ = montar(Fonte(diar=diar))
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert k.pedidos == 3000 and k.cancelamentos is None and k.reembolsos is None and k.valor_reembolsado is None
    assert k.reembolsos_anterior is None and k.cancelamentos_anterior is None


def test_taxa_de_resposta_tem_respondidas_perguntas_e_o_anterior():
    r, _ = montar()
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.perguntas, k.perguntas_respondidas) == (90, 60)
    assert (k.perguntas_anterior, k.perguntas_respondidas_anterior) == (90, 60)


def test_reputacao_oficial_vem_da_mesma_leitura_da_performance():
    r, f = montar(Fonte(marcas=("kokeshi", "lescent"), rep=[reputacao("kokeshi", claims=0.02, cor="yellow")]))
    rep = r.reputacao
    assert rep.estado == "dado" and rep.fonte == po.FONTE_ML
    k = rep.contas[0]
    assert (k.marca, k.nivel, k.tom) == ("kokeshi", "MercadoLíder Platinum", "atencao")
    assert [(m.codigo, m.situacao) for m in k.metricas] == [("ml_claims", "fora")]
    assert [(s.marca) for s in rep.sem_foto] == ["barbours", "lescent", "rituaria"]


def test_reputacao_caida_nao_derruba_o_resto():
    r, _ = montar(Fonte(falhas=("reputacao",)))
    assert r.reputacao.estado == "erro" and r.reputacao.contas == [] and SEGREDO not in r.model_dump_json()
    assert r.diario_estado == "dado" and next(m for m in r.marcas if m.marca == "kokeshi").pedidos == 3000


def test_foto_da_conta_e_a_mais_recente_e_oficial():
    r, _ = montar()
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.tempo_resposta_min, k.mensagens_pendentes, k.conta_dia) == (2737.0, 20, date(2026, 11, 10))


def test_primeira_resposta_e_parcial_com_a_cobertura_ao_lado():
    r, _ = montar()
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.resposta_mediana_h, k.reclamacoes_com_historico, k.reclamacoes_respondidas) == (5.3, 40, 30)


def test_motivos_em_portugues_e_codigo_novo_nao_some():
    r, _ = montar()
    rec = r.reclamacoes_motivos
    assert rec.estado == "dado" and rec.total == 42
    assert [i.rotulo for i in rec.itens][:2] == ["Arrependimento do comprador", "Produto com defeito ou quebrado"]
    novo = next(i for i in rec.itens if i.codigo == "motivo_novo_xyz")
    assert novo.mapeado is False and novo.rotulo == "motivo novo xyz"
    can = r.cancelamentos_motivos
    assert can.total == 5 and can.itens[0].rotulo == "Sem estoque" and can.itens[0].natureza == "vendedor"


def test_apice_fica_fora_e_so_apice_nao_consulta_nada():
    r, f = montar(brands=["apice"])
    assert r.cobertura.marcas == [] and r.cobertura.fora[0].marca == "apice"
    assert r.marcas == [] and f.chamadas == []
    r2, f2 = montar(brands=["apice", "kokeshi"])
    assert [m.marca for m in r2.marcas] == ["kokeshi"] and f2.chamadas[0][1]["marcas"] == ["kokeshi"]


def test_90_dias_nao_tem_anterior_porque_a_view_so_guarda_90():
    r, _ = montar(dias=90)
    assert set(r.sem_anterior) == {"resposta", "reclamacao", "cancelamento", "mediacao", "reembolso"}
    assert r.sem_anterior["reclamacao"].a_partir_de is None
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert k.pedidos_anterior is None and k.reclamacoes_anterior is None
    assert k.reclamacoes is not None  # o atual segue coberto (12/08 a 09/11)


def test_anterior_antes_da_coleta_diz_desde_quando_e_quando_passa_a_existir():
    sem = ml.sem_anterior_ml(
        ml.base.calcular_janela(30, datetime(2026, 9, 20, tzinfo=timezone.utc)),
        ml.Janela(inicio=date(2026, 7, 21), fim=date(2026, 8, 19), dias=30), date(2026, 9, 20))
    # so' o que depende da coleta de reclamacoes: cancelamento e reembolso vem da view de pedidos
    assert set(sem) == {"resposta", "reclamacao", "mediacao"}
    assert sem["reclamacao"].motivo == "coleta desde 12/08" and sem["reclamacao"].a_partir_de == date(2026, 10, 11)


def test_janela_que_comeca_antes_da_coleta_nao_mostra_numero_parcial():
    antes = datetime(2026, 9, 1, 20, 0, tzinfo=timezone.utc)  # 30 d = 02/08 a 31/08: metade sem coleta
    f = Fonte(dias=140)
    r = ml.montar_cx_ml(dias=30, consultar=f, agora=antes)
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert k.reclamacoes is None and k.mediacoes is None
    assert r.reclamacoes_motivos.estado == "sem_fonte" and r.reclamacoes_motivos.itens == []
    assert all(p.reclamacoes is None for p in r.serie_diaria)
    # cancelamento e reembolso nao dependem da coleta de reclamacoes: a janela e o anterior seguem medidos
    assert (k.cancelamentos, k.reembolsos) == (60, 90) and (k.cancelamentos_anterior, k.reembolsos_anterior) == (60, 90)
    assert k.reclamacoes_anterior is None and "cancelamento" not in r.sem_anterior and "reembolso" not in r.sem_anterior
    assert all(p.cancelamentos == 2 and p.reembolsos == 3 for p in r.serie_diaria if p.marca == "kokeshi")


def test_serie_diaria_um_ponto_por_dia_e_marca():
    r, _ = montar(dias=7, brands=["kokeshi"])
    assert len(r.serie_diaria) == 7 and r.serie_diaria[0].dia == date(2026, 11, 3)
    assert (r.serie_diaria[0].pedidos, r.serie_diaria[0].reclamacoes) == (100, 2)
    assert (r.serie_diaria[0].cancelamentos, r.serie_diaria[0].reembolsos) == (2, 3)


def test_dia_sem_linha_na_view_e_none_nunca_zero():
    sem_um = [x for x in diario(dias=7) if not x["dia"].startswith("2026-11-05")]
    r, _ = montar(Fonte(diar=sem_um), dias=7, brands=["kokeshi"])
    ponto = next(p for p in r.serie_diaria if p.dia == date(2026, 11, 5))
    assert ponto.pedidos is None and ponto.reclamacoes is None
    assert ponto.cancelamentos is None and ponto.reembolsos is None


def test_marca_sem_reclamacao_guardada_fica_sem_numero_de_reclamacao():
    r, _ = montar(Fonte(marcas=("kokeshi", "lescent"), recl=reclamacoes("kokeshi")))
    le = next(m for m in r.marcas if m.marca == "lescent")
    assert le.pedidos == 3000 and le.reclamacoes is None and le.aguardando_nos is None


@pytest.mark.parametrize("cai", ["diario", "reclamacoes"])
def test_uma_fonte_cai_a_outra_segue_sem_vazar_a_excecao(cai):
    r, _ = montar(Fonte(falhas=(cai,)))
    assert r.motivo_indisponivel and SEGREDO not in r.model_dump_json()
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    if cai == "diario":
        assert r.diario_estado == "erro" and k.pedidos is None and k.aguardando_nos == 7
        assert r.serie_diaria == []
    else:
        assert r.reclamacoes_estado == "erro" and k.pedidos == 3000 and k.aguardando_nos is None
        assert r.reclamacoes_motivos.estado == "erro" and k.reclamacoes is None


def test_coleta_velha_ganha_aviso():
    velha = [{**x, "instante_em": AGORA - timedelta(hours=40)} if x["bloco"] == "fonte" else x for x in reclamacoes()]
    r, _ = montar(Fonte(recl=velha))
    assert "40 h" in r.aviso_frescor
    assert montar()[0].aviso_frescor is None


def test_devolucao_e_pendencia_nunca_zero_e_reembolso_nao_e_mais():
    r, _ = montar()
    assert [p.codigo for p in r.pendencias] == ["ml_devolucoes"]
    assert "devolucoes" not in r.marcas[0].model_dump()


def test_sql_diario_traz_as_colunas_novas_na_mesma_consulta_e_o_backlog_fora_da_janela():
    for col in ("pedidos_cancelados", "reembolsos", "valor_reembolsado", "perguntas_sem_resposta_24h"):
        assert col in ml.SQL_DIARIO
    assert "devolucoes" not in ml.SQL_DIARIO
    assert "dia >= :desde OR perguntas_sem_resposta_24h > 0" in ml.SQL_DIARIO


def test_sql_de_reclamacao_so_le_e_usa_a_regra_da_view():
    assert ml.SQL_RECLAMACOES.lstrip().upper().startswith("WITH") and "UPDATE" not in ml.SQL_RECLAMACOES.upper()
    assert "'cancel_purchase', 'cancel_sale'" in ml.SQL_RECLAMACOES
    assert "status = 'opened' AND acao_pendente_vendedor" in ml.SQL_RECLAMACOES
    assert "papel = 'respondent'" in ml.SQL_RECLAMACOES


# --- rota -------------------------------------------------------------------
@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(rota.router)
    monkeypatch.setattr(settings, "cx_api_enabled", True)
    chamadas = []
    original = ml.montar_cx_ml

    def falso(*, brands=None, dias=30):
        chamadas.append((brands, dias))
        return original(brands=brands, dias=dias, consultar=Fonte(), agora=AGORA)

    monkeypatch.setattr(ml, "montar_cx_ml", falso)
    return TestClient(app), chamadas


def test_rota_responde_e_repassa_filtros(cliente):
    c, chamadas = cliente
    r = c.get(URL, params={"brands": "Kokeshi,apice", "dias": "7"})
    assert r.status_code == 200 and chamadas == [(["apice", "kokeshi"], 7)]
    assert r.json()["cobertura"]["fora"][0]["marca"] == "apice"


def test_flag_desligada_e_404(cliente, monkeypatch):
    c, chamadas = cliente
    monkeypatch.setattr(settings, "cx_api_enabled", False)
    assert c.get(URL).status_code == 404 and chamadas == []


@pytest.mark.parametrize("params", [{"brands": "<script>"}, {"brands": "gocase"}, {"dias": "15"}])
def test_entrada_invalida_e_422(cliente, params):
    c, chamadas = cliente
    assert c.get(URL, params=params).status_code == 422 and chamadas == []
