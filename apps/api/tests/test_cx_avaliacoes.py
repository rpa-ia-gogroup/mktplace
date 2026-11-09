"""Avaliacoes de produto da Shopee — `GET /api/v1/cx/shopee/avaliacoes`.

O que estes testes existem para impedir:
  1. nota da marca virar media das medias (tem que ser ponderada por com_nota);
  2. marca nunca varrida (Apice) ou sem app (Kokeshi) virar zero ou sumir;
  3. contagem truncada perder o "piso" no total;
  4. produto com poucas avaliacoes liderar a lista (minimo de 20);
  5. fonte caida vazar o texto da excecao; view ausente virar zero;
  6. consulta ler texto de avaliacao ou comprador (PII); entrada invalida ecoada.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.routers import cx_atendimento as rota
from app.services import cx_avaliacoes_service as svc

URL = "/api/v1/cx/shopee/avaliacoes"
SEGREDO = "postgresql://usuario:senha-NAO-PODE-VAZAR@host/db"
AGORA = datetime(2026, 11, 9, 15, 0, tzinfo=timezone.utc)
VARRIDO = datetime(2026, 11, 9, 13, 40, tzinfo=timezone.utc)


def _marca(marca, itens, avaliacoes, com_nota, media, um_a_tres, respondidas, truncado=False, varrido=VARRIDO):
    return {"marca": marca, "itens": itens, "avaliacoes": avaliacoes, "com_nota": com_nota,
            "soma_notas": media * com_nota, "avaliacoes_1a3": um_a_tres, "respondidas": respondidas,
            "truncado": truncado, "varrido_em": varrido, "completa_em": varrido}


def _produto(marca, item, nome, com_nota, media, um_a_tres, truncado=False):
    return {"marca": marca, "item_id": item, "nome": nome, "avaliacoes": com_nota, "com_nota": com_nota,
            "nota_media": media, "avaliacoes_1a3": um_a_tres, "truncado": truncado}


class Fonte:
    def __init__(self, existe=True, falhas=(), marcas=None, produtos=None):
        self.existe, self.falhas, self.chamadas = existe, set(falhas), []
        self.marcas = marcas if marcas is not None else [
            # barbours: 1000 com nota a 4,9; lescent: 100 a 3,9 -> ponderada 4,81 (media das medias daria 4,40)
            _marca("barbours", 10, 1000, 1000, 4.9, 30, 100),
            _marca("lescent", 5, 100, 100, 3.9, 40, 0, truncado=True),
        ]
        self.produtos = produtos if produtos is not None else [
            _produto("barbours", "1", "Shampoo", 500, 4.95, 5),
            _produto("lescent", "2", "Perfume", 80, 3.5, 30),
            _produto("lescent", "3", None, 25, 3.5, 12),
        ]

    def __call__(self, sql, params):
        nome = "existe" if sql == svc.SQL_EXISTE else "marcas" if sql == svc.SQL_MARCAS else "produtos"
        self.chamadas.append((nome, params))
        if nome in self.falhas:
            raise RuntimeError(SEGREDO)
        if nome == "existe":
            return [{"existe": self.existe}]
        return self.marcas if nome == "marcas" else self.produtos


def _montar(fonte=None, **kw):
    return svc.montar_avaliacoes(consultar=fonte or Fonte(), agora=AGORA, **kw)


def test_nota_da_marca_e_do_total_ponderada_por_com_nota():
    r = _montar()
    por = {m.marca: m for m in r.marcas}
    assert por["barbours"].nota_media == 4.9
    assert por["barbours"].pct_1a3 == 3.0 and por["barbours"].pct_respondidas == 10.0
    assert r.total.nota_media == round((4.9 * 1000 + 3.9 * 100) / 1100, 2) == 4.81
    assert r.total.avaliacoes == 1100
    assert r.total.pct_1a3 == round(70 / 1100 * 100, 1)


def test_nenhuma_respondida_e_nao_medido_nunca_zero():
    sem = Fonte(marcas=[_marca("barbours", 10, 1000, 1000, 4.9, 30, 0), _marca("lescent", 5, 100, 100, 3.9, 40, 0)])
    r = _montar(sem)
    assert r.respostas_medidas is False
    assert all(m.pct_respondidas is None for m in r.marcas) and r.total.pct_respondidas is None
    # uma respondida ja' basta: ai' o 0% da outra marca e' medido
    r = _montar()
    assert r.respostas_medidas is True
    assert {m.marca: m.pct_respondidas for m in r.marcas if m.estado == "dado"} == {"barbours": 10.0, "lescent": 0.0}


def test_marca_nunca_varrida_e_sem_app_aparecem_sem_fonte_nunca_zero():
    r = _montar()
    por = {m.marca: m for m in r.marcas}
    assert [m.marca for m in r.marcas] == list(svc.MARCAS_PERMITIDAS)
    assert por["apice"].estado == "sem_fonte" and por["apice"].avaliacoes is None
    assert por["apice"].motivo == svc.MOTIVO_NAO_VARRIDA
    assert por["kokeshi"].estado == "sem_fonte" and por["kokeshi"].motivo == svc.MOTIVO_SEM_APP
    # o total soma so' quem tem dado
    assert r.total.avaliacoes == 1100


def test_truncado_de_uma_marca_vira_piso_no_total():
    r = _montar()
    assert {m.marca: m.truncado for m in r.marcas if m.estado == "dado"} == {"barbours": False, "lescent": True}
    assert r.total.truncado is True


def test_teto_da_api_vira_piso_nas_consultas():
    fonte = Fonte()
    _montar(fonte)
    assert all(p["teto"] == svc.TETO_API_SHOPEE == 1000 for n, p in fonte.chamadas if n != "existe")
    assert "avaliacoes >= :teto" in svc.SQL_MARCAS and "avaliacoes >= :teto" in svc.SQL_PRODUTOS


def test_minimo_de_avaliacoes_e_ordem_pior_nota_desempate_por_1a3():
    fonte = Fonte()
    r = _montar(fonte)
    produtos_params = next(p for n, p in fonte.chamadas if n == "produtos")
    assert produtos_params["minimo"] == svc.MINIMO_AVALIACOES == 20
    assert [p.item_id for p in r.produtos] == ["2", "3", "1"]  # 3,5 (30 de 1-3) antes de 3,5 (12)
    assert r.produtos[1].nome is None  # fora do catalogo: a tela mostra "Produto {item_id}"
    assert r.produtos[0].pct_1a3 == 37.5


def test_kokeshi_nunca_e_consultada():
    fonte = Fonte()
    _montar(fonte)
    assert all("kokeshi" not in (p.get("marcas") or []) for _, p in fonte.chamadas)
    r = _montar(Fonte(), brands=["kokeshi"])
    assert r.estado == "sem_fonte" and r.marcas[0].motivo == svc.MOTIVO_SEM_APP


def test_view_ausente_e_sem_fonte_nunca_zero():
    r = _montar(Fonte(existe=False))
    assert r.estado == "sem_fonte" and r.total is None and r.produtos == []
    assert all(m.avaliacoes is None for m in r.marcas)


def test_fonte_caida_vira_erro_sem_vazar_segredo():
    for falha in ("existe", "marcas", "produtos"):
        r = _montar(Fonte(falhas={falha}))
        assert r.estado == "erro" and SEGREDO not in r.model_dump_json()


def test_frescor_marca_parada_ha_mais_de_2_dias():
    velho = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)
    r = _montar(Fonte(marcas=[_marca("barbours", 1, 10, 10, 5.0, 0, 0), _marca("lescent", 1, 10, 10, 5.0, 0, 0, varrido=velho)]))
    assert r.aviso_frescor and "LESCENT" in r.aviso_frescor.upper() and "BARBOURS" not in r.aviso_frescor.upper()
    assert _montar().aviso_frescor is None


def test_consultas_nao_leem_pii():
    for sql in (svc.SQL_MARCAS, svc.SQL_PRODUTOS):
        baixo = sql.lower()
        assert "comment" not in baixo.replace("shopee_product_comments", "")
        for proibido in ("buyer", "username", "order_sn", "description"):
            assert proibido not in baixo


@pytest.fixture
def cliente(monkeypatch):
    app = FastAPI()
    app.include_router(rota.router)
    monkeypatch.setattr(settings, "cx_api_enabled", True)
    chamadas = []
    original = svc.montar_avaliacoes

    def falso(*, brands=None):
        chamadas.append(brands)
        return original(consultar=Fonte(), agora=AGORA, brands=brands)

    monkeypatch.setattr(svc, "montar_avaliacoes", falso)
    return TestClient(app), chamadas


def test_rota_repassa_marcas(cliente):
    c, chamadas = cliente
    assert c.get(URL, params={"brands": "lescent,barbours"}).status_code == 200
    assert chamadas[-1] == ["barbours", "lescent"]


def test_marca_invalida_e_422_sem_eco(cliente):
    c, _ = cliente
    r = c.get(URL, params={"brands": "<script>"})
    assert r.status_code == 422 and "<script>" not in r.text


def test_flag_desligada_e_404(cliente, monkeypatch):
    c, _ = cliente
    monkeypatch.setattr(settings, "cx_api_enabled", False)
    assert c.get(URL).status_code == 404
