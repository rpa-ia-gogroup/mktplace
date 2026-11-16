"""DRE-DATA-BRIDGE-1 — regras puras do publisher de insumos da DRE.

Sem banco. As provas de servidor (lock, transacao, rollback, idempotencia,
migration) estao em `apps/api/tests/test_dre_bridge_integracao.py`, contra um
PostgreSQL descartavel.
"""
from __future__ import annotations

import ast
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from pipelines.dre import insumo_publisher as P

REPO = Path(__file__).resolve().parents[2]
JUL = date(2026, 7, 1)


def esperado(canal="ml", marca="kokeshi", gmv=1_000_000, mes=JUL):
    return {"competencia": mes, "marketplace_id": P.MKT_ID[canal], "marca": marca, "gmv": Decimal(gmv)}


def cmv(canal="ml", marca="kokeshi", receita=1_000_000, custo=300_000, prov=0, rcc=None, mes=JUL,
        emissao=date(2026, 7, 31)):
    """Uma linha da leitura do CMV, ja' agregada para `competencia x marca x plataforma`.

    `custo=None` e' o que o `SUM(custo)` devolve quando nenhum item da celula
    tem custo; ai' o `SUM ... FILTER (custo IS NOT NULL)` tambem e' NULL.
    """
    sem_custo = custo is None
    return {"competencia": mes, "marca": marca, "plataforma": P.PLATAFORMA_FISCAL.get(canal, canal),
            "receita_fiscal": Decimal(receita), "custo": None if sem_custo else Decimal(custo),
            "custo_provisorio": None if sem_custo else Decimal(prov),
            "receita_com_custo": None if sem_custo else Decimal(rcc if rcc is not None else receita),
            "ultima_emissao": emissao, "linhas": 10}


def cp(c, **over):
    """Linha da contraprova (agregado gold) igual a' do CMV, salvo `over`."""
    return {k: c[k] for k in ("competencia", "marca", "plataforma", "receita_fiscal", "custo", "ultima_emissao")} | over


def repasse(marca="kokeshi", taxa=-290_000, frete=-12_000, afiliado=-90_000, residuo=0, viol=0, mes=JUL):
    return {"competencia": mes, "marca": marca, "taxa": Decimal(taxa), "frete": Decimal(frete),
            "receita": Decimal(1_050_000), "afiliado": Decimal(afiliado), "residuo": Decimal(residuo),
            "tx_afiliado_maior_taxa": viol, "transacoes": 1000, "atualizado_em": datetime(2026, 10, 1, 3, 0)}


def lote(esp, cmvs, reps=(), contraprova=None, canais=None, comps=(JUL,), sem_vendas=frozenset(),
         publicadas=frozenset(), remover=frozenset()):
    """Por padrao, os canais pedidos sao os que tem celula esperada — o mesmo que
    o operador faria. Testes de escopo passam `canais` explicitamente."""
    if canais is None:
        presentes = {r["marketplace_id"] for r in esp}
        canais = [c for c in P.CANAIS if P.MKT_ID[c] in presentes] or ["ml"]
    return P.montar_lote(esperado=list(esp), cmv=list(cmvs),
                         contraprova=list(contraprova if contraprova is not None else [cp(c) for c in cmvs]),
                         repasse=list(reps), canais=list(canais), comps=list(comps), sem_vendas=sem_vendas,
                         publicadas=publicadas, remover=remover)


def linha(lt, canal, marca, comp):
    return next(r for r in lt.linhas if (r["canal"], r["marca"], r["componente"]) == (canal, marca, comp))


# ---------------------------------------------------------------------------
# Ausencia versus zero
# ---------------------------------------------------------------------------

def test_chave_esperada_sem_cmv_vira_nulo_explicito_nunca_zero():
    lt = lote([esperado("ml", "kokeshi")], [])
    for comp in ("cmv", "cmv_receita_fiscal"):
        r = linha(lt, "ml", "kokeshi", comp)
        assert r["valor"] is None and r["status_reconciliacao"] == "ausente_na_origem"
    assert lt.recusas == []


def test_cmv_medido_zero_e_gravado_zero():
    lt = lote([esperado()], [cmv(custo=0, receita=1_000_000)])
    r = linha(lt, "ml", "kokeshi", "cmv")
    assert r["valor"] == Decimal(0) and r["status_reconciliacao"] == "reconciliado"


def test_tiktok_sem_repasse_vira_sete_linhas_nulas():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[])
    nulas = [r for r in lt.linhas if r["componente"].startswith("tiktok_")]
    assert len(nulas) == 7 and all(r["valor"] is None for r in nulas)


def test_chave_fora_do_esperado_nao_e_publicada():
    lt = lote([esperado("ml", "kokeshi")], [cmv("ml", "kokeshi"), cmv("ml", "apice")])
    assert {r["marca"] for r in lt.linhas} == {"kokeshi"}
    assert ("cmv", JUL, "ml", "apice") in lt.fora_do_escopo


# ---------------------------------------------------------------------------
# Reconciliacao: estado do dado x recusa da publicacao
# ---------------------------------------------------------------------------

def test_cmv_fora_da_faixa_e_estado_nao_recusa():
    lt = lote([esperado("shopee", gmv=1_000_000)], [cmv("shopee", receita=450_000)])
    r = linha(lt, "shopee", "kokeshi", "cmv")
    assert r["status_reconciliacao"] == "nao_reconciliado" and "0.4500" in r["motivo"]
    assert lt.recusas == []


@pytest.mark.parametrize("receita,status", [(950_000, "reconciliado"), (1_050_000, "reconciliado"),
                                            (949_000, "nao_reconciliado"), (1_051_000, "nao_reconciliado")])
def test_faixa_do_cmv_e_inclusiva(receita, status):
    lt = lote([esperado()], [cmv(receita=receita)])
    assert linha(lt, "ml", "kokeshi", "cmv")["status_reconciliacao"] == status


def test_contraprova_divergente_recusa_tudo():
    c = cmv()
    outra = cp(c) | {"custo": Decimal(299_000)}
    lt = lote([esperado()], [c], contraprova=[outra])
    assert any("diverge do agregado mensal" in m for m in lt.recusas)


def test_chave_so_numa_tabela_fiscal_recusa():
    lt = lote([esperado()], [cmv()], contraprova=[cp(cmv(marca="apice"))])
    assert any("so' em uma" in m for m in lt.recusas)


# ---------------------------------------------------------------------------
# T-0055 C2 — contraprova contra o agregado gold que anda atras da base de item
# ---------------------------------------------------------------------------

D27, D31 = date(2026, 7, 27), date(2026, 7, 31)


def test_contraprova_completa_e_igual_publica_sem_observacao():
    lt = lote([esperado()], [cmv()])
    assert lt.recusas == [] and lt.observacoes == []
    assert "contraprova" not in linha(lt, "ml", "kokeshi", "cmv")["motivo"]


def test_contraprova_completa_e_divergente_recusa_mesmo_com_a_base_de_item_maior():
    c = cmv(receita=1_000_000)
    lt = lote([esperado()], [c], contraprova=[cp(c, receita_fiscal=Decimal(900_000))])
    assert any("receita_fiscal" in m and "diverge do agregado mensal" in m for m in lt.recusas)


def test_agregado_defasado_nao_recusa_e_deixa_observacao_no_motivo():
    """O caso de out/26: agregado parado em 27/10 com ~85% da receita."""
    c = cmv(receita=1_000_000, custo=300_000, emissao=D31)
    lt = lote([esperado()], [c],
              contraprova=[cp(c, receita_fiscal=Decimal(850_000), custo=Decimal(240_000), ultima_emissao=D27)])
    assert lt.recusas == []
    r = linha(lt, "ml", "kokeshi", "cmv")
    assert r["valor"] == Decimal(300_000)  # publica a base de item, nao o agregado
    assert r["status_reconciliacao"] == "reconciliado"  # a razao com o GMV segue a regra de sempre
    assert r["motivo"].startswith("receita fiscal / GMV = 1.0000; ")
    assert "contraprova nao bloqueante: agregado gold ate 27/07, base de item ate 31/07" in r["motivo"]
    assert lt.observacoes == ["2026-07: contraprova nao bloqueante: agregado gold ate 27/07, base de item ate 31/07"]


def test_agregado_defasado_sem_a_chave_nao_recusa():
    """Marca que so' vendeu depois do corte do agregado: a defasagem explica."""
    c, outra = cmv(marca="kokeshi"), cmv(marca="apice")
    lt = lote([esperado(marca="kokeshi"), esperado(marca="apice")], [c, outra],
              contraprova=[cp(c, ultima_emissao=D27)])
    assert lt.recusas == []
    assert "agregado gold ate 27/07" in linha(lt, "ml", "apice", "cmv")["motivo"]


def test_agregado_sem_a_competencia_nao_recusa():
    lt = lote([esperado()], [cmv()], contraprova=[])
    assert lt.recusas == []
    assert "agregado gold sem a competencia" in linha(lt, "ml", "kokeshi", "cmv")["motivo"]


def test_agregado_defasado_com_mais_receita_que_a_base_de_item_recusa():
    """A defasagem explica o agregado ter MENOS; ter MAIS e' a base de item que regrediu."""
    c = cmv(receita=1_000_000, emissao=D31)
    lt = lote([esperado()], [c], contraprova=[cp(c, receita_fiscal=Decimal(1_000_002), ultima_emissao=D27)])
    assert any("abaixo do agregado gold defasado" in m for m in lt.recusas)


def test_agregado_defasado_com_chave_que_a_base_de_item_perdeu_recusa():
    c = cmv(marca="kokeshi")
    lt = lote([esperado()], [c],
              contraprova=[cp(c, ultima_emissao=D27), cp(cmv(marca="apice"), ultima_emissao=D27)])
    assert any("a base de item perdeu a chave" in m for m in lt.recusas)


def test_agregado_a_frente_da_base_de_item_e_completo_e_bloqueia():
    c = cmv(emissao=D27)
    lt = lote([esperado()], [c], contraprova=[cp(c, custo=Decimal(310_000), ultima_emissao=D31)])
    assert any("custo" in m and "diverge do agregado mensal" in m for m in lt.recusas)


def test_completude_da_contraprova_e_por_competencia():
    """Agosto alcancado e divergente recusa; julho defasado so' observa."""
    ago = date(2026, 8, 1)
    cj, ca = cmv(mes=JUL, emissao=D31), cmv(mes=ago, emissao=date(2026, 8, 31))
    lt = lote([esperado(mes=JUL), esperado(mes=ago)], [cj, ca], comps=(JUL, ago),
              contraprova=[cp(cj, receita_fiscal=Decimal(800_000), ultima_emissao=D27),
                           cp(ca, custo=Decimal(1))])
    assert len(lt.recusas) == 1 and "2026, 8, 1" in lt.recusas[0]
    assert lt.observacoes == ["2026-07: contraprova nao bloqueante: agregado gold ate 27/07, base de item ate 31/07"]


def test_contraprova_aceita_emissao_como_datetime():
    c = cmv(emissao=datetime(2026, 7, 31, 15, 0))
    lt = lote([esperado()], [c], contraprova=[cp(c, ultima_emissao=D31)])
    assert lt.recusas == [] and lt.observacoes == []


# ---------------------------------------------------------------------------
# T-0055 C1 — fonte de item: forma, nulo, cobertura, plataforma, grao
# ---------------------------------------------------------------------------

def _sql(t) -> str:
    return " ".join(str(t).split())


