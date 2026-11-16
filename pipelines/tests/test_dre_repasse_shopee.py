"""T-0120b — repasse da Shopee do escrow no publisher de insumos da DRE.

Regras PURAS (sem banco): inercia antes da 048, contrato da linha publicada
(valor = soma de `valor_repasse` = `escrow_amount`, cobertura em pedidos,
ausencia != zero, negativo aceito), a mesma leitura da taxa (uma consulta so'),
deriva do CHECK sob o lock e o contrato com a migration 048.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from pipelines.dre import insumo_publisher as P
from pipelines.tests.test_dre_devolucoes_shopee_publisher import (
    CHECK_045,
    _AlvoDry,
    _Conn,
    _definicao,
    carregar_migration_045,
)
from pipelines.tests.test_dre_insumo_publisher import (
    CHECK_025,
    _AlvoFake,
    _carregar_migration,
    _ConnFonte,
    _FonteFake,
    _lista_do_check,
    _Res,
    carregar_migration_025,
    esperado,
)

OUT = date(2026, 10, 1)
NOV = date(2026, 11, 1)
AGORA = datetime(2026, 12, 2, 12, 0, tzinfo=timezone.utc)
MARCAS = ("apice", "barbours", "kokeshi", "lescent", "rituaria")
#: Literal (e nao `P.REPASSE_SHOPEE`): o modulo tem de carregar mesmo sem a implementacao.
COMPONENTE = "shopee_repasse_escrow"
CHECK_048 = _definicao(carregar_migration_045().COMPONENTES + (COMPONENTE,))


def carregar_migration_048():
    return _carregar_migration("048_dre_insumo_repasse_shopee.py")


def tx(marca="apice", mes=OUT, pedidos=100, com=100, taxa="2500.00", repasse="7400.50", com_repasse=None,
       negativos=0, parcelas_negativas=0, atualizado=datetime(2026, 11, 10, 9, 30)):
    """Uma linha da leitura da taxa+repasse Shopee (competencia x marca)."""
    return {"competencia": mes, "marca": marca, "pedidos": pedidos, "pedidos_com_escrow": com,
            "taxa": None if taxa is None else Decimal(taxa), "parcelas_negativas": parcelas_negativas,
            "pedidos_com_repasse": com if com_repasse is None else com_repasse,
            "repasse": None if repasse is None else Decimal(repasse), "repasses_negativos": negativos,
            "atualizado_em": atualizado}


def lote(rows, marcas=MARCAS, comps=(OUT,), taxa=True, repasse=True):
    esp = [esperado("shopee", m, gmv=100_000, mes=c) for c in comps for m in marcas]
    return P.montar_lote(esperado=esp, cmv=[], contraprova=[], repasse=[], canais=["shopee"], comps=list(comps),
                         taxa_shopee=list(rows) if taxa else None,
                         repasse_shopee=list(rows) if repasse else None)


def linhas_rep(lt) -> dict:
    return {(r["competencia"], r["marca"]): r for r in lt.linhas if r["componente"] == COMPONENTE}


# ---------------------------------------------------------------------------
# Inerte antes da 048
# ---------------------------------------------------------------------------

def test_inerte_sem_a_048_o_lote_e_identico_ao_de_antes():
    rows = [tx(m) for m in MARCAS]
    antes = P.montar_lote(esperado=[esperado("shopee", m, gmv=100_000, mes=OUT) for m in MARCAS], cmv=[],
                          contraprova=[], repasse=[], canais=["shopee"], comps=[OUT], taxa_shopee=rows)
    inerte = lote(rows, repasse=False)
    assert inerte.linhas == antes.linhas and inerte.extraidas == antes.extraidas
    assert not linhas_rep(inerte)
    assert "migration 048 pendente" in P.estado_repasse_shopee(None, ["shopee"])
    assert P.estado_repasse_shopee(None, ["ml"]) == "fora do escopo"


# ---------------------------------------------------------------------------
# Com a 048: contrato da linha
# ---------------------------------------------------------------------------

def test_componente_com_valor_soma_valor_repasse_e_nomeia_a_coluna():
    lt = lote([tx(m, repasse=f"{1000 + i}.25") for i, m in enumerate(MARCAS)])
    ln = linhas_rep(lt)
    assert lt.recusas == [] and set(ln) == {(OUT, m) for m in MARCAS}
    for i, m in enumerate(MARCAS):
        r = ln[(OUT, m)]
        assert r["valor"] == Decimal(f"{1000 + i}.25") and r["canal"] == "shopee"
        assert r["cobertura"] == Decimal("1.000000")
        assert r["sinal_origem"] is None  # receita/recebivel, nao custo (convencao da 025)
        assert r["status_reconciliacao"] == "nao_avaliado"
        assert r["procedencia"] == P.PROC_REPASSE_SHOPEE
        assert r["data_max_origem"] == datetime(2026, 11, 10, 9, 30, tzinfo=timezone.utc)
    assert "valor_repasse" in P.PROC_REPASSE_SHOPEE
    assert "escrow_amount, antes de ajustes posteriores" in P.PROC_REPASSE_SHOPEE
    assert ln[(OUT, "apice")]["motivo"] == (
        "escrow_amount, antes de ajustes posteriores; escrow em 100 de 100 pedidos nao cancelados")
    # a taxa continua saindo do mesmo lote, igual
    assert sum(1 for r in lt.linhas if r["componente"] == P.TAXA_SHOPEE) == len(MARCAS)
    assert lt.extraidas == len(MARCAS)  # a mesma leitura: nao conta duas vezes


def test_cobertura_parcial_abaixo_de_100_por_cento():
    r = linhas_rep(lote([tx("apice", pedidos=8168, com=8121, repasse="423257.41")]))[(OUT, "apice")]
    assert r["valor"] == Decimal("423257.41")
    assert r["cobertura"] == (Decimal(8121) / Decimal(8168)).quantize(Decimal("0.000001"))
    assert r["cobertura"] < 1
    assert "escrow em 8121 de 8168 pedidos nao cancelados" in r["motivo"]


def test_repasse_negativo_e_aceito_e_nao_recusa_o_lote():
    lt = lote([tx("apice", repasse="-150.00", negativos=3), tx("barbours", repasse="555641.50", negativos=12)])
    assert lt.recusas == []
    ln = linhas_rep(lt)
    assert ln[(OUT, "apice")]["valor"] == Decimal("-150.00")
    assert ln[(OUT, "apice")]["status_reconciliacao"] == "nao_avaliado"
    assert "3 pedido(s) com repasse negativo (devolucao/reembolso) na soma" in ln[(OUT, "apice")]["motivo"]
    assert ln[(OUT, "barbours")]["valor"] == Decimal("555641.50")


def test_parcela_negativa_da_taxa_nao_e_regra_do_repasse():
    """A taxa recusa parcela negativa; o repasse sozinho (sem a taxa) nao."""
    lt = lote([tx("apice", parcelas_negativas=2)], marcas=("apice",), taxa=False)
    assert lt.recusas == []
    assert linhas_rep(lt)[(OUT, "apice")]["valor"] == Decimal("7400.50")


def test_sem_pedido_com_escrow_vira_nulo_ausente_nunca_zero():
    lt = lote([tx("apice")])  # demais marcas: nenhuma linha na fonte
    ln = linhas_rep(lt)
    for m in ("barbours", "kokeshi", "lescent", "rituaria"):
        r = ln[(OUT, m)]
        assert r["valor"] is None and r["status_reconciliacao"] == "ausente_na_origem"
        assert r["sinal_origem"] is None and r["cobertura"] is None
        assert "sem pedido com escrow para a chave na origem" in r["motivo"]
    # linha na fonte, mas nenhum pedido com valor_repasse: nulo, nao zero
    r = linhas_rep(lote([tx("apice", com=0, com_repasse=0, taxa=None, repasse=None)], marcas=("apice",)))
    assert r[(OUT, "apice")]["valor"] is None
    assert all(x["valor"] is None for x in linhas_rep(lote([])).values())
    assert lt.recusas == []


def test_repasse_medido_zero_e_zero():
    r = linhas_rep(lote([tx("apice", repasse="0")], marcas=("apice",)))[(OUT, "apice")]
    assert r["valor"] == Decimal(0) and r["status_reconciliacao"] == "nao_avaliado"


def test_chave_repetida_recusa_como_a_taxa():
    lt = lote([tx("apice"), tx("apice")], marcas=("apice",), taxa=False)
    assert any("repasse_shopee: chave repetida" in m for m in lt.recusas)


# ---------------------------------------------------------------------------
# SQL: a mesma leitura da taxa
# ---------------------------------------------------------------------------

def _sql(t) -> str:
    return " ".join(str(t).split())


def test_sql_estende_a_taxa_com_valor_repasse_na_mesma_coorte():
    taxa, ambos = _sql(P.SQL_TAXA_SHOPEE), _sql(P.SQL_TAXA_REPASSE_SHOPEE)
    assert "valor_repasse" not in taxa  # sem a 048, a leitura de hoje nao muda
    assert "valor_repasse AS repasse" in ambos
    assert "SUM(e.repasse) AS repasse" in ambos and "COUNT(e.repasse) AS pedidos_com_repasse" in ambos
    assert "COUNT(*) FILTER (WHERE e.repasse < 0) AS repasses_negativos" in ambos
    for trecho in ("FROM silver.fct_gobeaute_despesas_shopee", "WHERE canal_origem = 'shopee'",
                   "FROM silver.stg_shopee_orders", "DISTINCT ON (order_sn)", "WHERE p.status <> 'cancelled'",
                   "SUM(e.taxa) AS taxa", "COUNT(e.taxa) AS pedidos_com_escrow",
                   "COUNT(*) FILTER (WHERE e.negativa) AS parcelas_negativas", "LEFT JOIN escrow e"):
        assert trecho in taxa and trecho in ambos, trecho
    assert "COALESCE" not in ambos.upper()
    assert "nf_vendas_unificada_v2" not in ambos


class _FonteTaxa(_FonteFake):
    """Data Mart fake que responde as duas leituras da taxa Shopee."""

    def __init__(self, alvo, linhas=(), **kw):
        super().__init__(alvo, [], **kw)
        self.linhas, self.lidas = list(linhas), []

    def connect(self):
        fonte = self

        class C(_ConnFonte):
            def execute(self, sql, params=None):
                if sql is P.SQL_TAXA_SHOPEE or sql is getattr(P, "SQL_TAXA_REPASSE_SHOPEE", None):
                    fonte.lidas.append(sql)
                    fonte.ao_ler()
                    return _Res(linhas=fonte.linhas)
                return super().execute(sql, params)
        return C(self)


def _publicar(alvo, fonte, comps=(OUT,)):
    return P.publicar(alvo, fonte, list(comps), ["shopee"], agora=AGORA)


def test_check_so_aceita_com_o_componente():
    assert P.check_aceita_repasse_shopee(_Conn(CHECK_045)) is False
    assert P.check_aceita_repasse_shopee(_Conn(CHECK_025)) is False
    assert P.check_aceita_repasse_shopee(_Conn(None)) is False
    assert P.check_aceita_repasse_shopee(_Conn(CHECK_048)) is True


def test_banco_sem_o_check_novo_pula_o_componente_sem_derrubar_o_lote():
    alvo = _AlvoFake([esperado("shopee", m, mes=OUT) for m in MARCAS], check=CHECK_045)
    fonte = _FonteTaxa(alvo, [tx(m) for m in MARCAS])
    res = _publicar(alvo, fonte)
    assert res["aplicado"] is True and res["recusas"] == []
    assert res["repasse_shopee"].startswith("inerte: ") and "048" in res["repasse_shopee"]
    assert fonte.lidas == [P.SQL_TAXA_SHOPEE]  # a leitura de hoje, intacta
    assert not any(r["componente"] == COMPONENTE for r in alvo.inseridas)
    assert sum(1 for r in alvo.inseridas if r["componente"] == P.TAXA_SHOPEE) == len(MARCAS)
    assert alvo.auditoria == ["running", "success"]


def test_com_a_048_le_uma_vez_e_grava_taxa_e_repasse():
    alvo = _AlvoFake([esperado("shopee", m, mes=OUT) for m in MARCAS], check=CHECK_048)
    fonte = _FonteTaxa(alvo, [tx(m, repasse="-10.00" if m == "lescent" else "100.00", negativos=1) for m in MARCAS])
    res = _publicar(alvo, fonte)
    assert res["aplicado"] is True and res["recusas"] == [] and res["repasse_shopee"] == "publicado"
    assert fonte.lidas == [P.SQL_TAXA_REPASSE_SHOPEE]  # uma leitura da origem, nao duas
    assert set(fonte.abertas_na_leitura) == {0}
    rep = {r["marca"]: r for r in alvo.inseridas if r["componente"] == COMPONENTE}
    assert sorted(rep) == list(MARCAS) and rep["lescent"]["valor"] == Decimal("-10.00")
    assert sum(1 for r in alvo.inseridas if r["componente"] == P.TAXA_SHOPEE) == len(MARCAS)
    assert alvo.deletes == 1 and alvo.auditoria == ["running", "success"]


def test_check_mudou_para_a_048_durante_a_leitura_recusa_antes_do_delete():
    def chega_a_048(a):
        a.check = CHECK_048

    chave = (OUT, "shopee", "apice")
    alvo = _AlvoFake([esperado("shopee", "apice", mes=OUT)], fotografia={chave}, check=CHECK_045)
    fonte = _FonteTaxa(alvo, [tx("apice")], depois_da_leitura=chega_a_048)
    with pytest.raises(P.PublicacaoRecusada) as exc:
        _publicar(alvo, fonte)
    assert any("CHECK ck_fdim_componente) mudou" in m for m in exc.value.motivos)
    assert alvo.deletes == 0 and alvo.inserts == 0 and alvo.fotografia == {chave}


def test_dry_run_mostra_o_estado_no_resumo():
    alvo = _AlvoDry([esperado("shopee", m, mes=OUT) for m in MARCAS], check=CHECK_045)
    res, _ = P.diagnosticar(alvo, _FonteTaxa(alvo, [tx("apice")]), [OUT], ["shopee"])
    assert res["repasse_shopee"].startswith("inerte: ")
    alvo.check = CHECK_048
    res, _ = P.diagnosticar(alvo, _FonteTaxa(alvo, [tx("apice")]), [OUT], ["shopee"])
    assert res["repasse_shopee"] == "publicado" and res["por_componente"][COMPONENTE]["linhas"] == len(MARCAS)
    assert alvo.inserts == 0 and alvo.deletes == 0


# ---------------------------------------------------------------------------
# Contrato com a migration 048
# ---------------------------------------------------------------------------

def test_048_estende_a_045_com_o_componente_e_o_downgrade_recusa_com_linha():
    m025, m045, m048 = carregar_migration_025(), carregar_migration_045(), carregar_migration_048()
    assert (m048.revision, m048.down_revision) == ("048", "047")
    assert P.REPASSE_SHOPEE == COMPONENTE
    assert m048.COMPONENTES == m045.COMPONENTES + (COMPONENTE,)
    assert m048.NOVOS == (COMPONENTE,)
    (up,) = m048.UPGRADE_SQL
    guarda, restaura = m048.DOWNGRADE_SQL
    assert _lista_do_check(up, "ck_fdim_componente") == m048.COMPONENTES
    assert _lista_do_check(restaura, "ck_fdim_componente") == m045.COMPONENTES
    for sql in (up, restaura):
        assert sql.count("CONSTRAINT") == 2 and "DROP CONSTRAINT ck_fdim_componente," in sql
        assert m048.TABELA in sql
    assert "DELETE" not in " ".join(m048.DOWNGRADE_SQL).upper()
    assert "RAISE EXCEPTION" in guarda and f"componente = '{COMPONENTE}'" in guarda
    assert "%" not in " ".join(m048.UPGRADE_SQL + m048.DOWNGRADE_SQL)
    lt = lote([tx("apice")])
    assert {r["componente"] for r in lt.linhas} <= set(m048.COMPONENTES)
    assert {r["status_reconciliacao"] for r in lt.linhas} <= set(m025.STATUS)
    assert P.check_aceita_repasse_shopee(_Conn(_definicao(m048.COMPONENTES))) is True
