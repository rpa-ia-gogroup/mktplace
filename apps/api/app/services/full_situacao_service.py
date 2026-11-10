"""Indicadores das abas de estoque SEM brinde e descontinuado.

A Visao geral do Full ja' tira esses itens da fila e das contagens; as abas
Estoque ML e Shopee leem os indicadores prontos da fato (SQL). Para as duas
baterem, os indicadores sao CORRIGIDOS aqui, depois da leitura, com a lista
completa do escopo (cada item ja' anotado com `situacao`).

Precedencia: um SKU so' tem UMA situacao (`full_curva_abc_service.interpretar_bd`):
brinde > descontinuado (as duas linhas no mesmo SKU = brinde) e, misturado com
Ativo/Lancamento, nenhum dos dois vale. Nada e' contado duas vezes aqui.

Limites conhecidos (por isso `situacao_aplicada` e as notas de `limitacoes`):
- lista incompleta (truncada, ou so' a listagem filtrada): nada e' corrigido e
  `situacao_aplicada` fica False -- a tela avisa que brindes ainda sao contados;
- ML: o detalhe de "nao disponivel" por STATUS e a alocacao de vendas 28d nao
  sao refeitos (a fato nao os traz por inventario).
"""
from __future__ import annotations

from typing import Iterable

#: classificacao -> campo de contagem dos indicadores
CAMPO_SHOPEE = {
    "RUPTURA_CANDIDATA": "produtos_ruptura", "BAIXO_CANDIDATO": "produtos_baixo",
    "EXCESSO_CANDIDATO": "produtos_excesso", "SEM_GIRO_CANDIDATO": "produtos_sem_giro",
    "SUFICIENTE": "produtos_suficientes", "SEM_DEMANDA_MEDIDA": "produtos_sem_demanda_medida",
    "KIT_NAO_CONCILIADO": "produtos_kit_nao_conciliado",
}
CAMPO_ML = {
    "RUPTURA_CANDIDATA": "inventarios_ruptura", "BAIXO_CANDIDATO": "inventarios_baixo",
    "EXCESSO_CANDIDATO": "inventarios_excesso", "SEM_GIRO_CANDIDATO": "inventarios_sem_giro",
    "SUFICIENTE": "inventarios_suficientes", "SEM_DEMANDA_MEDIDA": "inventarios_sem_demanda_medida",
}
EXIGEM_ACAO = ("RUPTURA_CANDIDATA", "BAIXO_CANDIDATO")

NOTA_ML = ("Contagens e quantidades sem brindes e descontinuados. O detalhe de 'não disponível' "
           "por status ainda os inclui.")


def _menos(obj, campo: str, n: int = 1) -> None:
    v = getattr(obj, campo)
    if v is not None:
        setattr(obj, campo, v - n)


def _contar(itens: Iterable) -> tuple[int, int]:
    b = d = 0
    for i in itens:
        b += i.situacao == "brinde"
        d += i.situacao == "descontinuado"
    return b, d


def descontar_shopee(ind, produtos: list) -> None:
    """Tira de `ind` (Indicadores da Shopee) os produtos com `situacao`."""
    ind.brindes_fora, ind.descontinuados_fora = _contar(produtos)
    for p in (p for p in produtos if p.situacao):
        campo = CAMPO_SHOPEE.get(p.classificacao_torre)
        if campo:
            _menos(ind, campo)
        if p.classificacao_torre in EXIGEM_ACAO:
            _menos(ind, "produtos_exigem_acao")
        ind.produtos_total -= 1
        ind.unidades_vendaveis_total -= p.full_stock_saleable
        if p.is_kit:
            ind.unidades_vendaveis_kits_contexto -= p.full_stock_saleable
        else:
            ind.unidades_vendaveis_operacional -= p.full_stock_saleable
    ind.situacao_aplicada = True


def descontar_ml(resp, inventarios: list) -> None:
    """Tira de `resp.indicadores` e de `resp.marcas` os inventarios com `situacao`."""
    ind = resp.indicadores
    ind.brindes_fora, ind.descontinuados_fora = _contar(inventarios)
    marcas = {m.brand: m for m in resp.marcas}
    for v in (v for v in inventarios if v.situacao):
        lido = v.read_status == "OK"
        alvos = [ind] + ([marcas[v.brand]] if v.brand in marcas else [])
        for a in alvos:
            _menos(a, "inventarios")
            if v.compartilhado:
                _menos(a, "inventarios_compartilhados")
        if v.eh_full and lido:
            for a in alvos:
                _menos(a, "inventarios_full_lidos")
            for campo, valor in (("disponivel_full", v.disponivel), ("nao_disponivel_full", v.nao_disponivel),
                                 ("transfer_full", v.transfer)):
                if valor is None:
                    continue
                for a in alvos:
                    _menos(a, campo, valor)
        if v.eh_full:
            ind.inventarios_full -= 1
        if v.classificacao_torre == "FORA_DO_FULL":
            ind.inventarios_fora_do_full -= 1
        if lido:
            ind.inventarios_lidos -= 1
        else:
            ind.inventarios_sem_leitura -= 1
        campo = CAMPO_ML.get(v.classificacao_torre)
        if campo:
            _menos(ind, campo)
        if v.classificacao_torre in EXIGEM_ACAO:
            ind.inventarios_exigem_acao -= 1
        m = marcas.get(v.brand)
        if m is not None:
            m.por_classificacao[v.classificacao_torre] = m.por_classificacao.get(v.classificacao_torre, 0) - 1
            if m.leitura is not None:
                m.leitura.inventarios -= 1
                if lido:
                    m.leitura.inventarios_lidos -= 1
                else:
                    m.leitura.inventarios_sem_leitura -= 1
        resp.cobertura.leitura.inventarios -= 1
        if lido:
            resp.cobertura.leitura.inventarios_lidos -= 1
        else:
            resp.cobertura.leitura.inventarios_sem_leitura -= 1
    ind.situacao_aplicada = True
    if NOTA_ML not in resp.limitacoes and (ind.brindes_fora or ind.descontinuados_fora):
        resp.limitacoes.append(NOTA_ML)