def test_sql_do_cmv_le_a_base_de_item_com_os_filtros_da_query_do_fpa():
    sql = _sql(P.SQL_CMV)
    assert "FROM gold.nf_vendas_unificada_v2" in sql
    assert "canal = 'marketplace'" in sql and "plataforma = ANY(:plataformas)" in sql
    assert "marca = ANY(:marcas)" in sql and "data_mes = ANY(:competencias)" in sql
    # o default da query do FP&A: intercompany NULL conta como 'normal'
    assert "intercompany IS NOT TRUE" in sql and "NOT intercompany" not in sql.replace("IS NOT TRUE", "")
    # ausencia != zero: nenhum COALESCE no custo
    assert "COALESCE" not in sql.upper()
    assert "SUM(receita_produto) FILTER (WHERE custo IS NOT NULL) AS receita_com_custo" in sql
    assert "{{" not in sql and "[[" not in sql  # nada de template do Metabase


def test_sql_do_cmv_nao_tem_join_e_agrupa_na_chave_inteira_da_saida():
    for t in (P.SQL_CMV, P.SQL_CMV_CONTRAPROVA):
        sql = _sql(t).upper()
        assert " JOIN " not in sql and sql.count(" FROM ") == 1
        assert sql.endswith("GROUP BY DATA_MES, MARCA, PLATAFORMA")
    assert "FROM gold.nf_vendas_plataforma_sku_mensal" in _sql(P.SQL_CMV_CONTRAPROVA)


def test_leitura_da_fonte_mantem_read_only_e_timeout():
    fonte = (REPO / "pipelines" / "dre" / "insumo_publisher.py").read_text(encoding="utf-8")
    trecho = fonte[fonte.index("def ler_fonte"):fonte.index("def _esperado")]
    assert trecho.index("SET TRANSACTION READ ONLY") < trecho.index("statement_timeout = '600s'") \
        < trecho.index("SQL_CMV,")


def test_procedencia_nomeia_a_base_de_item():
    lt = lote([esperado()], [cmv()])
    assert {linha(lt, "ml", "kokeshi", c)["procedencia"] for c in ("cmv", "cmv_receita_fiscal")} == {P.PROC_CMV}
    assert P.PROC_CMV.startswith("gold.nf_vendas_unificada_v2")


def test_celula_sem_custo_nenhum_fica_nula_nunca_zero():
    lt = lote([esperado()], [cmv(custo=None)])
    r = linha(lt, "ml", "kokeshi", "cmv")
    assert r["valor"] is None and r["status_reconciliacao"] == "ausente_na_origem"
    assert r["cobertura"] is None and r["provisorio_share"] is None
    assert linha(lt, "ml", "kokeshi", "cmv_receita_fiscal")["valor"] == Decimal(1_000_000)
    assert lt.recusas == []


def test_cmv_e_so_o_custo_da_receita_coberta_sem_extrapolar():
    """90% da receita com custo: o CMV e' o custo medido, e a cobertura diz quanto falta."""
    lt = lote([esperado()], [cmv(receita=1_000_000, custo=270_000, rcc=900_000)])
    r = linha(lt, "ml", "kokeshi", "cmv")
    assert r["valor"] == Decimal(270_000) and r["cobertura"] == Decimal("0.9")


def test_mapeamento_de_plataforma_e_o_da_torre():
    assert P.PLATAFORMA_FISCAL == {"tiktok": "tiktokshop", "ml": "mercadolivre", "shopee": "shopee"}


def test_plataforma_fora_da_torre_nao_e_publicada_nem_redistribuida():
    amazon = cmv("amazon", receita=777_777, custo=111_111)
    lt = lote([esperado("ml")], [cmv("ml"), amazon])
    assert lt.recusas == []
    assert {(r["canal"], r["marca"]) for r in lt.linhas} == {("ml", "kokeshi")}
    assert linha(lt, "ml", "kokeshi", "cmv")["valor"] == Decimal(300_000)  # nada da amazon entrou
    assert ("cmv", JUL, None, "kokeshi") in lt.fora_do_escopo


def test_mesma_entrada_mesmo_lote():
    entrada = dict(esp=[esperado("tiktok"), esperado("ml")], cmvs=[cmv("tiktok"), cmv("ml", custo=None)],
                   reps=[repasse()])
    assert lote(**entrada).linhas == lote(**entrada).linhas


def test_identidade_do_repasse_violada_recusa():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[repasse(residuo=5)])
    assert any("identidade nao fecha" in m for m in lt.recusas)


def test_transacao_com_afiliado_maior_que_taxa_recusa():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[repasse(viol=2)])
    assert any("afiliado maior que a taxa" in m for m in lt.recusas)


def test_afiliado_maior_que_taxa_no_agregado_recusa():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[repasse(taxa=-50_000, afiliado=-90_000)])
    assert any("no agregado" in m for m in lt.recusas)


def test_taxa_positiva_recusa():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[repasse(taxa=10)])
    assert any("taxa positiva" in m for m in lt.recusas)


def test_cmv_negativo_recusa():
    lt = lote([esperado()], [cmv(custo=-1)])
    assert any("cmv negativo" in m for m in lt.recusas)


def test_provisorio_acima_de_um_recusa_sem_clamp():
    lt = lote([esperado()], [cmv(custo=100, prov=150)])
    assert any("provisorio fora de [0,1]" in m for m in lt.recusas)


def test_chave_repetida_na_fonte_recusa():
    c = cmv()
    lt = lote([esperado()], [c, dict(c)])
    assert any("chave repetida" in m for m in lt.recusas)


def test_repasse_ok_publica_evidencia_da_inclusao_do_afiliado():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[repasse()])
    assert lt.recusas == []
    assert linha(lt, "tiktok", "kokeshi", "tiktok_residuo_identidade")["valor"] == Decimal(0)
    assert linha(lt, "tiktok", "kokeshi", "tiktok_tx_afiliado_maior_taxa")["valor"] == Decimal(0)
    tx = linha(lt, "tiktok", "kokeshi", "tiktok_taxa_repasse")
    af = linha(lt, "tiktok", "kokeshi", "tiktok_afiliado_repasse")
    assert tx["sinal_origem"] == -1 and af["sinal_origem"] == -1
    assert af["valor"] >= tx["valor"]  # afiliado contido na taxa (ambos negativos)


def test_sinal_da_origem_e_preservado_sem_abs():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[repasse()])
    assert linha(lt, "tiktok", "kokeshi", "tiktok_taxa_repasse")["valor"] == Decimal(-290_000)
    assert linha(lt, "tiktok", "kokeshi", "cmv")["valor"] == Decimal(300_000)


def test_provisorio_e_cobertura_viajam_por_linha():
    lt = lote([esperado()], [cmv(custo=300_000, prov=30_000, rcc=990_000)])
    r = linha(lt, "ml", "kokeshi", "cmv")
    assert r["provisorio_share"] == Decimal("0.1") and r["cobertura"] == Decimal("0.99")


def test_data_sem_fuso_da_silver_vira_utc_e_data_fiscal_vira_brt():
    lt = lote([esperado("tiktok")], [cmv("tiktok")], reps=[repasse()])
    assert linha(lt, "tiktok", "kokeshi", "tiktok_taxa_repasse")["data_max_origem"].tzinfo == timezone.utc
    assert linha(lt, "tiktok", "kokeshi", "cmv")["data_max_origem"].utcoffset().total_seconds() == -3 * 3600


# ---------------------------------------------------------------------------
# Escopo vazio nunca vira success (revisao estrita #68, item 2)
# ---------------------------------------------------------------------------

def test_universo_esperado_vazio_e_recusado():
    lt = lote([], [], canais=["tiktok", "ml", "shopee"])
    assert any("universo esperado vazio" in m for m in lt.recusas)


def test_par_competencia_canal_sem_celula_e_recusado():
    lt = lote([esperado("ml")], [cmv("ml")], canais=["ml", "shopee"])
    assert any(m.startswith("2026-07 shopee: nenhuma celula") for m in lt.recusas)
    assert not any("2026-07 ml" in m for m in lt.recusas)


def test_mes_sem_celula_dentro_da_janela_e_recusado():
    ago = date(2026, 8, 1)
    lt = lote([esperado("ml")], [cmv("ml")], canais=["ml"], comps=(JUL, ago))
    assert any(m.startswith("2026-08 ml: nenhuma celula") for m in lt.recusas)


def test_sem_vendas_declarado_libera_o_par():
    lt = lote([esperado("ml")], [cmv("ml")], canais=["ml", "shopee"], sem_vendas=frozenset({(JUL, "shopee")}))
    assert lt.recusas == []


def test_sem_vendas_declarado_com_receita_e_contradicao():
    lt = lote([esperado("ml")], [cmv("ml")], canais=["ml"], sem_vendas=frozenset({(JUL, "ml")}))
    assert any("declarado --sem-vendas, mas ha receita" in m for m in lt.recusas)


def test_universo_vazio_so_passa_com_todos_os_pares_declarados():
    tudo = frozenset({(JUL, "ml"), (JUL, "shopee")})
    assert lote([], [], canais=["ml", "shopee"], sem_vendas=tudo).recusas == []
    parcial = frozenset({(JUL, "ml")})
    assert any("universo esperado vazio" in m
               for m in lote([], [], canais=["ml", "shopee"], sem_vendas=parcial).recusas)


# ---------------------------------------------------------------------------
# Validacao do CLI (revisao estrita #68, item 3)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("argv,trecho", [
    (["--meses", "0"], "--meses precisa ser inteiro positivo"),
    (["--meses", "-2"], "--meses precisa ser inteiro positivo"),
    (["--de", "2026-08", "--ate", "2026-07"], "posterior a --ate"),
    (["--de", "2026-07"], "--de e --ate vao juntos"),
    (["--de", "2026-7", "--ate", "2026-07"], "use YYYY-MM"),
    (["--canais", "tiktok,amazon"], "canal desconhecido: amazon"),
    (["--canais", ""], "--canais vazio"),
    (["--canais", " , ,"], "--canais vazio"),
    (["--sem-vendas", "2026-07"], "use YYYY-MM:canal"),
    (["--sem-vendas", "2026-07:amazon"], "canal fora de --canais"),
    (["--de", "2026-07", "--ate", "2026-07", "--sem-vendas", "2026-06:ml"], "fora da janela"),
    (["--de", "2026-07", "--ate", "2026-07", "--remover-marca", "2026-07:ml"], "use YYYY-MM:canal:marca"),
    (["--de", "2026-07", "--ate", "2026-07", "--remover-marca", "2026-07:ml:kok:x"], "use YYYY-MM:canal:marca"),
    (["--de", "2026-07", "--ate", "2026-07", "--remover-marca", "2026-7:ml:kokeshi"], "use YYYY-MM"),
    (["--de", "2026-07", "--ate", "2026-07", "--remover-marca", "2026-06:ml:kokeshi"], "fora da janela"),
    (["--de", "2026-07", "--ate", "2026-07", "--remover-marca", "2026-07:amazon:kokeshi"], "canal fora de --canais"),
    (["--de", "2026-07", "--ate", "2026-07", "--remover-marca", "2026-07:ml:"], "marca invalida"),
    (["--de", "2026-07", "--ate", "2026-07", "--remover-marca", "2026-07:ml:Kokeshi Ltda"], "marca invalida"),
    (["--de", "2026-07", "--ate", "2026-07", "--sem-vendas", "2026-07:ml", "--remover-marca", "2026-07:ml:kokeshi"],
     "ja esta declarado em --sem-vendas"),
])
def test_cli_recusa_argumento_invalido_com_mensagem(argv, trecho, capsys):
    chamou = []
    with pytest.raises(SystemExit) as exc:
        P.main(argv, engines=lambda: chamou.append(1), hoje=date(2026, 10, 13))
    assert exc.value.code == 2
    assert trecho in capsys.readouterr().err
    assert chamou == []  # nenhuma conexao foi aberta


def test_cli_canais_validos_sao_normalizados_na_ordem_canonica():
    import argparse

    args = argparse.Namespace(de="2026-07", ate="2026-07", meses=4, canais=" shopee ,ml", sem_vendas=None)
    comps, canais, sem, remover = P.validar_argumentos(args, date(2026, 10, 13))
    assert comps == [JUL] and canais == ["ml", "shopee"] and sem == frozenset() and remover == frozenset()


