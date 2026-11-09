"""Avaliacoes de produto da Shopee na aba CX (`GET /api/v1/cx/shopee/avaliacoes`).

Le `raw.vw_shopee_product_rating` (DAG `shopee_product_comments`, airflow PR
#2424), uma linha por (brand, item_id) JA' VARRIDO:

* item ausente da view = nunca lido: a marca sem nenhuma linha sai `sem_fonte`
  com motivo, nunca zero;
* por marca: somar `avaliacoes`, `com_nota`, `avaliacoes_1a3` e `respondidas`
  e refazer as razoes; nota = sum(nota_media * com_nota) / sum(com_nota);
* `truncado` = a contagem e' um piso (a coleta para em 20 paginas por item, e
  a API da Shopee em 1.000 avaliacoes: `TETO_API_SHOPEE`);
* nome do produto: LEFT JOIN `raw.shopee_products` (brand, item_id).

Sem texto de avaliacao nem comprador (sem PII). Excecao vira `erro` com motivo
fixo; o texto dela nunca sai na resposta nem no log.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.schemas.cx_avaliacoes import AvaliacoesMarca, AvaliacoesProduto, CxAvaliacoesResponse
from app.services.cx_atendimento_service import (
    MARCAS_PERMITIDAS,
    MOTIVO_ERRO,
    SHOPEE_EXPORT,
    SHOPEE_MARCAS,
    Consultar,
    _int,
    _rodar,
    _rotulo_marca,
    _utc,
    consultar_datamart,
)

FONTE = "Data Mart · raw.vw_shopee_product_rating (shopee_product_comments)"
MINIMO_AVALIACOES = 20
#: 09/11/2026: dezenas de itens com exatamente 1.000 avaliacoes e nenhum acima,
#: todos com `truncado = false`. A `get_comment` da Shopee para em 1.000: daí
#: em diante a contagem e' piso, mesmo sem a marca da coleta.
# shortcut: teto inferido dos dados; tirar quando a coleta marcar `truncado` nesse caso.
TETO_API_SHOPEE = 1000
#: A DAG roda uma vez por dia: mais de 2 dias sem varrer = dado velho.
LIMITE_FRESCOR = timedelta(days=2)

#: 09/11/2026: `respondida = false` nas 72.119 avaliacoes, quase certamente campo
#: nao coletado. Nenhuma respondida no recorte = nao medido (None), nunca 0%.
# shortcut: inferido dos dados; tirar quando a conferencia no Seller Centre confirmar a coleta.
MOTIVO_SEM_RESPOSTAS = "Respostas da loja: ainda não coletadas."

MOTIVO_SEM_VIEW = "Aguardando a primeira coleta de avaliações (DAG shopee_product_comments)."
MOTIVO_NAO_VARRIDA = "Ainda não varrida: entra no próximo carregamento."
MOTIVO_SEM_APP = "Sem app da Shopee: as avaliações não chegam por API."

SQL_EXISTE = "SELECT to_regclass('raw.vw_shopee_product_rating') IS NOT NULL AS existe"

SQL_MARCAS = """
SELECT brand AS marca,
       COUNT(*) AS itens,
       SUM(avaliacoes) AS avaliacoes,
       SUM(com_nota) AS com_nota,
       SUM(nota_media * com_nota) AS soma_notas,
       SUM(avaliacoes_1a3) AS avaliacoes_1a3,
       SUM(respondidas) AS respondidas,
       BOOL_OR(truncado OR avaliacoes >= :teto) AS truncado,
       MAX(varrido_em) AS varrido_em,
       MAX(completa_em) AS completa_em
  FROM raw.vw_shopee_product_rating
 WHERE brand = ANY(:marcas)
 GROUP BY brand
"""

SQL_PRODUTOS = """
SELECT r.brand AS marca, r.item_id::text AS item_id, p.item_name AS nome,
       r.avaliacoes, r.com_nota, r.nota_media, r.avaliacoes_1a3,
       (r.truncado OR r.avaliacoes >= :teto) AS truncado
  FROM raw.vw_shopee_product_rating r
  LEFT JOIN raw.shopee_products p ON p.brand = r.brand AND p.item_id::text = r.item_id::text
 WHERE r.brand = ANY(:marcas)
   AND r.com_nota >= :minimo
