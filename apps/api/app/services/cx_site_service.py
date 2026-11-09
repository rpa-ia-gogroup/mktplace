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

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from app.schemas.account_performance import MarcaFora
from app.schemas.cx_atendimento import Janela, SemComparacao
from app.schemas.cx_site import (
    BlocoNps,
    BlocoReenvio,
    BlocoReviews,
    CxSiteResponse,
    NpsMarca,
    PontoNps,
    PontoReviews,
    PontoSafra,
    ReenvioMarca,
    ReviewsMarca,
    ReviewsProduto,
)
from app.services.cx_atendimento_service import (
    MARCAS_PERMITIDAS,
    MOTIVO_ERRO,
    SEM_FONTE_ERRO,
    Consultar,
    _dia,
    _rodar,
    _rodar_juntas,
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


# ---------------------------------------------------------------------------
# API-3 (09/11/2026): periodo anterior e serie
# ---------------------------------------------------------------------------
#: Primeiro dia da fonte `cx_nps` em todas as marcas da Torre (medido em 08/11/2026;
#: a `base_nps` antiga parou em 31/08). Janela anterior antes disso = sem medida.
NPS_DESDE = date(2026, 8, 28)

SQL_NPS_DIA = """
SELECT respondido_dia_brt AS dia,
       COUNT(*) AS respostas,
       COUNT(*) FILTER (WHERE rating >= 9) AS promotores,
       COUNT(*) FILTER (WHERE rating <= 6) AS detratores
  FROM gold.fct_nps_respostas_gobeaute
 WHERE fonte = 'cx_nps'
   AND marca_slug = ANY(:marcas)
   AND rating IS NOT NULL
   AND respondido_dia_brt >= :inicio
   AND respondido_dia_brt <= :fim
 GROUP BY 1
"""

SQL_REVIEWS_DIA = """
SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       COUNT(*) AS reviews,
       COUNT(*) FILTER (WHERE rating <= 3) AS baixas
  FROM silver.fct_judgeme_reviews
 WHERE brand = ANY(:marcas)
   AND COALESCE(curated, '') <> 'spam'
   AND rating IS NOT NULL
   AND created_at >= :inicio_ts
   AND created_at < :fim_ts
 GROUP BY 1
"""

# Mesmas regras de `SQL_REENVIO` / `SQL_FATURAMENTO_SITE`, por safra (mes).
SQL_REENVIO_SAFRA = """
WITH r AS (
    SELECT translate(lower(marca), 'áàâãéêíóôõúç''', 'aaaaeeiooouc') AS marca,
           date_trunc('month', data_pedido_original_coorte)::date AS safra,
           tipo,
           valor_nf_tratado AS valor
      FROM gold.fct_reenvio_reembolso_gobeaute
     WHERE tipo IN ('REENVIO', 'REEMBOLSO')
       AND data_pedido_original_coorte >= :safra_inicio
       AND data_pedido_original_coorte <= :safra_fim
)
SELECT marca, safra,
       COUNT(*) AS linhas,
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'REENVIO'), 0) AS valor_reenvio,
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'REEMBOLSO'), 0) AS valor_reembolso
  FROM r
 WHERE marca = ANY(:marcas)
 GROUP BY 1, 2
"""

SQL_FATURAMENTO_SAFRA = """
SELECT marca, date_trunc('month', data_mes)::date AS safra, SUM(receita_total) AS faturamento
  FROM gold.agg_gobeaute_base_vendas
 WHERE canal = 'ecommerce'
   AND tipo_operacao = 'normal'
   AND marca = ANY(:marcas)
   AND data_mes >= :safra_inicio
   AND data_mes <= :safra_fim
 GROUP BY 1, 2
"""


def _meses_antes(inicio: date, n: int) -> tuple[date, date]:
    """As `n` safras (meses) imediatamente antes de `inicio` (dia 1)."""
    fim = inicio - timedelta(days=1)
    ini = fim.replace(day=1)
    for _ in range(n - 1):
        ini = (ini - timedelta(days=1)).replace(day=1)
    return ini, fim


def _n_safras(janela: Janela) -> int:
    return max(janela.dias // 30, 1)


def _dias(janela: Janela):
    return [janela.inicio + timedelta(days=i) for i in range(janela.dias)]


def _dia_carga(bloco) -> Optional[date]:
    """Carga parada: o ultimo dia medido e' o da carga (BRT). Em dia: sem corte."""
    if not bloco.aviso_frescor or bloco.atualizado_em is None:
        return None
    return bloco.atualizado_em.astimezone(TZ_OPERACIONAL).date()


def _sem_carga_parada(bloco) -> SemComparacao:
    dia = _dia_carga(bloco)
    return SemComparacao(motivo=f"carga parada desde {dia.strftime('%d/%m')}" if dia else "carga parada",
                         a_partir_de=None, detalhe=bloco.aviso_frescor)


def _comparar_nps(bloco: BlocoNps, linhas: Optional[list[dict]], janela: Janela,
                  anterior: Janela) -> BlocoNps:
    if bloco.estado != "dado":
        return bloco
    if linhas is None:
        return bloco.model_copy(update={"sem_anterior": SEM_FONTE_ERRO})
    por_dia = {_dia(l.get("dia")): l for l in linhas}
    corte = _dia_carga(bloco)

    def soma(dias) -> tuple[float, float, float]:
        ls = [por_dia[d] for d in dias if d in por_dia]
        return tuple(sum(_num(l.get(k)) for l in ls) for k in ("respostas", "promotores", "detratores"))

    serie = []
    for d in _dias(janela):
        if d < NPS_DESDE or (corte and d > corte):
            serie.append(PontoNps(dia=d))
            continue
        n, prom, detr = soma([d])
        serie.append(PontoNps(dia=d, respostas=int(n), promotores=int(prom), detratores=int(detr),
                              nps=round((prom - detr) / n * 100, 1) if n else None))
    upd: dict[str, Any] = {"serie": serie}
    if anterior.inicio < NPS_DESDE:
        upd["sem_anterior"] = SemComparacao(
            motivo=f"nps desde {NPS_DESDE.strftime('%d/%m')}",
            a_partir_de=NPS_DESDE + timedelta(days=2 * janela.dias),
            detalhe="A fonte de NPS (cx_nps) começa em 28/08/2026: o período anterior ainda não está coberto.")
    elif corte:
        upd["sem_anterior"] = _sem_carga_parada(bloco)
    else:
        n, prom, detr = soma(_dias(anterior))
        if n:
            upd.update(respostas_anterior=int(n), nps_anterior=round((prom - detr) / n * 100, 1),
                       promotores_pct_anterior=_pct(prom, n), detratores_pct_anterior=_pct(detr, n))
        else:
            upd["sem_anterior"] = SemComparacao(motivo="sem respostas", a_partir_de=None,
                                                detalhe="Nenhuma resposta de NPS no período anterior.")
    return bloco.model_copy(update=upd)


def _comparar_reviews(bloco: BlocoReviews, linhas: Optional[list[dict]], janela: Janela,
                      anterior: Janela) -> BlocoReviews:
    if bloco.estado != "dado":
        return bloco
    if linhas is None:
        return bloco.model_copy(update={"sem_anterior": SEM_FONTE_ERRO})
    por_dia = {_dia(l.get("dia")): l for l in linhas}
    corte = _dia_carga(bloco)

    def soma(dias) -> tuple[int, int]:
        ls = [por_dia[d] for d in dias if d in por_dia]
        return int(sum(_num(l.get("reviews")) for l in ls)), int(sum(_num(l.get("baixas")) for l in ls))

    serie = []
    for d in _dias(janela):
        if corte and d > corte:
            serie.append(PontoReviews(dia=d))  # depois da carga: nao medido
            continue
        n, baixas = soma([d])
        serie.append(PontoReviews(dia=d, reviews=n, baixas=baixas, baixas_pct=_pct(baixas, n)))
    upd: dict[str, Any] = {"serie": serie}
    if corte:  # periodo atual incompleto: delta seria falso
        upd["sem_anterior"] = _sem_carga_parada(bloco)
    else:
        n, baixas = soma(_dias(anterior))
        if n:
            upd.update(reviews_anterior=n, baixas_pct_anterior=_pct(baixas, n))
        else:
            upd["sem_anterior"] = SemComparacao(motivo="sem reviews", a_partir_de=None,
                                                detalhe="Nenhuma review no período anterior.")
    return bloco.model_copy(update=upd)


def _comparar_reenvio(bloco: BlocoReenvio, linhas: Optional[list[dict]], fat: Optional[list[dict]],
                      safras_ant: tuple[date, date]) -> BlocoReenvio:
    upd: dict[str, Any] = {"safra_anterior_inicio": safras_ant[0], "safra_anterior_fim": safras_ant[1]}
    if bloco.estado != "dado":
        return bloco.model_copy(update=upd)
    if linhas is None or fat is None:
        return bloco.model_copy(update={**upd, "sem_anterior": SEM_FONTE_ERRO})
    reenv = {(str(l["marca"]), _dia(l.get("safra"))): l for l in linhas if int(l.get("linhas") or 0) > 0}
    fat_m = {(str(l["marca"]), _dia(l.get("safra"))): _num(l.get("faturamento"))
             for l in fat if _num(l.get("faturamento")) > 0}
    # o mesmo recorte da taxa atual: marcas com reenvio/reembolso E faturamento
    recorte = {m.marca for m in bloco.marcas if m.faturamento}

    def taxas(meses: list[date]) -> tuple[Optional[float], Optional[float]]:
        """None se alguma marca do recorte nao tiver dado nesses meses (serie parcial)."""
        if not recorte:
            return None, None
        com = {m for m in recorte if any((m, s) in reenv for s in meses)
               and any((m, s) in fat_m for s in meses)}
        if com != recorte:
            return None, None
        den = sum(fat_m.get((m, s), 0) for m in recorte for s in meses)
        num = [sum(_num(reenv.get((m, s), {}).get(k)) for m in recorte for s in meses)
               for k in ("valor_reenvio", "valor_reembolso")]
        return _pct(num[0], den), _pct(num[1], den)

    meses, s = [], safras_ant[0]
    while s <= bloco.safra_fim:
        meses.append(s)
        s = (s + timedelta(days=32)).replace(day=1)
    serie = [PontoSafra(safra=m, **dict(zip(("taxa_reenvio_pct", "taxa_reembolso_pct"), taxas([m]))))
             for m in meses]
    ant = taxas([m for m in meses if m <= safras_ant[1]])
    if ant[0] is None:
        return bloco.model_copy(update={**upd, "serie": serie, "sem_anterior": SemComparacao(
            motivo="safra anterior incompleta", a_partir_de=None,
            detalhe="Alguma marca do recorte não tem reenvio/reembolso ou faturamento nas safras anteriores.")})
    return bloco.model_copy(update={**upd, "serie": serie, "taxa_reenvio_pct_anterior": ant[0],
                                    "taxa_reembolso_pct_anterior": ant[1]})


def _tarefas_site(consultar: Consultar, marcas: list[str], janela: Janela, anterior: Janela,
                  safras_ant: tuple[date, date], safra_fim: date) -> dict:
    reviews = [m for m in marcas if m not in FORA_REVIEWS]
    reenvio = [m for m in marcas if m not in FORA_REENVIO]
    t = {"site_nps_dia": (consultar, SQL_NPS_DIA, {"marcas": marcas, "inicio": anterior.inicio, "fim": janela.fim})}
    if reviews:
        t["site_reviews_dia"] = (consultar, SQL_REVIEWS_DIA, {
            "marcas": reviews,
            "inicio_ts": datetime.combine(anterior.inicio, time(), TZ_OPERACIONAL),
            "fim_ts": datetime.combine(janela.fim + timedelta(days=1), time(), TZ_OPERACIONAL)})
    if reenvio:
        p = {"marcas": reenvio, "safra_inicio": safras_ant[0], "safra_fim": safra_fim}
        t["site_reenvio_safra"] = (consultar, SQL_REENVIO_SAFRA, p)
        t["site_faturamento_safra"] = (consultar, SQL_FATURAMENTO_SAFRA, p)
    return t


def montar_cx_site(*, brands: Optional[list[str]] = None, dias: int = JANELA_PADRAO_DIAS,
                   consultar: Optional[Consultar] = None,
                   agora: Optional[datetime] = None) -> CxSiteResponse:
    consultar = consultar or consultar_datamart
    agora = agora or datetime.now(timezone.utc)
    marcas = list(brands) if brands else list(MARCAS_PERMITIDAS)
    janela = calcular_janela(dias, agora)
    anterior = Janela(inicio=janela.inicio - timedelta(days=dias), fim=janela.inicio - timedelta(days=1), dias=dias)
    safra_inicio, safra_fim = calcular_safra(janela)
    safras_ant = _meses_antes(safra_inicio, _n_safras(janela))
    # API-3: as consultas da comparacao correm em paralelo com as dos blocos
    with ThreadPoolExecutor(max_workers=1) as pool:
        futuro = pool.submit(_rodar_juntas, _tarefas_site(consultar, marcas, janela, anterior, safras_ant, safra_fim))
        nps = _bloco_nps(consultar, marcas, janela, agora)
        reenvio = _bloco_reenvio(consultar, marcas, janela, agora)
        reviews = _bloco_reviews(consultar, marcas, janela, agora)
        res = futuro.result()
    return CxSiteResponse(
        gerado_em=agora, janela=janela, janela_anterior=anterior,
        nps=_comparar_nps(nps, res.get("site_nps_dia"), janela, anterior),
        reenvio_reembolso=_comparar_reenvio(reenvio, res.get("site_reenvio_safra"),
                                            res.get("site_faturamento_safra"), safras_ant),
        reviews=_comparar_reviews(reviews, res.get("site_reviews_dia"), janela, anterior),
    )