# ---------------------------------------------------------------------------
# Contrato com o serving e com a migration
# ---------------------------------------------------------------------------

def _carregar_migration(arquivo: str):
    """Constantes de uma migration SEM importar `alembic`.

    Executa o fonte num namespace isolado, com `op = None`. Injetar um
    `alembic` falso em `sys.modules` contaminaria qualquer outro teste da
    mesma sessao que importe o Alembic de verdade.
    """
    import types

    caminho = REPO / "apps" / "api" / "alembic" / "versions" / arquivo
    fonte = caminho.read_text(encoding="utf-8")
    assert fonte.count("from alembic import op") == 1
    ns: dict = {}
    exec(compile(fonte.replace("from alembic import op", "op = None"), str(caminho), "exec"), ns)  # noqa: S102 — fonte do proprio repo
    return types.SimpleNamespace(**{k: v for k, v in ns.items() if not k.startswith("__")})


def carregar_migration_025():
    return _carregar_migration("025_create_fact_dre_insumo_mensal.py")


def carregar_migration_037():
    """T-0059: estende o CHECK de componentes da 025 com `shopee_taxa_escrow`."""
    return _carregar_migration("037_dre_insumo_taxa_shopee_escrow.py")


_migration = carregar_migration_025


def _lista_do_check(sql: str, nome: str) -> tuple:
    import re

    bloco = re.search(nome + r" CHECK \((?:\w+) IN \((.*?)\)\)", sql, re.DOTALL).group(1)
    return tuple(re.findall(r"'([a-z_]+)'", bloco))


def test_componentes_publicados_existem_no_check_da_migration():
    """Lista EFETIVA no head: a da 025 estendida pela 037 (T-0059)."""
    lt = lote([esperado("tiktok"), esperado("ml"), esperado("shopee", "barbours")],
              [cmv("tiktok"), cmv("ml")], reps=[repasse()])
    lt_tx = P.montar_lote(
        esperado=[esperado("shopee", "barbours")], cmv=[], contraprova=[], repasse=[], canais=["shopee"],
        comps=[JUL], taxa_shopee=[{"competencia": JUL, "marca": "barbours", "pedidos": 10, "pedidos_com_escrow": 9,
                                   "taxa": Decimal(100), "parcelas_negativas": 0, "atualizado_em": None}])
    m025, m037 = _migration(), carregar_migration_037()
    efetiva = set(m037.COMPONENTES)
    assert {r["componente"] for r in lt.linhas + lt_tx.linhas} <= efetiva
    assert P.TAXA_SHOPEE in {r["componente"] for r in lt_tx.linhas}
    # A 037 so' acrescenta: a lista da 025 continua inteira, na mesma ordem.
    assert m037.COMPONENTES == m025.COMPONENTES + (P.TAXA_SHOPEE,)
    assert {r["status_reconciliacao"] for r in lt.linhas + lt_tx.linhas} <= set(m025.STATUS)
    assert m025.down_revision == "024" and m025.revision == "025"
    assert m037.down_revision == "036" and m037.revision == "037"


def test_037_troca_so_o_check_de_componentes_e_o_downgrade_restaura_a_025():
    m025, m037 = carregar_migration_025(), carregar_migration_037()
    (up,) = m037.UPGRADE_SQL
    apaga, restaura = m037.DOWNGRADE_SQL
    assert _lista_do_check(up, "ck_fdim_componente") == m037.COMPONENTES
    assert _lista_do_check(restaura, "ck_fdim_componente") == m025.COMPONENTES
    for sql in (up, restaura):
        assert sql.count("CONSTRAINT") == 2 and "DROP CONSTRAINT ck_fdim_componente," in sql
        assert m037.TABELA in sql
    # Downgrade apaga SO' o componente novo, com WHERE, antes de restaurar o CHECK.
    assert apaga.strip() == f"DELETE FROM {m037.TABELA} WHERE componente = '{P.TAXA_SHOPEE}'"


def test_check_literal_da_migration_lista_exatamente_as_tuplas():
    m = carregar_migration_025()
    sql = m.UPGRADE_SQL[0]
    assert _lista_do_check(sql, "ck_fdim_componente") == m.COMPONENTES
    assert _lista_do_check(sql, "ck_fdim_status") == m.STATUS


def test_faixa_do_cmv_e_a_mesma_do_serving():
    fonte = (REPO / "apps" / "api" / "app" / "services" / "dre_service.py").read_text(encoding="utf-8")
    assert "CMV_RAZAO_MIN = 0.95" in fonte and "CMV_RAZAO_MAX = 1.05" in fonte
    assert (P.CMV_RAZAO_MIN, P.CMV_RAZAO_MAX) == (Decimal("0.95"), Decimal("1.05"))


# ---------------------------------------------------------------------------
# Janela, CLI e seguranca operacional
# ---------------------------------------------------------------------------

def test_janela_padrao_nunca_inclui_o_mes_corrente():
    assert P.janela_padrao(date(2026, 10, 13), 4) == [date(2026, 6, 1), date(2026, 7, 1),
                                                      date(2026, 8, 1), date(2026, 9, 1)]


def test_cli_recusa_competencia_corrente():
    with pytest.raises(SystemExit) as exc:
        P.main(["--de", "2026-10", "--ate", "2026-10"], engines=lambda: (None, None), hoje=date(2026, 10, 13))
    assert exc.value.code == 2


def test_sanitizar_tira_dsn_host_e_ip():
    msg = P.sanitizar("falhou postgresql://u:SEGREDO@db.exemplo:5432/x host=10.1.2.3 password=abc")
    assert "SEGREDO" not in msg and "10.1.2.3" not in msg and "abc" not in msg


@pytest.mark.parametrize("url,esperada", [
    ("postgresql://u@h/d", "postgresql+psycopg2://u@h/d"),
    ("postgresql+psycopg2://u@h/d", "postgresql+psycopg2://u@h/d"),
    ("postgresql+psycopg://u@h/d", "postgresql+psycopg://u@h/d"),
])
def test_driver_psycopg2_fixado_so_quando_ausente(url, esperada):
    assert P.url_psycopg2(url) == esperada


def test_publisher_nao_importa_alembic_nem_app():
    """Compatibilidade com o Airflow: o modulo nao pode puxar Alembic (que
    colidiria com o banco de metadados do Airflow) nem a API."""
    arvore = ast.parse((REPO / "pipelines" / "dre" / "insumo_publisher.py").read_text(encoding="utf-8"))
    importados = set()
    for no in ast.walk(arvore):
        if isinstance(no, ast.Import):
            importados |= {a.name.split(".")[0] for a in no.names}
        elif isinstance(no, ast.ImportFrom) and no.module:
            importados.add(no.module.split(".")[0])
    assert "alembic" not in importados and "app" not in importados
    assert importados <= {"__future__", "argparse", "json", "logging", "re", "sys", "dataclasses", "datetime",
                          "decimal", "typing", "sqlalchemy", "pipelines"}


def test_pacote_dre_entra_na_wheel_dos_pipelines():
    texto = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    assert '"pipelines.dre"' in texto


# ---------------------------------------------------------------------------
# Marca ja publicada nao some em silencio (DRE-REVIEW-FINAL)
# ---------------------------------------------------------------------------

KOK, BAR = (JUL, "ml", "kokeshi"), (JUL, "ml", "barbours")


def test_marca_publicada_que_some_de_par_ativo_e_recusada_e_nomeada():
    lt = lote([esperado("ml", "kokeshi")], [cmv("ml", "kokeshi")], publicadas=frozenset({KOK, BAR}))
    assert any("chave publicada desapareceu: 2026-07:ml:barbours" in m for m in lt.recusas)
    assert any("--remover-marca 2026-07:ml:barbours" in m for m in lt.recusas)


def test_remocao_explicita_libera_a_chave():
    lt = lote([esperado("ml", "kokeshi")], [cmv("ml", "kokeshi")], publicadas=frozenset({KOK, BAR}),
              remover=frozenset({BAR}))
    assert lt.recusas == []


def test_remocao_de_chave_com_receita_e_contradicao():
    lt = lote([esperado("ml", "kokeshi")], [cmv("ml", "kokeshi")], publicadas=frozenset({KOK}),
              remover=frozenset({KOK}))
    assert any("ainda tem receita" in m for m in lt.recusas)


def test_remocao_de_chave_nao_publicada_e_recusada():
    lt = lote([esperado("ml", "kokeshi")], [cmv("ml", "kokeshi")], publicadas=frozenset({KOK}),
              remover=frozenset({BAR}))
    assert any("nao esta publicada" in m for m in lt.recusas)


def test_marca_nova_nao_e_problema():
    lt = lote([esperado("ml", "kokeshi"), esperado("ml", "barbours")],
              [cmv("ml", "kokeshi"), cmv("ml", "barbours")], publicadas=frozenset({KOK}))
    assert lt.recusas == []


def test_par_declarado_sem_vendas_autoriza_no_grao_do_par():
    lt = lote([], [], canais=["ml"], publicadas=frozenset({KOK, BAR}), sem_vendas=frozenset({(JUL, "ml")}))
    assert lt.recusas == []


def test_excecoes_autorizadas_sao_texto_auditavel():
    assert P.excecoes_autorizadas(frozenset(), frozenset()) is None
    txt = P.excecoes_autorizadas(frozenset({(JUL, "shopee")}), frozenset({BAR}))
    assert txt == "excecoes autorizadas: sem_vendas=2026-07:shopee; remover_marca=2026-07:ml:barbours"


# ---------------------------------------------------------------------------
# T-0064 — completude pela numeracao de NF (buraco por emissor x serie x dia)
# ---------------------------------------------------------------------------

OUT = date(2026, 10, 1)


def nf(marca="apice", dia=date(2026, 10, 3), faltam=1914, buracos=1, relevantes=None, maior=None, serie="055"):
    """Linha de `SQL_NUMERACAO_NF` (marca x modelo x serie x dia)."""
    if relevantes is None:
        relevantes = buracos if faltam >= P.BURACO_NF_MINIMO else 0
    rel_faltam = faltam if relevantes else 0
    return {"competencia": date(dia.year, dia.month, 1), "marca": marca, "modelo": "55", "serie": serie,
            "dia": dia, "buracos": buracos, "faltam": faltam, "maior_buraco": maior or faltam,
            "buracos_relevantes": relevantes, "faltam_relevantes": rel_faltam}


def lote_nf(numeracao, marcas=("apice", "barbours"), canais=("tiktok", "shopee")):
    esp = [esperado(c, m, mes=OUT) for m in marcas for c in canais]
    cmvs = [cmv(c, m, mes=OUT, emissao=date(2026, 10, 31)) for m in marcas for c in canais]
    return P.montar_lote(esperado=esp, cmv=cmvs, contraprova=[cp(c) for c in cmvs], repasse=[],
                         canais=list(canais), comps=[OUT], numeracao_nf=numeracao)


def test_buraco_de_numeracao_poe_motivo_no_cmv_e_na_receita_fiscal_de_todos_os_canais_da_marca():
    lt = lote_nf([nf("apice", date(2026, 10, 3), 1914)])
    assert lt.recusas == []
    for canal in ("tiktok", "shopee"):
        c = linha(lt, canal, "apice", "cmv")
        rf = linha(lt, canal, "apice", "cmv_receita_fiscal")
        assert c["motivo"].endswith("; buraco de numeracao de NF em 03/10 (1.914 numeros)")
        assert rf["motivo"] == "base da razao com o GMV; buraco de numeracao de NF em 03/10 (1.914 numeros)"
        # nada e' extrapolado: valor, status e cobertura identicos ao lote sem o gate
        assert c["valor"] == Decimal(300_000) and c["status_reconciliacao"] == "reconciliado"
        assert c["cobertura"] == Decimal(1) and rf["valor"] == Decimal(1_000_000)
    assert lt.numeracao_nf["parciais"] == [{"competencia": "2026-10", "marca": "apice", "numeros": 1914,
                                            "motivo": "buraco de numeracao de NF em 03/10 (1.914 numeros)"}]


