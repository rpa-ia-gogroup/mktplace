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

URL = "/api/v1/cx/mercadolivre"
SEGREDO = "postgresql://usuario:senha-NAO-PODE-VAZAR@host/db"
AGORA = datetime(2026, 11, 10, 20, 0, tzinfo=timezone.utc)  # 17:00 em Sao Paulo
FIM = date(2026, 11, 9)  # ultimo dia fechado


def _dias(n: int, fim: date = FIM):
    return [fim - timedelta(days=i) for i in range(n)]


def diario(marca="kokeshi", dias=60, **extra):
    """Uma linha por dia, de FIM para tras: 100 pedidos, 2 reclamacoes, 1 cancelamento, 1 mediacao."""
    linhas = [{"marca": marca, "dia": d.isoformat() + "T00:00:00-03:00", "pedidos": 100, "reclamacoes": 2,
               "cancelamentos": 1, "mediacoes": 1, "perguntas": 3, "perguntas_sem_resposta": 1,
               "tempo_resposta_min": None, "mensagens_pendentes": None} for d in _dias(dias)]
    # a foto da conta e' do dia de hoje
    linhas.append({"marca": marca, "dia": "2026-11-10T00:00:00-03:00", "pedidos": 10, "reclamacoes": 1,
                   "cancelamentos": None, "mediacoes": None, "perguntas": None, "perguntas_sem_resposta": None,
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
        {"bloco": "fonte", "marca": marca, "instante_em": AGORA - timedelta(hours=1)},
    ]


class Fonte:
    def __init__(self, marcas=("kokeshi",), falhas=(), dias=60, recl=None, diar=None):
        self.falhas = set(falhas)
        self.chamadas = []
        self.diar = diar if diar is not None else [r for m in marcas for r in diario(m, dias)]
        self.recl = recl if recl is not None else [r for m in marcas for r in reclamacoes(m)]

    def __call__(self, sql, params):
        nome = "diario" if sql == ml.SQL_DIARIO else "reclamacoes"
        self.chamadas.append((nome, params))
        if nome in self.falhas:
            raise RuntimeError(f"falhou em {SEGREDO}")
        return self.diar if nome == "diario" else self.recl


def montar(fonte=None, dias=30, brands=None):
    fonte = fonte or Fonte()
    return ml.montar_cx_ml(brands=brands, dias=dias, consultar=fonte, agora=AGORA), fonte


def test_janela_e_duas_consultas_so():
    r, f = montar()
    assert (r.janela.inicio, r.janela.fim) == (date(2026, 10, 11), FIM)
    assert (r.janela_anterior.inicio, r.janela_anterior.fim) == (date(2026, 9, 11), date(2026, 10, 10))
    assert sorted(n for n, _ in f.chamadas) == ["diario", "reclamacoes"]
    assert r.cobertura.marcas == ["barbours", "kokeshi", "lescent", "rituaria"]


def test_totais_da_janela_e_do_periodo_anterior():
    r, _ = montar()
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.pedidos, k.reclamacoes, k.cancelamentos, k.mediacoes, k.perguntas) == (3000, 60, 30, 30, 90)
    assert (k.pedidos_anterior, k.reclamacoes_anterior, k.cancelamentos_anterior, k.mediacoes_anterior) == (3000, 60, 30, 30)
    assert r.sem_anterior == {}


def test_fila_vem_da_ultima_leitura_e_nao_da_janela():
    r, _ = montar(dias=7)
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert (k.aguardando_nos, k.vencidas, k.vencem_24h) == (7, 2, 1)
    assert k.prazo_mais_antigo == AGORA - timedelta(days=3)


def test_perguntas_sem_resposta_somam_tudo_que_a_coleta_guarda():
    r, _ = montar(dias=7)
    assert next(m for m in r.marcas if m.marca == "kokeshi").perguntas_sem_resposta == 60


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
    assert set(r.sem_anterior) == {"reclamacao", "cancelamento", "mediacao"}
    assert r.sem_anterior["reclamacao"].a_partir_de is None
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert k.pedidos_anterior is None and k.reclamacoes_anterior is None
    assert k.reclamacoes is not None  # o atual segue coberto (12/08 a 09/11)


def test_anterior_antes_da_coleta_diz_desde_quando_e_quando_passa_a_existir():
    sem = ml.sem_anterior_ml(
        ml.base.calcular_janela(30, datetime(2026, 9, 20, tzinfo=timezone.utc)),
        ml.Janela(inicio=date(2026, 7, 21), fim=date(2026, 8, 19), dias=30), date(2026, 9, 20))
    assert sem.motivo == "coleta desde 12/08" and sem.a_partir_de == date(2026, 10, 11)


def test_janela_que_comeca_antes_da_coleta_nao_mostra_numero_parcial():
    antes = datetime(2026, 9, 1, 20, 0, tzinfo=timezone.utc)  # 30 d = 02/08 a 31/08: metade sem coleta
    f = Fonte(dias=100)
    r = ml.montar_cx_ml(dias=30, consultar=f, agora=antes)
    k = next(m for m in r.marcas if m.marca == "kokeshi")
    assert k.reclamacoes is None and k.cancelamentos is None and k.mediacoes is None
    assert r.reclamacoes_motivos.estado == "sem_fonte" and r.reclamacoes_motivos.itens == []
    assert all(p.reclamacoes is None for p in r.serie_diaria)


def test_serie_diaria_um_ponto_por_dia_e_marca():
    r, _ = montar(dias=7, brands=["kokeshi"])
    assert len(r.serie_diaria) == 7 and r.serie_diaria[0].dia == date(2026, 11, 3)
    assert (r.serie_diaria[0].pedidos, r.serie_diaria[0].reclamacoes) == (100, 2)


def test_dia_sem_linha_na_view_e_none_nunca_zero():
    sem_um = [x for x in diario(dias=7) if not x["dia"].startswith("2026-11-05")]
    r, _ = montar(Fonte(diar=sem_um), dias=7, brands=["kokeshi"])
    ponto = next(p for p in r.serie_diaria if p.dia == date(2026, 11, 5))
    assert ponto.pedidos is None and ponto.reclamacoes is None


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


def test_devolucao_e_pendencia_nunca_zero():
    r, _ = montar()
    assert [p.codigo for p in r.pendencias] == ["ml_devolucoes"]
    assert "devolucoes" not in r.marcas[0].model_dump()


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
