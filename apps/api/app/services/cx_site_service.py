"""CX do site (DTC) — `GET /api/v1/cx/site`.

Le o Data Mart direto (mesma leitura da aba CX, `consultar_datamart`), sem
ingestao nova e sem credencial nova:

  NPS               gold.fct_nps_respostas_gobeaute   fonte `cx_nps` (a `base_nps` parou em 31/08/2026)
  Reenvio/reembolso gold.fct_reenvio_reembolso_gobeaute  safra = mes do pedido original
  Faturamento site  gold.agg_gobeaute_base_vendas     canal `ecommerce`, operacao `normal` (por NF, mensal)
  Reviews           silver.fct_judgeme_reviews        sem `curated = 'spam'`

DEFINICOES (todas "calculo Torre", realizado bruto)
---------------------------------------------------
* NPS = % promotores (9-10) - % detratores (0-6), respostas do dia BRT na janela.
* Taxa de reenvio/reembolso = valor da NF dos pedidos com reenvio (ou
  reembolso) / receita do e-commerce da marca, nas mesmas safras. NAO aplica a
  regra oficial do Vision (`fn_rr_conta_indicador`): nao bate com o Vision CX.
  Safra = meses FECHADOS: 30 dias -> o ultimo mes fechado; 90 -> os 3 ultimos.
* Reviews: media e % de 1-3 estrelas por produto; ranking so' com produtos
  que tenham `MINIMO_REVIEWS` na janela.

FRESCOR: cada bloco le' `max(_loaded_at)` da tabela inteira, fora da janela.
Carga parada ha' mais de `LIMITE_FRESCOR_HORAS` ganha aviso; sem linhas na
janela E carga parada vira `sem_fonte` (nunca "zero reviews").

Sem PII: nenhuma consulta seleciona nome, e-mail, pedido ou comentario.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from app.schemas.account_performance import MarcaFora
from app.schemas.cx_atendimento import Janela
from app.schemas.cx_site import (
    BlocoNps,
    BlocoReenvio,
    BlocoReviews,
    CxSiteResponse,
    NpsMarca,
    ReenvioMarca,
    ReviewsMarca,
    ReviewsProduto,
)
from app.services.cx_atendimento_service import (
    MARCAS_PERMITIDAS,
    MOTIVO_ERRO,
    Consultar,
    _rodar,
    _utc,
    calcular_janela,
    consultar_datamart,
)
from app.services.gold_service import TZ_OPERACIONAL

JANELA_PADRAO_DIAS = 30
LIMITE_FRESCOR_HORAS = 48.0
MINIMO_REVIEWS = 10
TOP_PRODUTOS = 5

FONTE_NPS = "Data Mart · gold.fct_nps_respostas_gobeaute (cx_nps)"
FONTE_REENVIO = "Data Mart · gold.fct_reenvio_reembolso_gobeaute + gold.agg_gobeaute_base_vendas"
FONTE_REVIEWS = "Data Mart · silver.fct_judgeme_reviews (Judge.me)"

#: Marcas sem dado em cada fonte, com o motivo que aparece na tela.
FORA_REENVIO = {"apice": "Ápice não aparece na base de reenvio/reembolso do CX."}
FORA_REVIEWS = {"rituaria": "Rituária usa Konfidency, que não está no Data Mart."}

MOTIVO_SEM_FATURAMENTO = "Taxa indisponível: faturamento do site não carregou."

# ---------------------------------------------------------------------------
# SQL (somente leitura; parametros nomeados)
# ---------------------------------------------------------------------------
SQL_NPS = """
SELECT marca_slug AS marca,
       COUNT(*) AS respostas,
       COUNT(*) FILTER (WHERE rating >= 9) AS promotores,
       COUNT(*) FILTER (WHERE rating <= 6) AS detratores
  FROM gold.fct_nps_respostas_gobeaute
 WHERE fonte = 'cx_nps'
   AND marca_slug = ANY(:marcas)
   AND rating IS NOT NULL
   AND respondido_dia_brt >= :inicio
   AND respondido_dia_brt <= :fim
 GROUP BY marca_slug
"""

SQL_NPS_CARGA = """
SELECT MAX(_loaded_at) AS carregado_em
  FROM gold.fct_nps_respostas_gobeaute
 WHERE fonte = 'cx_nps'