def test_sem_buraco_o_lote_e_identico_ao_de_antes():
    antes = lote_nf(None)
    for numeracao in ([], [nf("apice", faltam=3, buracos=2)]):  # nada / so' abaixo do limiar
        depois = lote_nf(numeracao)
        assert depois.linhas == antes.linhas and depois.recusas == antes.recusas == []
        assert depois.observacoes == antes.observacoes


def test_buraco_de_outra_marca_nao_afeta_esta():
    lt = lote_nf([nf("barbours", date(2026, 10, 4), 914, serie="003")])
    assert "buraco" not in linha(lt, "tiktok", "apice", "cmv")["motivo"]
    assert linha(lt, "tiktok", "apice", "cmv_receita_fiscal")["motivo"] == "base da razao com o GMV"
    assert "04/10 (914 numeros)" in linha(lt, "tiktok", "barbours", "cmv")["motivo"]


def test_buraco_de_outro_mes_nao_afeta_este():
    lt = lote_nf([nf("apice", date(2026, 9, 30), 500)])
    assert "buraco" not in linha(lt, "tiktok", "apice", "cmv")["motivo"]


def test_series_somam_no_dia_e_dias_sao_listados_em_ordem():
    """Barbours out/26: series 3 e 4 sem 04/10 (914 + 808)."""
    lt = lote_nf([nf("barbours", date(2026, 10, 11), 600, serie="003"),
                  nf("barbours", date(2026, 10, 4), 914, serie="003"),
                  nf("barbours", date(2026, 10, 4), 808, serie="004")])
    assert linha(lt, "shopee", "barbours", "cmv")["motivo"].endswith(
        "; buraco de numeracao de NF em 04/10 (1.722 numeros), 11/10 (600 numeros)")
    assert lt.numeracao_nf["parciais"][0]["numeros"] == 2322


def test_motivo_limita_os_dias_nomeados():
    dias = [nf("apice", date(2026, 10, d), 1000) for d in range(1, 14)]
    m = linha(lote_nf(dias), "tiktok", "apice", "cmv")["motivo"]
    assert "10/10 (1.000 numeros), e mais 3 dia(s) (3.000 numeros)" in m and "11/10" not in m


def test_trecho_do_motivo_nao_tem_separador_interno():
    """O serving separa o motivo por '; ' e procura o trecho pelo rotulo."""
    _, resumo = P.buracos_numeracao_nf([nf("apice", date(2026, 10, d), 1000) for d in range(1, 14)])
    assert "; " not in resumo["parciais"][0]["motivo"]
    assert resumo["parciais"][0]["motivo"].startswith(P.BURACO_NF_MARCA)


def test_buraco_abaixo_do_limiar_so_vai_para_o_resumo():
    lt = lote_nf([nf("kokeshi", date(2026, 10, 2), 31, buracos=4)], marcas=("apice",))
    assert all("buraco" not in (r["motivo"] or "") for r in lt.linhas)
    assert lt.numeracao_nf["abaixo_do_limiar"] == [
        {"competencia": "2026-10", "marca": "kokeshi", "buracos": 4, "numeros": 31, "maior": 31}]
    assert lt.numeracao_nf["limiar_buraco"] == P.BURACO_NF_MINIMO


def test_gate_nunca_recusa_nem_com_buraco_em_toda_celula():
    lt = lote_nf([nf("apice"), nf("barbours", date(2026, 10, 4), 914)])
    assert lt.recusas == []
    assert len(lt.linhas) == len(lote_nf(None).linhas)


def test_gate_e_idempotente():
    entrada = [nf("barbours", date(2026, 10, 4), 808, serie="004"), nf("barbours", date(2026, 10, 4), 914)]
    assert lote_nf(entrada).linhas == lote_nf(list(reversed(entrada))).linhas


def test_gate_soma_ao_motivo_da_contraprova_e_da_razao():
    c = cmv("tiktok", "apice", mes=OUT, receita=911_000, emissao=date(2026, 10, 31))
    lt = P.montar_lote(esperado=[esperado("tiktok", "apice", mes=OUT)], cmv=[c],
                       contraprova=[cp(c, ultima_emissao=date(2026, 10, 27))], repasse=[], canais=["tiktok"],
                       comps=[OUT], numeracao_nf=[nf("apice")])
    m = linha(lt, "tiktok", "apice", "cmv")
    assert m["status_reconciliacao"] == "nao_reconciliado"
    partes = m["motivo"].split("; ")
    assert partes[0].startswith("receita fiscal / GMV = 0.9110")
    assert partes[-2].startswith("contraprova nao bloqueante")
    assert partes[-1] == "buraco de numeracao de NF em 03/10 (1.914 numeros)"


class _ConnQuebra:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        from sqlalchemy.exc import ProgrammingError
        raise ProgrammingError("SELECT", {}, Exception("column chave_nfe does not exist host=10.0.0.1"))


class _EngQuebra:
    def connect(self):
        return _ConnQuebra()


def test_leitura_do_gate_que_falha_nao_bloqueia_e_diz_por_que():
    linhas, estado = P.ler_numeracao_nf(_EngQuebra(), [OUT], ["apice"])
    assert linhas is None and estado.startswith("indisponivel: ProgrammingError")
    assert "10.0.0.1" not in estado  # sanitizado
    assert lote_nf(linhas).linhas == lote_nf(None).linhas


def test_leitura_do_gate_sem_fonte_ou_marca_nao_roda():
    assert P.ler_numeracao_nf(None, [OUT], ["apice"])[0] is None
    assert P.ler_numeracao_nf(_EngQuebra(), [OUT], [])[0] is None


def test_sql_da_numeracao_le_a_chave_do_emissor_e_o_mes_anterior():
    sql = _sql(P.SQL_NUMERACAO_NF)
    assert "FROM gold.nf_vendas_unificada_v2" in sql and "chave_nfe ~ '^[0-9]{44}$'" in sql
    assert "substr(chave_nfe, 7, 14)" in sql and "substr(chave_nfe, 23, 3)" in sql
    assert "substr(chave_nfe, 26, 9)::bigint" in sql
    assert "PARTITION BY emissor, modelo, serie ORDER BY numero" in sql
    # numeracao e' do emissor: sem filtro de canal/plataforma/intercompany nas notas
    notas = sql[sql.index("notas AS"):sql.index("buracos AS")]
    assert "canal" not in notas and "plataforma" not in notas and "intercompany" not in notas
    assert "data_mes = ANY(:meses_numeracao)" in sql and "faltam >= :minimo" in sql
    assert "{{" not in sql and "[[" not in sql


def test_leitura_do_gate_e_read_only_com_timeout():
    fonte = (REPO / "pipelines" / "dre" / "insumo_publisher.py").read_text(encoding="utf-8")
    trecho = fonte[fonte.index("def ler_numeracao_nf"):fonte.index("def _resumo_numeracao")]
    assert trecho.index("SET TRANSACTION READ ONLY") < trecho.index("statement_timeout = '600s'") \
        < trecho.index("SQL_NUMERACAO_NF")
    assert "except SQLAlchemyError" in trecho and "except Exception" not in trecho


def test_rotulo_do_buraco_e_o_mesmo_do_serving():
    fonte = (REPO / "apps" / "api" / "app" / "services" / "dre_service.py").read_text(encoding="utf-8")
    assert f'BURACO_NF_MARCA = "{P.BURACO_NF_MARCA}"' in fonte


# ---------------------------------------------------------------------------
# T-0087 — o publisher nao segura a conexao do Neon durante a leitura da origem
# ---------------------------------------------------------------------------
#
# Dubles de motor: o alvo (Neon) conta conexoes abertas, so' aplica a escrita
# no commit e mata a conexao que estiver aberta enquanto a origem e' lida (o
# que o Neon fez em 10 e 11/11). As provas de servidor continuam em
# `test_dre_insumo_publisher_integracao.py`.

CHECK_025 = "CHECK ((componente)::text = ANY (ARRAY['cmv'::text, 'cmv_receita_fiscal'::text]))"


class _Res:
    def __init__(self, valor=None, linhas=(), rowcount=0):
        self._valor, self._linhas, self.rowcount = valor, list(linhas), rowcount

    def scalar(self):
        return self._valor

    def scalar_one(self):
        return self._valor

    def mappings(self):
        return self

    def all(self):
        return [dict(r) for r in self._linhas]


class _ConnAlvo:
    def __init__(self, eng, transacional):
        self.eng, self.transacional, self.morta, self.pendente = eng, transacional, False, []

    def __enter__(self):
        self.eng.abertas.append(self)
        return self

    def __exit__(self, tipo, *a):
        self.eng.abertas.remove(self)
        if self.transacional and tipo is None:
            self.commit()
        return False

    def commit(self):
        for evento in self.pendente:
            self.eng.aplicar(evento)
        self.pendente = []

    def rollback(self):
        self.pendente = []

    def execute(self, sql, params=None):
        from sqlalchemy.exc import OperationalError

        if self.morta:
            raise OperationalError("SELECT", {}, Exception("SSL connection has been closed unexpectedly"))
        e = self.eng
        e.sqls.append(sql)
        if sql is P.SQL_TABELA_EXISTE:
            return _Res(True)
        if sql is P.SQL_ESPERADO:
            return _Res(linhas=e.esperado)
        if sql is P.SQL_CHECK_COMPONENTE:
            return _Res(e.check)
        if sql is P.SQL_LOCK:
            return _Res(e.lock_livre)
        if sql is P.SQL_PUBLICADAS:
            return _Res(linhas=[{"competencia": m, "canal": c, "marca": mc} for m, c, mc in sorted(e.fotografia)])
        if sql is P.SQL_AUDIT_ABRE:
            self.pendente.append(("audit", "running"))
            return _Res(7)
        if sql is P.SQL_AUDIT_FECHA:
            self.pendente.append(("audit", "success"))
            return _Res(rowcount=1)
        if sql is P.SQL_AUDIT_FALHA:
            self.pendente.append(("audit", "failed"))
            return _Res(rowcount=1)
        if sql is P.SQL_APAGA_ESCOPO:
            e.deletes += 1
            self.pendente.append(("apaga", None))
            return _Res(rowcount=len(e.fotografia))
        if sql is P.SQL_INSERE:
            e.inserts += 1
            e.inseridas.append(dict(params))
            self.pendente.append(("insere", (params["competencia"], params["canal"], params["marca"])))
            return _Res(rowcount=1)
        assert str(sql).startswith("SET TRANSACTION READ ONLY"), str(sql)
        return _Res()


class _AlvoFake:
    def __init__(self, esperado_rows, fotografia=frozenset(), check=CHECK_025):
        self.esperado, self.fotografia, self.check = list(esperado_rows), set(fotografia), check
        self.lock_livre, self.abertas, self.sqls, self.auditoria = True, [], [], []
        self.deletes = self.inserts = 0
        self.inseridas = []

    def connect(self):
        return _ConnAlvo(self, transacional=False)

    def begin(self):
        return _ConnAlvo(self, transacional=True)

    def aplicar(self, evento):
        tipo, valor = evento
        if tipo == "audit":
            self.auditoria.append(valor)
        elif tipo == "apaga":
            self.fotografia = set()
        else:
            self.fotografia.add(valor)


class _ConnFonte:
    def __init__(self, eng):
        self.eng = eng

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def rollback(self):
        pass

    def execute(self, sql, params=None):
        self.eng.sqls.append((sql, len(self.eng.alvo.abertas)))
        self.eng.ao_ler()
        if sql is P.SQL_CMV:
            return _Res(linhas=self.eng.cmv)
        if sql is P.SQL_CMV_CONTRAPROVA:
            return _Res(linhas=[cp(c) for c in self.eng.cmv])
        if sql is P.SQL_CMV_LACUNAS:  # T-0091b: as lacunas sao as celulas das linhas sem custo
            return _Res(linhas=[{"competencia": m, "marca": marca} for m, marca in sorted(
                {(r["competencia"], r["marca"]) for r in self.eng.estimado if r["tipo"] == "sem_custo"})])
        if sql is P.SQL_CMV_ESTIMADO:
            return _Res(linhas=self.eng.estimado)
        return _Res(linhas=[])


