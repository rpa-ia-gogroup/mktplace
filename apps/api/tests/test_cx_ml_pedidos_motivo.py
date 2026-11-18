"""Pareto do ML -> marca -> SKU: reclamacoes de um motivo com os produtos dos pedidos."""
from datetime import datetime, timezone

from app.services import cx_pedidos_service as svc

AGORA = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)


class Fake:
    def __init__(self):
        self.chamadas = []

    def __call__(self, sql, p):
        self.chamadas.append((sql, p))
        if "ml_cx_reclamacoes" in sql:
            return [
                {"marca": "barbours", "claim_id": 1, "dia": "2026-11-17", "status": "opened", "total": 2, "pedidos": "10,11"},
                {"marca": "kokeshi", "claim_id": 2, "dia": "2026-11-16", "status": "closed", "total": 2, "pedidos": None},
            ]
        return [
            {"order_sn": "10", "sku": "A", "produto": "Prod A", "quantidade": 1},
            {"order_sn": "11", "sku": "B", "produto": "Prod B", "quantidade": 2},
        ]


def test_motivo_ml_junta_itens_do_envio_e_filtra_pelo_texto_cru():
    f = Fake()
    r = svc.montar_pedidos_motivo_ml(tipo="cancelamento", codigo="other_cancellation_reason",
                                     brands=["barbours", "kokeshi"], dias=7, consultar=f, agora=AGORA)
    assert r.estado == "dado" and r.total == 2 and r.tipo == "cancelamento"
    p = f.chamadas[0][1]
    assert p["cancelamento"] is True and p["texto"] == "other_cancellation_reason"
    barb = next(x for x in r.pedidos if x.marca == "barbours")
    assert [i.sku for i in barb.itens] == ["A", "B"] and barb.situacao == "Aberta"
    assert next(x for x in r.pedidos if x.marca == "kokeshi").itens == []


def test_sem_motivo_vira_texto_vazio_e_falha_vira_erro():
    def quebra(sql, p):
        raise RuntimeError("x")
    r = svc.montar_pedidos_motivo_ml(tipo="reclamacao", codigo="sem_motivo", brands=["barbours"],
                                     dias=7, consultar=quebra, agora=AGORA)
    assert r.estado == "erro"