"""


def _razao(num: Optional[float], den: Optional[int], casas: int, escala: float = 100.0) -> Optional[float]:
    if num is None or not den:
        return None
    return round(num / den * escala, casas)


def _agregar(marca: str, *, itens, avaliacoes, com_nota, soma_notas, um_a_tres, respondidas,
             truncado: bool, varrido_em: Optional[datetime]) -> AvaliacoesMarca:
    return AvaliacoesMarca(
        marca=marca, estado="dado", itens=itens, avaliacoes=avaliacoes, com_nota=com_nota,
        nota_media=_razao(soma_notas, com_nota, 2, escala=1.0),
        pct_1a3=_razao(um_a_tres, com_nota, 1),
        pct_respondidas=_razao(respondidas, avaliacoes, 1),
        truncado=truncado, varrido_em=varrido_em,
    )


def _float(v: Any) -> Optional[float]:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _resposta(agora: datetime, estado: str, marcas: list[AvaliacoesMarca], **kw) -> CxAvaliacoesResponse:
    return CxAvaliacoesResponse(gerado_em=agora, estado=estado, fonte=FONTE,
                                minimo_avaliacoes=MINIMO_AVALIACOES, marcas=marcas, **kw)


def montar_avaliacoes(*, brands: Optional[list[str]] = None, consultar: Optional[Consultar] = None,
                      agora: Optional[datetime] = None) -> CxAvaliacoesResponse:
    agora = agora or datetime.now(timezone.utc)
    consultar = consultar or consultar_datamart
    selecionadas = [m for m in MARCAS_PERMITIDAS if brands is None or m in brands]
    com_app = [m for m in selecionadas if m in SHOPEE_MARCAS]

    def sem(m: str, motivo: str) -> AvaliacoesMarca:
        return AvaliacoesMarca(marca=m, estado="sem_fonte", motivo=motivo)

    # marca sem app (Kokeshi) nunca e' consultada: sem fonte com motivo
    fora_do_app = {m: sem(m, MOTIVO_SEM_APP) for m in selecionadas if m not in SHOPEE_MARCAS}
    if not com_app:
        return _resposta(agora, "sem_fonte", list(fora_do_app.values()), motivo_indisponivel=MOTIVO_SEM_APP)

    existe = _rodar(consultar, "avaliacoes_existe", SQL_EXISTE, {})
    if existe is None:
        return _resposta(agora, "erro", [], motivo_indisponivel=MOTIVO_ERRO)
    if not (existe and existe[0].get("existe")):
        return _resposta(agora, "sem_fonte", [sem(m, MOTIVO_SEM_VIEW) for m in com_app] + list(fora_do_app.values()),
                         motivo_indisponivel=MOTIVO_SEM_VIEW)

    params = {"marcas": com_app, "teto": TETO_API_SHOPEE}
    por_marca = _rodar(consultar, "avaliacoes_marcas", SQL_MARCAS, params)
    produtos = _rodar(consultar, "avaliacoes_produtos", SQL_PRODUTOS, {**params, "minimo": MINIMO_AVALIACOES})
    if por_marca is None or produtos is None:
        return _resposta(agora, "erro", [], motivo_indisponivel=MOTIVO_ERRO)

    linhas = {str(r.get("marca")): r for r in por_marca}
    completas: list[datetime] = []
    marcas: list[AvaliacoesMarca] = []
    for m in selecionadas:
        if m in fora_do_app:
            marcas.append(fora_do_app[m])
            continue
        r = linhas.get(m)
        if r is None:
            marcas.append(sem(m, MOTIVO_NAO_VARRIDA))
            continue
        completa = _utc(r.get("completa_em"))
        if completa:
            completas.append(completa)
        marcas.append(_agregar(
            m, itens=_int(r.get("itens")), avaliacoes=_int(r.get("avaliacoes")), com_nota=_int(r.get("com_nota")),
            soma_notas=_float(r.get("soma_notas")), um_a_tres=_int(r.get("avaliacoes_1a3")),
            respondidas=_int(r.get("respondidas")), truncado=bool(r.get("truncado")),
            varrido_em=_utc(r.get("varrido_em")),
        ))

    com_dado = [x for x in marcas if x.estado == "dado"]
    if not com_dado:
        return _resposta(agora, "sem_fonte", marcas, motivo_indisponivel=MOTIVO_NAO_VARRIDA)
    respostas_medidas = any((_int(linhas[x.marca].get("respondidas")) or 0) > 0 for x in com_dado)
    if not respostas_medidas:
        marcas = [x.model_copy(update={"pct_respondidas": None}) if x.estado == "dado" else x for x in marcas]
        com_dado = [x for x in marcas if x.estado == "dado"]

    def soma(campo: str):
        vals = [getattr(x, campo) for x in com_dado if getattr(x, campo) is not None]
        return sum(vals) if vals else None

    # nota do total pela soma das notas de cada marca (nota x com_nota), nao pela media das medias
    soma_notas = sum(_float(linhas[x.marca].get("soma_notas")) or 0.0 for x in com_dado)
    varridos = [x.varrido_em for x in com_dado if x.varrido_em]
    total = _agregar(
        "total", itens=soma("itens"), avaliacoes=soma("avaliacoes"), com_nota=soma("com_nota"),
        soma_notas=soma_notas, um_a_tres=sum(_int(linhas[x.marca].get("avaliacoes_1a3")) or 0 for x in com_dado),
        respondidas=sum(_int(linhas[x.marca].get("respondidas")) or 0 for x in com_dado),
        truncado=any(x.truncado for x in com_dado), varrido_em=max(varridos) if varridos else None,
    )
    if not respostas_medidas:
        total = total.model_copy(update={"pct_respondidas": None})
    velhas = [x for x in com_dado if x.varrido_em is None or agora - x.varrido_em > LIMITE_FRESCOR]
    aviso = None
    if velhas:
        nomes = ", ".join(_rotulo_marca(x.marca) for x in velhas)
        aviso = f"Sem varredura há mais de 2 dias: {nomes}."

    itens = [
        AvaliacoesProduto(
            marca=str(p.get("marca")), item_id=str(p.get("item_id")), nome=p.get("nome") or None,
            avaliacoes=_int(p.get("avaliacoes")) or 0, com_nota=_int(p.get("com_nota")) or 0,
            nota_media=_float(p.get("nota_media")), avaliacoes_1a3=_int(p.get("avaliacoes_1a3")) or 0,
            pct_1a3=_razao(_int(p.get("avaliacoes_1a3")), _int(p.get("com_nota")), 1),
            truncado=bool(p.get("truncado")),
        )
        for p in produtos
    ]
    itens.sort(key=lambda p: (p.nota_media if p.nota_media is not None else 9, -p.avaliacoes_1a3))
    return _resposta(
        agora, "dado", marcas, total=total, produtos=itens,
        varrido_em=max(varridos) if varridos else None,
        completa_em=max(completas) if completas else None, aviso_frescor=aviso,
        respostas_medidas=respostas_medidas,
    )