class _FonteFake:
    """Data Mart: a cada comando, registra quantas conexoes do alvo estao abertas
    e (como o Neon) mata as que estiverem; `depois_da_leitura` simula outro
    processo mexendo no Neon enquanto a origem e' lida."""

    def __init__(self, alvo, cmv_rows, depois_da_leitura=None, estimado=()):
        self.alvo, self.cmv, self.depois = alvo, list(cmv_rows), depois_da_leitura
        self.estimado = list(estimado)
        self.abertas_na_leitura = []
        self.sqls = []  # (sql, conexoes do alvo abertas no instante do comando)

    def connect(self):
        return _ConnFonte(self)

    def ao_ler(self):
        self.abertas_na_leitura.append(len(self.alvo.abertas))
        for conn in self.alvo.abertas:
            conn.morta = True
        if self.depois is not None:
            self.depois(self.alvo)


def _publicar_fake(alvo, fonte):
    return P.publicar(alvo, fonte, [JUL], ["ml"], agora=datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc))


def test_t0087_nenhuma_conexao_do_neon_aberta_durante_as_leituras_da_origem(monkeypatch):
    alvo = _AlvoFake([esperado("ml", "kokeshi")])
    fonte = _FonteFake(alvo, [cmv("ml", "kokeshi")])
    vistas = {}
    for nome in ("ler_fonte", "ler_cmv_estimado", "ler_impostos", "ler_numeracao_nf"):
        real = getattr(P, nome)

        def espiao(*a, _nome=nome, _real=real, **k):
            vistas[_nome] = len(alvo.abertas)
            return _real(*a, **k)

        monkeypatch.setattr(P, nome, espiao)
    res = _publicar_fake(alvo, fonte)
    assert vistas == {"ler_fonte": 0, "ler_cmv_estimado": 0, "ler_impostos": 0, "ler_numeracao_nf": 0}
    assert fonte.abertas_na_leitura and set(fonte.abertas_na_leitura) == {0}
    assert res["aplicado"] is True and alvo.auditoria == ["running", "success"]
    assert alvo.abertas == []


def test_t0087_conexao_que_cai_na_leitura_longa_nao_impede_a_publicacao():
    alvo = _AlvoFake([esperado("ml", "kokeshi")], fotografia={KOK})
    fonte = _FonteFake(alvo, [cmv("ml", "kokeshi")])
    res = _publicar_fake(alvo, fonte)
    assert res["aplicado"] is True and res["recusas"] == []
    assert alvo.fotografia == {KOK} and alvo.deletes == 1 and alvo.inserts == res["linhas"] > 0
    assert alvo.auditoria == ["running", "success"]


def test_t0087_lock_so_e_tomado_depois_da_origem_e_antes_de_qualquer_escrita():
    alvo = _AlvoFake([esperado("ml", "kokeshi")])
    _publicar_fake(alvo, _FonteFake(alvo, [cmv("ml", "kokeshi")]))
    ordem = [s for s in alvo.sqls if s in (P.SQL_LOCK, P.SQL_AUDIT_ABRE, P.SQL_APAGA_ESCOPO, P.SQL_INSERE)]
    assert ordem[:3] == [P.SQL_LOCK, P.SQL_AUDIT_ABRE, P.SQL_APAGA_ESCOPO]


def test_t0087_gmv_reescrito_durante_a_leitura_publica_com_o_gmv_relido_sob_o_lock():
    """Sync da fato no meio da leitura (DAG 10:00, cadeia diaria 10:15): as marcas
    nao mudam, entao publica; a razao com o GMV usa o valor relido sob o lock."""
    def gmv_dobrou(a):
        a.esperado = [esperado("ml", "kokeshi", gmv=2_000_000)]

    alvo = _AlvoFake([esperado("ml", "kokeshi", gmv=1_000_000)], fotografia={KOK})
    fonte = _FonteFake(alvo, [cmv("ml", "kokeshi", receita=1_000_000)], depois_da_leitura=gmv_dobrou)
    res = _publicar_fake(alvo, fonte)
    assert res["aplicado"] is True and res["recusas"] == []
    assert alvo.deletes == 1 and alvo.auditoria == ["running", "success"]
    (c,) = [r for r in alvo.inseridas if r["componente"] == "cmv"]
    # 1.000.000 / 2.000.000: com o GMV da pre-leitura seria 1.0000 e reconciliado
    assert c["motivo"].startswith("receita fiscal / GMV = 0.5000")
    assert c["status_reconciliacao"] == "nao_reconciliado"


def _marca_nova(a):
    a.esperado = [esperado("ml", "kokeshi"), esperado("ml", "barbours")]


def _check_mudou(a):
    a.check = CHECK_025.replace("]))", ", 'imposto_icms'::text, 'imposto_difal'::text, "
                                      "'imposto_pis_cofins'::text]))")


@pytest.mark.parametrize("mudanca,trecho", [
    (_marca_nova, "conjunto de marcas esperado no Neon mudou"),
    (_check_mudou, "contrato do Neon (CHECK ck_fdim_componente) mudou"),
])
def test_t0087_deriva_entre_pre_leitura_e_lock_recusa_antes_do_delete(mudanca, trecho):
    alvo = _AlvoFake([esperado("ml", "kokeshi")], fotografia={KOK})
    fonte = _FonteFake(alvo, [cmv("ml", "kokeshi")], depois_da_leitura=mudanca)
    with pytest.raises(P.PublicacaoRecusada) as exc:
        _publicar_fake(alvo, fonte)
    assert any(trecho in m and "rode de novo" in m for m in exc.value.motivos)
    assert alvo.deletes == 0 and alvo.inserts == 0
    assert alvo.fotografia == {KOK}  # fotografia intacta
    assert alvo.auditoria == ["failed"]  # o `running` foi desfeito; a falha ficou registrada


def test_t0087_sem_deriva_a_ordem_dos_registros_e_o_gmv_nao_importam():
    a, b = esperado("ml", "kokeshi"), esperado("ml", "barbours")
    assert P._deriva([a, b], [dict(b), dict(a)], (False, True), (False, True)) == []
    assert P._deriva([a], [esperado("ml", "kokeshi", gmv=1)], (False, True), (False, True)) == []
    # mesma marca em outro canal/mes nao muda o conjunto de marcas lido na origem
    assert P._deriva([a], [a, esperado("shopee", "kokeshi")], (False, False), (False, False)) == []
    assert P._deriva([a], [a, b], (False, False), (False, False)) != []


def test_t0087_lock_ocupado_aborta_sem_escrever_nem_auditar():
    alvo = _AlvoFake([esperado("ml", "kokeshi")], fotografia={KOK})
    alvo.lock_livre = False
    with pytest.raises(P.LockOcupado):
        _publicar_fake(alvo, _FonteFake(alvo, [cmv("ml", "kokeshi")]))
    assert alvo.deletes == 0 and alvo.inserts == 0 and alvo.fotografia == {KOK} and alvo.auditoria == []


# ---------------------------------------------------------------------------
# T-0091 — custo estimado nas linhas sem custo (paliativo do Full Shopee)
# ---------------------------------------------------------------------------

def sem_custo(codigo="K1", sku=None, receita=600, qtd=10, canal="shopee", marca="kokeshi", mes=OUT):
    """Linha `sem_custo` de `SQL_CMV_ESTIMADO`: SKU sem custo da celula."""
    return {"tipo": "sem_custo", "competencia": mes, "marca": marca, "plataforma": P.PLATAFORMA_FISCAL[canal],
            "codigo_produto": codigo, "sku_canonico": sku, "receita": Decimal(receita),
            "receita_estimavel": None if qtd is None else Decimal(receita),
            "quantidade": None if qtd is None else Decimal(qtd), "custo": None, "linhas": 3}


def unitario(chave, custo, qtd, tipo="codigo_produto", marca="kokeshi", mes=OUT):
    """Linha de custo unitario (`codigo_produto` ou `sku_canonico`) de `SQL_CMV_ESTIMADO`."""
    return {"tipo": tipo, "competencia": mes, "marca": marca, "plataforma": None,
            "codigo_produto": chave if tipo == "codigo_produto" else None,
            "sku_canonico": chave if tipo == "sku_canonico" else None, "receita": None,
            "receita_estimavel": None, "quantidade": Decimal(qtd), "custo": Decimal(str(custo)), "linhas": 2}


def lote_est(esp, cmvs, estimado, contraprova=None, numeracao_nf=None):
    canais = [c for c in P.CANAIS if P.MKT_ID[c] in {r["marketplace_id"] for r in esp}]
    return P.montar_lote(esperado=list(esp), cmv=list(cmvs),
                         contraprova=list(contraprova if contraprova is not None else [cp(c) for c in cmvs]),
                         repasse=[], canais=canais, comps=[OUT], numeracao_nf=numeracao_nf,
                         cmv_estimado=None if estimado is None else list(estimado))


def _shopee(receita=1000, custo=100, rcc=400, marca="kokeshi"):
    return cmv("shopee", marca, receita=receita, custo=custo, rcc=rcc, mes=OUT, emissao=date(2026, 10, 31))


def _esp_shopee(marca="kokeshi", gmv=1000):
    return [esperado("shopee", marca, gmv=gmv, mes=OUT)]


def test_t0091_sku_sem_custo_com_custo_no_mes_e_estimado_e_a_cobertura_sobe():
    c = _shopee()  # 1000 de receita, 400 com custo (100), 600 sem custo
    lt = lote_est(_esp_shopee(), [c], [sem_custo("K1", receita=600, qtd=10), unitario("K1", custo=50, qtd=5)])
    assert lt.recusas == [] and lt.cmv_estimado_estado == "publicado"
    r = linha(lt, "shopee", "kokeshi", "cmv")
    assert r["valor"] == Decimal("200.00")  # 100 real + 10 un x 10/un
    assert r["cobertura"] == Decimal(1)  # com a estimativa
    assert r["provisorio_share"] == Decimal(0)  # do custo REAL, como antes
    assert r["procedencia"] == P.PROC_CMV_ESTIMADO
    # razao com o GMV na faixa, mas cobertura REAL 0,40 < 0,98: fica fora da margem, como ja' ficava
    assert r["status_reconciliacao"] == "nao_reconciliado"
    partes = r["motivo"].split("; ")
    assert partes[0] == "receita fiscal / GMV = 1.0000"
    assert partes[1].startswith(P.CUSTO_ESTIMADO + "100.00 de 200.00 do CMV")
    assert "cobertura real 0.4000 e com a estimativa 1.0000" in partes[1]
    assert "receita sem custo nenhum 0.00" in partes[1] and "abaixo de 0.98" in partes[1]
    # a receita fiscal nao muda
    assert linha(lt, "shopee", "kokeshi", "cmv_receita_fiscal")["valor"] == Decimal(1000)
    (cel,) = lt.cmv_estimado
    assert cel["cobertura_real"] == "0.400000" and cel["cobertura_com_estimativa"] == "1.000000"


def test_t0091_sku_sem_custo_no_mes_fica_descoberto_e_nao_vira_zero():
    lt = lote_est(_esp_shopee(), [_shopee()],
                  [sem_custo("K1", receita=300, qtd=10), sem_custo("K9", receita=300, qtd=4),
                   unitario("K1", custo=50, qtd=5)])
    r = linha(lt, "shopee", "kokeshi", "cmv")
    assert r["valor"] == Decimal("200.00")  # K9 nao entrou com custo nenhum (nem zero)
    assert r["cobertura"] == Decimal("0.7")  # (400 + 300) / 1000
    assert "receita sem custo nenhum 300.00" in r["motivo"]
    assert lt.cmv_estimado[0]["skus_estimados"] == 1 and lt.cmv_estimado[0]["skus_sem_custo"] == 2