"""

# `marca` vem com acento e apostrofo ("Barbour's", "Rituária"): vira a chave da Torre.
SQL_REENVIO = """
WITH r AS (
    SELECT translate(lower(marca), 'áàâãéêíóôõúç''', 'aaaaeeiooouc') AS marca,
           tipo,
           valor_nf_tratado AS valor
      FROM gold.fct_reenvio_reembolso_gobeaute
     WHERE tipo IN ('REENVIO', 'REEMBOLSO')
       AND data_pedido_original_coorte >= :safra_inicio
       AND data_pedido_original_coorte <= :safra_fim
)
SELECT marca,
       COUNT(*) FILTER (WHERE tipo = 'REENVIO') AS reenvios,
       COUNT(*) FILTER (WHERE tipo = 'REEMBOLSO') AS reembolsos,
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'REENVIO'), 0) AS valor_reenvio,
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'REEMBOLSO'), 0) AS valor_reembolso,
       COUNT(*) FILTER (WHERE valor IS NULL) AS sem_valor
  FROM r
 WHERE marca = ANY(:marcas)
 GROUP BY marca
"""

SQL_REENVIO_CARGA = """
SELECT MAX(_loaded_at) AS carregado_em
  FROM gold.fct_reenvio_reembolso_gobeaute
"""

SQL_FATURAMENTO_SITE = """
SELECT marca, SUM(receita_total) AS faturamento
  FROM gold.agg_gobeaute_base_vendas
 WHERE canal = 'ecommerce'
   AND tipo_operacao = 'normal'
   AND marca = ANY(:marcas)
   AND data_mes >= :safra_inicio
   AND data_mes <= :safra_fim
 GROUP BY marca
"""

SQL_REVIEWS = r"""
SELECT brand AS marca,
       product_external_id AS produto_id,
       MAX(product_title) AS produto,
       COUNT(*) AS reviews,
       SUM(rating) AS soma,
       COUNT(*) FILTER (WHERE rating <= 3) AS baixas,
       -- Brinde nao tem campo: a loja marca no titulo ou no handle.
       -- Titulo com mais brinde e produto pago que leva brinde, entao fica.
       BOOL_OR((product_title ~* '\mbrinde\M' AND product_title !~* '\+\s*brinde')
               OR product_handle ~* '(^brinde-|-brinde$|freegift)') AS brinde
  FROM silver.fct_judgeme_reviews
 WHERE brand = ANY(:marcas)
   AND COALESCE(curated, '') <> 'spam'
   AND rating IS NOT NULL
   AND created_at >= :inicio_ts
   AND created_at < :fim_ts
 GROUP BY brand, product_external_id
"""

SQL_REVIEWS_CARGA = """
SELECT MAX(_loaded_at) AS carregado_em, MAX(created_at) AS ultima_review_em
  FROM silver.fct_judgeme_reviews
 WHERE brand = ANY(:marcas)