def test_t0091_celula_sem_custo_e_sem_sku_estimavel_continua_nula_e_identica():
    c = _shopee(custo=None)  # nenhuma linha com custo
    lt = lote_est(_esp_shopee(), [c], [sem_custo("K9", receita=1000, qtd=4)])
    r = linha(lt, "shopee", "kokeshi", "cmv")
    assert r["valor"] is None and r["status_reconciliacao"] == "ausente_na_origem" and r["cobertura"] is None
    assert lt.linhas == lote_est(_esp_shopee(), [c], None).linhas and lt.cmv_estimado == []


def test_t0091_celula_so_com_custo_estimado_publica_o_estimado():
    c = _shopee(custo=None)
    lt = lote_est(_esp_shopee(), [c], [sem_custo("K1", receita=1000, qtd=10), unitario("K1", custo=50, qtd=5)])
    r = linha(lt, "shopee", "kokeshi", "cmv")
    assert r["valor"] == Decimal("100.00") and r["status_reconciliacao"] == "nao_reconciliado"
    assert r["provisorio_share"] is None and "cobertura real 0.0000 e com a estimativa 1.0000" in r["motivo"]


def test_t0091_quantidade_nao_positiva_nao_e_estimada():
    lt = lote_est(_esp_shopee(), [_shopee()],
                  [sem_custo("K1", receita=600, qtd=None), unitario("K1", custo=50, qtd=5)])
    assert linha(lt, "shopee", "kokeshi", "cmv")["valor"] == Decimal(100)  # como antes
    assert lt.cmv_estimado == []


def test_t0091_cai_no_sku_canonico_quando_o_codigo_nao_casa():
    """Rituaria out/26: o Full usa codigo de anuncio (MLPREBIOTICA); o `sku_canonico` resolve."""
    lt = lote_est(_esp_shopee("rituaria"), [_shopee(marca="rituaria")],
                  [sem_custo("MLPREBIOTICA", sku="PREB-01", receita=600, qtd=10, marca="rituaria"),
                   unitario("PREB-01", custo=80, qtd=10, tipo="sku_canonico", marca="rituaria"),
                   unitario("OUTRO", custo=999, qtd=1, marca="rituaria")])
    assert linha(lt, "shopee", "rituaria", "cmv")["valor"] == Decimal("180.00")  # 100 + 10 un x 8/un
    assert lt.cmv_estimado[0]["receita_estimada_via_sku_canonico"] == "600"


def test_t0091_codigo_casado_tem_precedencia_sobre_o_sku_canonico():
    est = [sem_custo("K1", sku="S1", receita=600, qtd=10),
           unitario("K1", custo=20, qtd=10), unitario("S1", custo=500, qtd=10, tipo="sku_canonico")]
    r = linha(lote_est(_esp_shopee(), [_shopee()], est), "shopee", "kokeshi", "cmv")
    assert r["valor"] == Decimal("120.00")  # 2/un pelo codigo, nao 50/un pelo sku


def test_t0091_codigo_nulo_cai_no_sku_canonico():
    est = [sem_custo(None, sku="S1", receita=600, qtd=10), unitario("S1", custo=30, qtd=10, tipo="sku_canonico")]
    assert linha(lote_est(_esp_shopee(), [_shopee()], est), "shopee", "kokeshi", "cmv")["valor"] == Decimal("130.00")


def test_t0091_custo_unitario_de_outro_mes_ou_outra_marca_nao_serve():
    est = [sem_custo("K1", receita=600, qtd=10), unitario("K1", custo=50, qtd=5, marca="apice"),
           unitario("K1", custo=50, qtd=5, mes=date(2026, 9, 1))]
    lt = lote_est(_esp_shopee(), [_shopee()], est)
    assert linha(lt, "shopee", "kokeshi", "cmv")["valor"] == Decimal(100) and lt.cmv_estimado == []


def test_t0091_celulas_sem_custo_nulo_saem_identicas():
    """TikTok, ML e Shopee com custo em toda linha: nada muda; so' a celula com linha sem custo."""
    esp = [esperado(c, m, gmv=1_000_000, mes=OUT) for c in ("tiktok", "ml") for m in ("kokeshi", "apice")]
    esp += _esp_shopee("apice") + _esp_shopee("kokeshi")
    cmvs = [cmv(c, m, mes=OUT, emissao=date(2026, 10, 31)) for c in ("tiktok", "ml") for m in ("kokeshi", "apice")]
    cmvs += [_shopee(marca="apice", rcc=1000), _shopee()]
    est = [sem_custo("K1", receita=600, qtd=10), unitario("K1", custo=50, qtd=5)]
    antes, depois = lote_est(esp, cmvs, None), lote_est(esp, cmvs, est)
    assert depois.recusas == antes.recusas == [] and len(antes.linhas) == len(depois.linhas)
    mudou = [(a["canal"], a["marca"], a["componente"]) for a, d in zip(antes.linhas, depois.linhas) if a != d]
    assert mudou == [("shopee", "kokeshi", "cmv")]
    # leitura vazia (nenhuma linha sem custo) = lote identico ao sem a leitura
    assert lote_est(esp[:-1], cmvs[:-1], []).linhas == lote_est(esp[:-1], cmvs[:-1], None).linhas


def test_t0091_cobertura_real_acima_do_minimo_mantem_o_status_da_razao():
    c = _shopee(receita=100_000, custo=30_000, rcc=99_000)  # 1% sem custo
    lt = lote_est(_esp_shopee(gmv=100_000), [c],
                  [sem_custo("K1", receita=1000, qtd=10), unitario("K1", custo=300, qtd=10)])
    r = linha(lt, "shopee", "kokeshi", "cmv")
    assert r["status_reconciliacao"] == "reconciliado" and r["valor"] == Decimal("30300.00")
    assert r["cobertura"] == Decimal(1) and "abaixo de" not in r["motivo"]


def test_t0091_contraprova_compara_so_a_parte_real_e_nao_recusa():
    """O agregado gold tem so' o custo REAL (Q23: kokeshi 139 mil); o publicado tem real + estimado."""
    c = _shopee()
    est = [sem_custo("K1", receita=600, qtd=10), unitario("K1", custo=50, qtd=5)]
    lt = lote_est(_esp_shopee(), [c], est, contraprova=[cp(c)])
    assert lt.recusas == [] and lt.observacoes == []
    assert linha(lt, "shopee", "kokeshi", "cmv")["valor"] == Decimal("200.00")
    # a contraprova continua recusando divergencia da parte real
    lt2 = lote_est(_esp_shopee(), [c], est, contraprova=[cp(c, custo=Decimal(150))])
    assert any("diverge do agregado mensal" in m for m in lt2.recusas)


def test_t0091_receita_sem_custo_divergente_descarta_a_estimativa_sem_recusar_o_lote():
    """Recarga da gold entre o `SQL_CMV` e a leitura da estimativa: o lote sai como antes."""
    c = _shopee()
    sem_est = lote_est(_esp_shopee(), [c], None).linhas
    lt = lote_est(_esp_shopee(), [c], [sem_custo("K1", receita=900, qtd=10), unitario("K1", custo=50, qtd=5)])
    assert lt.recusas == [] and lt.linhas == sem_est
    assert lt.cmv_estimado_estado.startswith("recusado: cmv_estimado: receita sem custo")
    # celula com receita descoberta que a leitura da estimativa nao trouxe tambem descarta
    lt2 = lote_est(_esp_shopee(), [c], [])
    assert lt2.cmv_estimado_estado.startswith("recusado:") and lt2.linhas == sem_est


def test_t0091_custo_unitario_negativo_descarta_a_estimativa():
    c = _shopee()
    lt = lote_est(_esp_shopee(), [c], [sem_custo("K1", receita=600, qtd=10), unitario("K1", custo=-50, qtd=5)])
    assert lt.recusas == [] and "custo negativo" in lt.cmv_estimado_estado
    assert lt.linhas == lote_est(_esp_shopee(), [c], None).linhas


def test_t0091_estimativa_convive_com_contraprova_defasada_e_buraco_de_nf():
    c = _shopee()
    lt = lote_est(_esp_shopee(), [c], [sem_custo("K1", receita=600, qtd=10), unitario("K1", custo=50, qtd=5)],
                  contraprova=[cp(c, ultima_emissao=date(2026, 10, 27))], numeracao_nf=[nf("kokeshi")])
    partes = linha(lt, "shopee", "kokeshi", "cmv")["motivo"].split("; ")
    assert len(partes) == 4 and partes[1].startswith(P.CUSTO_ESTIMADO)
    assert partes[2].startswith("contraprova nao bloqueante")
    assert partes[3] == "buraco de numeracao de NF em 03/10 (1.914 numeros)"


def test_t0091_estimativa_e_deterministica_na_ordem_da_leitura():
    est = [sem_custo("K1", receita=300, qtd=10), sem_custo(None, sku="S1", receita=300, qtd=3),
           unitario("K1", custo=50, qtd=5), unitario("S1", custo="33.33", qtd=7, tipo="sku_canonico")]
    assert lote_est(_esp_shopee(), [_shopee()], est).linhas == \
        lote_est(_esp_shopee(), [_shopee()], list(reversed(est))).linhas


def test_t0091_kokeshi_shopee_out26_cmv_sobe_de_3_9_para_22_por_cento():
    """Numeros do DIAGNOSTICO_NF_SHOPEE (T-0091 Fase 1): receita fiscal 3.594.806 = Bling 635.595
    (custo ~139 mil) + Full webgex 2.959.211 sem custo; CMV Full estimado 656,1 mil (99,99% da
    receita Full coberta); GMV 3.850.275."""
    c = _shopee(receita=3_594_806, custo=139_000, rcc=635_595)
    est = [sem_custo("K1", receita=2_000_000, qtd=40_000), sem_custo("K2", receita=958_911, qtd=25_610),
           sem_custo("K3", receita=300, qtd=10),  # sem custo no mes: fica descoberto
           unitario("K1", custo=200_000, qtd=20_000), unitario("K2", custo=256_100, qtd=25_610)]
    esp = _esp_shopee(gmv=3_850_275)
    antes = linha(lote_est(esp, [c], None), "shopee", "kokeshi", "cmv")
    lt = lote_est(esp, [c], est)
    depois = linha(lt, "shopee", "kokeshi", "cmv")
    rf = Decimal(3_594_806)
    assert round(antes["valor"] / rf, 3) == Decimal("0.039") and round(antes["cobertura"], 3) == Decimal("0.177")
    assert depois["valor"] == Decimal("795100.00")  # 139.000 + 400.000 + 256.100
    assert round(depois["valor"] / rf, 3) == Decimal("0.221")
    assert round(depois["cobertura"], 4) == Decimal("0.9999")
    assert "cobertura real 0.1768 e com a estimativa 0.9999" in depois["motivo"]
    assert "receita sem custo nenhum 300.00" in depois["motivo"]
    # a razao com o GMV (0,934) ja' deixava a celula nao reconciliada; continua
    assert depois["status_reconciliacao"] == antes["status_reconciliacao"] == "nao_reconciliado"
    assert depois["motivo"].startswith("receita fiscal / GMV = 0.9336")
    assert lt.recusas == []


def test_t0091_trecho_do_motivo_comeca_com_o_rotulo_e_nao_tem_separador_interno():
    lt = lote_est(_esp_shopee(), [_shopee()],
                  [sem_custo("K1", receita=300, qtd=10), sem_custo("K9", receita=300, qtd=1),
                   unitario("K1", custo=50, qtd=5)])
    (trecho,) = [p for p in linha(lt, "shopee", "kokeshi", "cmv")["motivo"].split("; ")
                 if p.startswith(P.CUSTO_ESTIMADO)]
    assert trecho.endswith("ate' o custo vir na fonte")  # o trecho inteiro sobreviveu ao split


def test_t0091_minimo_de_cobertura_e_o_mesmo_do_serving():
    fonte = (REPO / "apps" / "api" / "app" / "services" / "dre_service.py").read_text(encoding="utf-8")
    assert "COBERTURA_CMV_MINIMA = 0.98" in fonte and P.CMV_COBERTURA_MINIMA == Decimal("0.98")


def test_t0091_sql_da_estimativa_le_as_mesmas_celulas_do_cmv_e_custo_de_qualquer_canal():
    sql = _sql(P.SQL_CMV_ESTIMADO)
    sem = sql[sql.index("sem_custo AS"):sql.index("com_custo AS")]
    for filtro in ("data_mes = ANY(:competencias)", "canal = 'marketplace'", "plataforma = ANY(:plataformas)",
                   "marca = ANY(:marcas)", "intercompany IS NOT TRUE", "custo IS NULL"):
        assert filtro in sem
    assert "GROUP BY data_mes, marca, plataforma, codigo_produto, sku_canonico" in sem
    com = sql[sql.index("com_custo AS"):sql.index("SELECT 'sem_custo'")]
    assert "custo IS NOT NULL" in com and "quantidade_item > 0" in com and "intercompany IS NOT TRUE" in com
    assert "canal" not in com  # qualquer canal da marca
    assert "GROUP BY data_mes, marca, codigo_produto" in sql and "GROUP BY data_mes, marca, sku_canonico" in sql
    assert "COALESCE" not in sql.upper() and " JOIN " not in sql.upper()  # casamento e conta ficam no Python
    assert sql.count("FROM gold.nf_vendas_unificada_v2") == 2 and "{{" not in sql and "[[" not in sql


def test_t0091_leitura_da_estimativa_e_read_only_com_timeout_e_nao_derruba_o_lote():
    fonte = (REPO / "pipelines" / "dre" / "insumo_publisher.py").read_text(encoding="utf-8")
    trecho = fonte[fonte.index("def ler_cmv_estimado"):fonte.index("def _resumo_cmv_estimado")]
    assert trecho.index("SET TRANSACTION READ ONLY") < trecho.index("statement_timeout = '600s'") \
        < trecho.index("SQL_CMV_ESTIMADO")
    assert "except SQLAlchemyError" in trecho and "except Exception" not in trecho
    linhas, estado = P.ler_cmv_estimado(_EngQuebra(), [OUT], ["shopee"], ["kokeshi"])
    assert linhas is None and estado == "indisponivel: ProgrammingError"  # so' a classe, nada de host
    assert P.ler_cmv_estimado(None, [OUT], ["shopee"], ["kokeshi"])[0] is None
    assert P.ler_cmv_estimado(_EngQuebra(), [OUT], ["shopee"], [])[0] is None


# ---------------------------------------------------------------------------
# T-0087b — a leitura do CMV filtra data_emissao na janela (indice, sem timeout)
# ---------------------------------------------------------------------------

FILTRO_EMISSAO = "data_emissao >= :inicio AND data_emissao < :fim_exclusivo"


def test_t0087b_sql_do_cmv_e_os_dois_ctes_da_estimativa_filtram_data_emissao_na_janela():
    assert FILTRO_EMISSAO in _sql(P.SQL_CMV)
    sql = _sql(P.SQL_CMV_ESTIMADO)
    sem = sql[sql.index("sem_custo AS"):sql.index("com_custo AS")]
    com = sql[sql.index("com_custo AS"):sql.index("SELECT 'sem_custo'")]
    assert FILTRO_EMISSAO in sem and FILTRO_EMISSAO in com


class _ConnParams:
    def __init__(self, eng):
        self.eng = eng

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def rollback(self):
        pass

    def execute(self, sql, params=None):
        if params is not None:
            self.eng.params[sql] = params
        return _Res()


class _EngParams:
    """Data Mart que so' guarda os params de cada SQL e devolve zero linha."""

    def __init__(self):
        self.params = {}

    def connect(self):
        return _ConnParams(self)


AGO = date(2026, 8, 1)
JANELA_JUL_OUT = {"inicio": JUL, "fim_exclusivo": date(2026, 11, 1)}


def test_t0087b_ler_fonte_passa_a_janela_de_emissao():
    eng = _EngParams()
    P.ler_fonte(eng, [JUL, AGO, date(2026, 9, 1), OUT], ["ml"], ["kokeshi"])
    p = eng.params[P.SQL_CMV]
    assert {k: p[k] for k in JANELA_JUL_OUT} == JANELA_JUL_OUT


def test_t0087b_ler_cmv_estimado_passa_a_janela_de_emissao():
    # T-0091b: a janela do lote vai para a pre-consulta; sem lacuna, a pesada nem roda
    eng = _EngParams()
    linhas, estado = P.ler_cmv_estimado(eng, [JUL, AGO, date(2026, 9, 1), OUT], ["shopee"], ["kokeshi"])
    assert linhas == [] and estado == "lido"
    p = eng.params[P.SQL_CMV_LACUNAS]
    assert {k: p[k] for k in JANELA_JUL_OUT} == JANELA_JUL_OUT
    assert P.SQL_CMV_ESTIMADO not in eng.params
    # virada de ano: dezembro fecha em 1o de janeiro (na pre-consulta e na pesada)
    eng = _EngParams()
    P.ler_cmv_estimado(eng, [date(2026, 12, 1)], ["shopee"], ["kokeshi"])
    p = eng.params[P.SQL_CMV_LACUNAS]
    assert (p["inicio"], p["fim_exclusivo"]) == (date(2026, 12, 1), date(2027, 1, 1))
    p = P.params_lacunas([{"competencia": date(2026, 12, 1), "marca": "kokeshi"}], ["shopee"])
    assert (p["inicio"], p["fim_exclusivo"]) == (date(2026, 12, 1), date(2027, 1, 1))


def test_t0087b_ler_impostos_usa_a_mesma_janela_de_emissao_do_cmv():
    assert FILTRO_EMISSAO in _sql(P.SQL_IMPOSTOS)
    comps = [JUL, AGO, date(2026, 9, 1), OUT]
    eng = _EngParams()
    P.ler_impostos(eng, comps, ["ml"], ["kokeshi"], True)
    p = eng.params[P.SQL_IMPOSTOS]
    assert {k: p[k] for k in JANELA_JUL_OUT} == JANELA_JUL_OUT
    # a janela do webgex (folga em volta) nao muda
    assert (p["inicio_webgex"], p["fim_webgex"]) == P.janela_webgex(comps)


def test_t0091_publicar_le_a_estimativa_sem_conexao_do_neon_e_grava_o_cmv_estimado(monkeypatch):
    alvo = _AlvoFake(_esp_shopee())
    fonte = _FonteFake(alvo, [_shopee()], estimado=[sem_custo("K1", receita=600, qtd=10),
                                                    unitario("K1", custo=50, qtd=5)])
    vistas = []
    real = P.ler_cmv_estimado

    def espiao(*a, **k):
        vistas.append(len(alvo.abertas))
        return real(*a, **k)

    monkeypatch.setattr(P, "ler_cmv_estimado", espiao)
    res = P.publicar(alvo, fonte, [OUT], ["shopee"], agora=datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc))
    assert vistas == [0] and set(fonte.abertas_na_leitura) == {0}
    assert res["aplicado"] is True and res["recusas"] == [] and res["cmv_estimado"]["estado"] == "publicado"
    (c,) = [r for r in alvo.inseridas if r["componente"] == "cmv"]
    assert c["valor"] == Decimal("200.00") and c["procedencia"] == P.PROC_CMV_ESTIMADO
    assert alvo.auditoria == ["running", "success"] and alvo.abertas == []


# ---------------------------------------------------------------------------
# T-0091b — a estimativa so' le os meses x marcas com custo nulo
# ---------------------------------------------------------------------------
# Emuladores em Python dos SQL sobre itens de NF de fixture: `_sql_antigo` e' o
# `SQL_CMV_ESTIMADO` da T-0091 (com_custo de todos os meses, duas somas sobre
# as linhas); `_sql_novo` e' o atual (so' as lacunas, um agregado por
# mes x marca x codigo x sku e as somas por chave sobre ele). Provam a algebra
# (mesma estimativa), nao o SQL: a sintaxe fica com os testes de texto e o EXPLAIN.

def item(mes, marca, cod, sku, receita, qtd, custo, canal="marketplace", plat="shopee", inter=False):
    return {"data_mes": mes, "marca": marca, "canal": canal, "plataforma": plat if canal == "marketplace" else None,
            "codigo_produto": cod, "sku_canonico": sku, "receita_produto": Decimal(str(receita)),
            "quantidade_item": Decimal(str(qtd)), "custo": None if custo is None else Decimal(str(custo)),
            "intercompany": inter}


def _na_janela(i, p):
    return i["data_mes"] in p["competencias"] and p["inicio"] <= i["data_mes"] < p["fim_exclusivo"]


def _celula_sem_custo(i, p):
    return (_na_janela(i, p) and i["canal"] == "marketplace" and i["plataforma"] in p["plataformas"]
            and i["marca"] in p["marcas"] and i["intercompany"] is not True and i["custo"] is None)


def _com_custo(i, p):
    return (_na_janela(i, p) and i["marca"] in p["marcas"] and i["intercompany"] is not True
            and i["custo"] is not None and i["quantidade_item"] > 0)


def _soma(vals):
    vals = list(vals)
    return sum(vals, Decimal(0)) if vals else None  # SUM de nada e' NULL


def _emula_sem_custo(itens, p):
    grupos = {}
    for i in itens:
        if _celula_sem_custo(i, p):
            k = (i["data_mes"], i["marca"], i["plataforma"], i["codigo_produto"], i["sku_canonico"])
            grupos.setdefault(k, []).append(i)
    return [{"tipo": "sem_custo", "competencia": m, "marca": marca, "plataforma": plat, "codigo_produto": cod,
             "sku_canonico": sku, "receita": _soma(i["receita_produto"] for i in g),
             "receita_estimavel": _soma(i["receita_produto"] for i in g if i["quantidade_item"] > 0),
             "quantidade": _soma(i["quantidade_item"] for i in g if i["quantidade_item"] > 0),
             "custo": None, "linhas": len(g)}
            for (m, marca, plat, cod, sku), g in sorted(grupos.items(), key=str)]


def _unitarios(pares, tipo):
    """`pares` = [((mes, marca, chave), quantidade, custo, linhas)] -> linhas de custo unitario."""
    grupos = {}
    for k, qtd, custo, n in pares:
        g = grupos.setdefault(k, [Decimal(0), Decimal(0), 0])
        g[0], g[1], g[2] = g[0] + qtd, g[1] + custo, g[2] + n
    return [{"tipo": tipo, "competencia": m, "marca": marca, "plataforma": None,
             "codigo_produto": v if tipo == "codigo_produto" else None,
             "sku_canonico": v if tipo == "sku_canonico" else None, "receita": None, "receita_estimavel": None,
             "quantidade": q, "custo": c, "linhas": n}
            for (m, marca, v), (q, c, n) in sorted(grupos.items(), key=str)]


def _chaves_sem_custo(sem):
    return {r["codigo_produto"] for r in sem} - {None}, {r["sku_canonico"] for r in sem} - {None}


def _sql_antigo(itens, p):
    sem = _emula_sem_custo(itens, p)
    cods, skus = _chaves_sem_custo(sem)
    com = [i for i in itens if _com_custo(i, p)]
    return (sem
            + _unitarios([((i["data_mes"], i["marca"], i["codigo_produto"]), i["quantidade_item"], i["custo"], 1)
                          for i in com if i["codigo_produto"] in cods], "codigo_produto")
            + _unitarios([((i["data_mes"], i["marca"], i["sku_canonico"]), i["quantidade_item"], i["custo"], 1)
                          for i in com if i["sku_canonico"] in skus], "sku_canonico"))