"""


# ---------------------------------------------------------------------------
# Auxiliares
# ---------------------------------------------------------------------------
def calcular_safra(janela: Janela) -> tuple[date, date]:
    """Meses fechados ate' o fim da janela: 30 dias -> 1 mes, 90 -> 3."""
    fim = (janela.fim + timedelta(days=1)).replace(day=1) - timedelta(days=1)
    inicio = fim.replace(day=1)
    for _ in range(max(janela.dias // 30, 1) - 1):
        inicio = (inicio - timedelta(days=1)).replace(day=1)
    return inicio, fim


def _num(v: Any) -> float:
    return float(v or 0)


def _pct(num: float, den: float) -> Optional[float]:
    return round(num / den * 100, 2) if den else None


def _cobertura(marcas: list[str], fora: dict[str, str]) -> tuple[list[str], list[MarcaFora]]:
    return ([m for m in marcas if m not in fora],
            [MarcaFora(marca=m, motivo=fora[m]) for m in marcas if m in fora])


def _carga(consultar: Consultar, nome: str, sql: str, params: dict, agora: datetime
           ) -> tuple[Optional[datetime], Optional[str], Optional[dict]]:
    """(ultima carga, aviso de frescor, linha crua). Falha aqui nao derruba o bloco."""
    linhas = _rodar(consultar, nome, sql, params)
    linha = (linhas or [{}])[0]
    carga = _utc(linha.get("carregado_em"))
    if carga is None:
        return None, None, linha
    horas = (agora - carga).total_seconds() / 3600
    if horas <= LIMITE_FRESCOR_HORAS:
        return carga, None, linha
    dia = carga.astimezone(TZ_OPERACIONAL).strftime("%d/%m")
    return carga, f"Carga parada desde {dia} ({horas / 24:.0f} dias): o que veio depois não aparece.", linha


def _estado_vazio(aviso: Optional[str], motivo_vazio: str) -> tuple[str, str]:
    """Sem linhas na janela: carga parada = sem fonte; carga em dia = vazio de verdade."""
    return ("sem_fonte", aviso) if aviso else ("vazio_legitimo", motivo_vazio)


# ---------------------------------------------------------------------------
# Blocos
# ---------------------------------------------------------------------------
def _bloco_nps(consultar: Consultar, marcas: list[str], janela: Janela, agora: datetime) -> BlocoNps:
    carga, aviso, _ = _carga(consultar, "site_nps_carga", SQL_NPS_CARGA, {}, agora)
    base = dict(fonte=FONTE_NPS, atualizado_em=carga, aviso_frescor=aviso)
    linhas = _rodar(consultar, "site_nps", SQL_NPS,
                    {"marcas": marcas, "inicio": janela.inicio, "fim": janela.fim})
    if linhas is None:
        return BlocoNps(estado="erro", motivo_indisponivel=MOTIVO_ERRO, **base)
    itens = [l for l in linhas if int(l.get("respostas") or 0) > 0]
    if not itens:
        estado, motivo = _estado_vazio(aviso, "Nenhuma resposta de NPS no período.")
        return BlocoNps(estado=estado, motivo_indisponivel=motivo, **base)

    def nps(prom: float, detr: float, n: float) -> float:
        return round((prom - detr) / n * 100, 1)

    por_marca = sorted(
        (NpsMarca(marca=l["marca"], respostas=int(l["respostas"]),
                  nps=nps(_num(l["promotores"]), _num(l["detratores"]), _num(l["respostas"])),
                  promotores_pct=_pct(_num(l["promotores"]), _num(l["respostas"])),
                  detratores_pct=_pct(_num(l["detratores"]), _num(l["respostas"])))
         for l in itens),
        key=lambda m: m.nps,
    )
    n = sum(_num(l["respostas"]) for l in itens)
    prom = sum(_num(l["promotores"]) for l in itens)
    detr = sum(_num(l["detratores"]) for l in itens)
    return BlocoNps(
        estado="dado", respostas=int(n), nps=nps(prom, detr, n),
        promotores_pct=_pct(prom, n), detratores_pct=_pct(detr, n),
        neutros_pct=_pct(n - prom - detr, n), marcas=por_marca, **base,
    )


def _bloco_reenvio(consultar: Consultar, marcas: list[str], janela: Janela, agora: datetime) -> BlocoReenvio:
    safra_inicio, safra_fim = calcular_safra(janela)
    dentro, fora = _cobertura(marcas, FORA_REENVIO)
    base = dict(fonte=FONTE_REENVIO, safra_inicio=safra_inicio, safra_fim=safra_fim, fora=fora)
    if not dentro:
        return BlocoReenvio(estado="sem_fonte", motivo_indisponivel=fora[0].motivo, **base)
    carga, aviso, _ = _carga(consultar, "site_reenvio_carga", SQL_REENVIO_CARGA, {}, agora)
    base.update(atualizado_em=carga, aviso_frescor=aviso)
    params = {"marcas": dentro, "safra_inicio": safra_inicio, "safra_fim": safra_fim}
    linhas = _rodar(consultar, "site_reenvio", SQL_REENVIO, params)
    if linhas is None:
        return BlocoReenvio(estado="erro", motivo_indisponivel=MOTIVO_ERRO, **base)
    itens = [l for l in linhas if int(l.get("reenvios") or 0) + int(l.get("reembolsos") or 0) > 0]
    if not itens:
        estado, motivo = _estado_vazio(aviso, "Nenhum reenvio ou reembolso nas safras.")
        return BlocoReenvio(estado=estado, motivo_indisponivel=motivo, **base)

    fat_linhas = _rodar(consultar, "site_faturamento", SQL_FATURAMENTO_SITE, params)
    fat = {l["marca"]: _num(l["faturamento"]) for l in (fat_linhas or []) if _num(l.get("faturamento")) > 0}
    por_marca = [
        ReenvioMarca(
            marca=l["marca"], reenvios=int(l["reenvios"] or 0), reembolsos=int(l["reembolsos"] or 0),
            valor_reenvio=_num(l["valor_reenvio"]), valor_reembolso=_num(l["valor_reembolso"]),
            sem_valor=int(l["sem_valor"] or 0), faturamento=fat.get(l["marca"]),
            taxa_reenvio_pct=_pct(_num(l["valor_reenvio"]), fat.get(l["marca"], 0)),
            taxa_reembolso_pct=_pct(_num(l["valor_reembolso"]), fat.get(l["marca"], 0)),
        )
        for l in sorted(itens, key=lambda l: l["marca"])
    ]
    # Taxa total so' com as marcas que tem faturamento (numerador e denominador iguais).
    com_fat = [m for m in por_marca if m.faturamento]
    den = sum(m.faturamento for m in com_fat)
    return BlocoReenvio(
        estado="dado",
        reenvios=sum(m.reenvios for m in por_marca), reembolsos=sum(m.reembolsos for m in por_marca),
        valor_reenvio=sum(m.valor_reenvio for m in por_marca),
        valor_reembolso=sum(m.valor_reembolso for m in por_marca),
        sem_valor=sum(m.sem_valor for m in por_marca),
        taxa_reenvio_pct=_pct(sum(m.valor_reenvio for m in com_fat), den),
        taxa_reembolso_pct=_pct(sum(m.valor_reembolso for m in com_fat), den),
        motivo_sem_taxa=None if den else MOTIVO_SEM_FATURAMENTO,
        marcas=por_marca, **base,
    )


def _bloco_reviews(consultar: Consultar, marcas: list[str], janela: Janela, agora: datetime) -> BlocoReviews:
    dentro, fora = _cobertura(marcas, FORA_REVIEWS)
    base = dict(fonte=FONTE_REVIEWS, minimo_reviews=MINIMO_REVIEWS, fora=fora)
    if not dentro:
        return BlocoReviews(estado="sem_fonte", motivo_indisponivel=fora[0].motivo, **base)
    carga, aviso, linha = _carga(consultar, "site_reviews_carga", SQL_REVIEWS_CARGA, {"marcas": dentro}, agora)
    base.update(atualizado_em=carga, aviso_frescor=aviso, ultima_review_em=_utc((linha or {}).get("ultima_review_em")))
    inicio_ts = datetime.combine(janela.inicio, time(), TZ_OPERACIONAL)
    fim_ts = datetime.combine(janela.fim + timedelta(days=1), time(), TZ_OPERACIONAL)
    linhas = _rodar(consultar, "site_reviews", SQL_REVIEWS,
                    {"marcas": dentro, "inicio_ts": inicio_ts, "fim_ts": fim_ts})
    if linhas is None:
        return BlocoReviews(estado="erro", motivo_indisponivel=MOTIVO_ERRO, **base)
    itens = [l for l in linhas if int(l.get("reviews") or 0) > 0]
    if not itens:
        estado, motivo = _estado_vazio(aviso, "Nenhuma review no período.")
        return BlocoReviews(estado=estado, motivo_indisponivel=motivo, **base)

    def nota(n: float, soma: float, baixas: float) -> dict:
        return {"reviews": int(n), "media": round(soma / n, 2), "baixas_pct": _pct(baixas, n)}

    soma_marca: dict[str, list[float]] = {}
    for l in itens:
        acc = soma_marca.setdefault(l["marca"], [0.0, 0.0, 0.0])
        acc[0] += _num(l["reviews"]); acc[1] += _num(l["soma"]); acc[2] += _num(l["baixas"])
    por_marca = sorted((ReviewsMarca(marca=m, **nota(*v)) for m, v in soma_marca.items()),
                       key=lambda m: m.media)
    produtos = [
        ReviewsProduto(marca=l["marca"], produto=str(l["produto"]).strip(),
                       **nota(_num(l["reviews"]), _num(l["soma"]), _num(l["baixas"])))
        for l in itens
        if l.get("produto_id") is not None and (l.get("produto") or "").strip()
        and int(l["reviews"]) >= MINIMO_REVIEWS and not l.get("brinde")
    ]
    tot = [sum(v[i] for v in soma_marca.values()) for i in range(3)]
    piores = sorted(produtos, key=lambda p: (p.media, -p.reviews))[:TOP_PRODUTOS]
    # Poucos produtos elegiveis: o mesmo produto nao aparece nas duas listas.
    resto = [p for p in produtos if p not in piores]
    return BlocoReviews(
        estado="dado", **nota(*tot), marcas=por_marca, piores=piores,
        melhores=sorted(resto, key=lambda p: (-p.media, -p.reviews))[:TOP_PRODUTOS],
        **base,
    )


def montar_cx_site(*, brands: Optional[list[str]] = None, dias: int = JANELA_PADRAO_DIAS,
                   consultar: Optional[Consultar] = None,
                   agora: Optional[datetime] = None) -> CxSiteResponse:
    consultar = consultar or consultar_datamart
    agora = agora or datetime.now(timezone.utc)
    marcas = list(brands) if brands else list(MARCAS_PERMITIDAS)
    janela = calcular_janela(dias, agora)
    return CxSiteResponse(
        gerado_em=agora, janela=janela,
        nps=_bloco_nps(consultar, marcas, janela, agora),
        reenvio_reembolso=_bloco_reenvio(consultar, marcas, janela, agora),
        reviews=_bloco_reviews(consultar, marcas, janela, agora),
    )