def _sql_novo(itens, p):
    sem = _emula_sem_custo(itens, p)
    cods, skus = _chaves_sem_custo(sem)
    agregado = {}  # um scan: semi-join (codigo OU sku) antes de agregar
    for i in itens:
        if _com_custo(i, p) and (i["codigo_produto"] in cods or i["sku_canonico"] in skus):
            k = (i["data_mes"], i["marca"], i["codigo_produto"], i["sku_canonico"])
            g = agregado.setdefault(k, [Decimal(0), Decimal(0), 0])
            g[0], g[1], g[2] = g[0] + i["quantidade_item"], g[1] + i["custo"], g[2] + 1
    return (sem
            + _unitarios([((m, marca, cod), q, c, n) for (m, marca, cod, _), (q, c, n) in agregado.items()
                          if cod in cods], "codigo_produto")
            + _unitarios([((m, marca, sku), q, c, n) for (m, marca, _, sku), (q, c, n) in agregado.items()
                          if sku in skus], "sku_canonico"))


def _emula_lacunas(itens, p):
    return [{"competencia": m, "marca": marca}
            for m, marca in sorted({(i["data_mes"], i["marca"]) for i in itens if _celula_sem_custo(i, p)})]


class _ConnItens:
    def __init__(self, eng):
        self.eng = eng

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def rollback(self):
        pass

    def execute(self, sql, params=None):
        self.eng.chamadas.append((sql, params))
        if sql is P.SQL_CMV_LACUNAS:
            return _Res(linhas=_emula_lacunas(self.eng.itens, params))
        if sql is P.SQL_CMV_ESTIMADO:
            return _Res(linhas=_sql_novo(self.eng.itens, params))
        return _Res()


class _EngItens:
    """Data Mart que responde a pre-consulta e a estimativa pelos emuladores."""

    def __init__(self, itens):
        self.itens, self.chamadas = list(itens), []

    def connect(self):
        return _ConnItens(self)

    def sqls(self):
        return [s for s, _ in self.chamadas if s in (P.SQL_CMV_LACUNAS, P.SQL_CMV_ESTIMADO)]

    def params(self, sql):
        (p,) = [p for s, p in self.chamadas if s is sql]
        return p


SET = date(2026, 9, 1)
COMPS_JUL_OUT = [JUL, AGO, SET, OUT]
CANAIS_3 = ["tiktok", "ml", "shopee"]
MARCAS_5 = ["apice", "barbours", "kokeshi", "lescent", "rituaria"]

#: Out/26 com lacuna (kokeshi e rituaria); jul-set com custo em tudo, mas com
#: os MESMOS SKUs (o SQL antigo devolvia custo unitario desses meses tambem).
ITENS = [
    # kokeshi out: K1 sem custo casa por codigo; custo de outro canal tambem conta
    item(OUT, "kokeshi", "K1", "S1", 600, 10, None),
    item(OUT, "kokeshi", "K1", "S1", 300, 5, 40),
    item(OUT, "kokeshi", "K1", "SX", 100, 2, 22, canal="ecommerce"),  # casa so' pelo codigo
    item(OUT, "kokeshi", "K1", "S1", 999, 9, 1, inter=True),  # intercompany fica fora
    # kokeshi out: K2 sem custo, codigo sem par, casa pelo sku S2 de outro codigo
    item(OUT, "kokeshi", "K2", "S2", 250, 5, None, plat="tiktokshop"),
    item(OUT, "kokeshi", "KY", "S2", 80, 4, 12, canal="atacado"),
    # kokeshi out: sem codigo e sem par; e uma linha sem quantidade (receita nao estimavel)
    item(OUT, "kokeshi", None, "S9", 70, 1, None),
    item(OUT, "kokeshi", "K1", "S1", 15, 0, None),
    # rituaria out: anuncio do Full so' casa pelo sku com linha de outro canal
    item(OUT, "rituaria", "FULL-1", "R1", 500, 4, None, plat="mercadolivre"),
    item(OUT, "rituaria", "R-ECOM", "R1", 120, 3, 45, canal="ecommerce"),
    # jul-set: com custo, mesmos SKUs (nada a estimar nesses meses)
    item(JUL, "kokeshi", "K1", "S1", 400, 8, 33),
    item(AGO, "kokeshi", "KY", "S2", 50, 2, 7, canal="atacado"),
    item(SET, "rituaria", "R-ECOM", "R1", 90, 2, 30, canal="ecommerce"),
    item(SET, "barbours", "B1", "BS1", 900, 9, 300),
]


def _params(comps=COMPS_JUL_OUT, canais=CANAIS_3, marcas=MARCAS_5):
    return {"competencias": list(comps), "plataformas": [P.PLATAFORMA_FISCAL[c] for c in canais],
            "marcas": list(marcas), "inicio": comps[0], "fim_exclusivo": P.somar_meses(comps[-1], 1)}


def _mes(v):
    return date(v.year, v.month, 1)


def test_t0091b_sql_da_pre_consulta_tem_os_filtros_de_celula_do_cmv():
    sql = _sql(P.SQL_CMV_LACUNAS)
    for filtro in ("data_mes = ANY(:competencias)", FILTRO_EMISSAO, "canal = 'marketplace'",
                   "plataforma = ANY(:plataformas)", "marca = ANY(:marcas)", "intercompany IS NOT TRUE",
                   "custo IS NULL", "GROUP BY data_mes, marca"):
        assert filtro in sql
    cmv = _sql(P.SQL_CMV)
    where_do_cmv = cmv[cmv.index("FROM gold.nf_vendas_unificada_v2 WHERE"):cmv.index("GROUP BY")]
    assert where_do_cmv in sql  # o WHERE inteiro do CMV, mais o custo nulo


def test_t0091b_com_custo_e_um_scan_com_semi_join_antes_de_agregar():
    sql = _sql(P.SQL_CMV_ESTIMADO)
    com = sql[sql.index("com_custo AS"):sql.index("SELECT 'sem_custo'")]
    assert ("(codigo_produto IN (SELECT codigo_produto FROM sem_custo) "
            "OR sku_canonico IN (SELECT sku_canonico FROM sem_custo))") in com
    assert com.index("OR sku_canonico IN") < com.index("GROUP BY data_mes, marca, codigo_produto, sku_canonico")
    assert FILTRO_EMISSAO in com
    assert sql.count("FROM gold.nf_vendas_unificada_v2") == 2  # sem_custo + um scan do custo


def test_t0091b_pre_consulta_vazia_nao_roda_a_leitura_pesada():
    so_com_custo = [i for i in ITENS if i["custo"] is not None]
    eng = _EngItens(so_com_custo)
    linhas, estado = P.ler_cmv_estimado(eng, COMPS_JUL_OUT, CANAIS_3, MARCAS_5)
    assert (linhas, estado) == ([], "lido")
    assert eng.sqls() == [P.SQL_CMV_LACUNAS]
    # o SQL antigo tambem nao devolvia nada: o lote fica igual ao de hoje
    assert _sql_antigo(so_com_custo, _params()) == []


def test_t0091b_pre_consulta_com_out_le_so_out_e_as_marcas_com_lacuna():
    eng = _EngItens(ITENS)
    linhas, estado = P.ler_cmv_estimado(eng, COMPS_JUL_OUT, CANAIS_3, MARCAS_5)
    assert estado == "lido" and linhas
    assert eng.sqls() == [P.SQL_CMV_LACUNAS, P.SQL_CMV_ESTIMADO]
    assert eng.params(P.SQL_CMV_LACUNAS) == _params()  # a pre-consulta ve o lote todo
    assert eng.params(P.SQL_CMV_ESTIMADO) == {
        "competencias": [OUT], "plataformas": _params()["plataformas"], "marcas": ["kokeshi", "rituaria"],
        "inicio": OUT, "fim_exclusivo": date(2026, 11, 1)}
    assert {_mes(r["competencia"]) for r in linhas} == {OUT}


def test_t0091b_mesma_estimativa_que_o_sql_antigo():
    antigo = _sql_antigo(ITENS, _params())
    novo, _ = P.ler_cmv_estimado(_EngItens(ITENS), COMPS_JUL_OUT, CANAIS_3, MARCAS_5)
    est_antigo, rec_antigo = P.estimar_cmv(antigo)
    est_novo, rec_novo = P.estimar_cmv(novo)
    assert rec_antigo == rec_novo == []
    assert est_novo == est_antigo
    # a fixture exercita o codigo, o sku e a receita descoberta
    k = est_novo[(OUT, "shopee", "kokeshi")]
    # K1: (40 + 22) / (5 + 2) por unidade x 10 = 88,57; o intercompany ficou fora; S9 sem par
    assert k["custo_estimado"] == Decimal("88.57") and (k["skus_sem_custo"], k["skus_estimados"]) == (2, 1)
    assert k["receita_sem_custo"] == Decimal(685) and k["receita_estimada"] == Decimal(600)
    assert est_novo[(OUT, "tiktok", "kokeshi")]["custo_estimado"] == Decimal("15.00")  # K2 pelo sku S2: 12/4 x 5
    r = est_novo[(OUT, "ml", "rituaria")]
    assert r["custo_estimado"] == Decimal("60.00") and r["receita_estimada_sku"] == Decimal(500)
    # o antigo devolvia custo unitario de jul-set que ninguem usava
    assert len(antigo) > len(novo) and {_mes(r["competencia"]) for r in antigo} == {JUL, AGO, SET, OUT}


def test_t0091b_mesma_estimativa_com_lacuna_em_dois_meses_e_marcas_diferentes():
    itens = ITENS + [item(JUL, "barbours", "B1", "BS1", 100, 1, None),
                     item(JUL, "barbours", "B1", "BS1", 200, 2, 70, canal="ecommerce")]
    eng = _EngItens(itens)
    novo, _ = P.ler_cmv_estimado(eng, COMPS_JUL_OUT, CANAIS_3, MARCAS_5)
    p = eng.params(P.SQL_CMV_ESTIMADO)
    assert p["competencias"] == [JUL, OUT] and p["marcas"] == ["barbours", "kokeshi", "rituaria"]
    assert (p["inicio"], p["fim_exclusivo"]) == (JUL, date(2026, 11, 1))
    est_novo = P.estimar_cmv(novo)
    assert est_novo == P.estimar_cmv(_sql_antigo(itens, _params()))
    assert est_novo[0][(JUL, "shopee", "barbours")]["custo_estimado"] == Decimal("35.00")


def test_t0091b_erro_na_pre_consulta_vira_indisponivel():
    linhas, estado = P.ler_cmv_estimado(_EngQuebra(), COMPS_JUL_OUT, ["shopee"], ["kokeshi"])
    assert linhas is None and estado == "indisponivel: ProgrammingError"


def test_t0091b_pre_consulta_roda_sem_conexao_do_neon_aberta():
    for estimado in ([], [sem_custo("K1", receita=600, qtd=10), unitario("K1", custo=50, qtd=5)]):
        alvo = _AlvoFake(_esp_shopee())
        fonte = _FonteFake(alvo, [_shopee(rcc=400 if estimado else 1000)], estimado=estimado)
        res = P.publicar(alvo, fonte, [OUT], ["shopee"],
                         agora=datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc))
        assert res["aplicado"] is True and res["recusas"] == []
        assert res["cmv_estimado"]["estado"] == "publicado"
        lidas = [(s, n) for s, n in fonte.sqls if s in (P.SQL_CMV_LACUNAS, P.SQL_CMV_ESTIMADO)]
        assert [s for s, _ in lidas] == [P.SQL_CMV_LACUNAS] + ([P.SQL_CMV_ESTIMADO] if estimado else [])
        assert {n for _, n in lidas} == {0}
