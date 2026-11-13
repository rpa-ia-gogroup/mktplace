"""CX-MKT-1 — aba "Atendimento" da Performance das contas.

Contrato: `docs/cx_atendimento_contrato.md` (§3, §6, §7).

LE O DATA MART DIRETO, SEM INGESTAO NOVA
----------------------------------------
Esta fatia usa so' o que o Airflow ja' grava:

  ML      `api.vw_ml_orders`          `cancel_detail` (motivo do cancelamento)
  Shopee  `silver.stg_shopee_orders`  `cancel_by`, `cancel_reason`, `order_status`

O que depende de API nova (fila com prazo, motivo da reclamacao, devolucoes do
ML/TikTok/Shopee) sai como `pendencias`, com motivo. Ausencia nunca vira zero.

Lojas Shopee: `SHOPEE_MARCAS` (fonte unica, Kokeshi inclusa desde T-0114).
Carga parada (mais velha que `LIMITE_FRESCOR_HORAS`) corta a serie no dia da
carga: dia depois dele sai None, nunca 0.

DEFINICOES (todas "calculo Torre")
----------------------------------
* Pedido ML: um por `order_id` (a view pode repetir o pedido; fica a linha mais
  recente). Dia = `date_created` (horario do ML), igual ao resto da Torre.
* Reclamacoes do ML NAO sao contadas aqui. `mediations` do pedido mistura
  tipos (inclui cancelamento pedido pelo comprador) e nao aplica as exclusoes
  da plataforma: medido em 03/11/2026, Kokeshi daria 2,5% contra 0,61% na
  reputacao oficial. A taxa oficial vem do snapshot de reputacao.
* Pedido Shopee: um por linha da Silver (`order_sn`), dia = `created_date_brt`.
  "Pedido nao pago" cancelado pela Shopee nao e' venda nem atendimento: sai do
  denominador e dos motivos, e o volume aparece como `excluidos`.
* Em devolucao (Shopee): pedidos com `order_status = 'to_return'` AGORA, entre
  os criados nos ultimos 90 dias. E' fotografia, nao fluxo da janela.

UMA FONTE CAI, AS OUTRAS SEGUEM
-------------------------------
Cada consulta e' isolada. Excecao vira estado `erro` so' do bloco afetado, com
motivo FIXO: o texto da excecao nunca sai na resposta nem no log (pode carregar
DSN ou SQL).
"""
from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from app.schemas.account_performance import Cobertura, Indicador, MarcaFora
from app.schemas.cx_atendimento import (
    AtendimentoResponse,
    ChatShopee,
    ContaCx,
    CxShopeeResponse,
    DevolucoesShopee,
    LinhaDevolucao,
    NaoLidas,
    BlocoMotivos,
    CanalAtendimento,
    Janela,
    LinhaMarca,
    Motivo,
    Pendencia,
    PontoDiaShopee,
    SemComparacao,
)
from app.services.gold_service import BRAND_LABELS, BRANDS_IN_SCOPE, ML_BRANDS, TZ_OPERACIONAL

logger = logging.getLogger(__name__)

Consultar = Callable[[str, dict], list[dict]]

#: Allowlist do filtro `brands`: o escopo de marcas da Torre.
MARCAS_PERMITIDAS: tuple[str, ...] = tuple(BRANDS_IN_SCOPE)

#: FONTE UNICA das lojas Shopee com app (API): pedidos e cancelamentos
#: (Silver), devolucoes e chat (`shopee_cx_coleta`) e avaliacoes, todos no
#: Data Mart. Performance oficial, avaliacoes e pedidos por motivo importam
#: daqui. A Kokeshi entrou em 11/11/2026 (T-0114): a Silver tem a conta de
#: 31/08 a 13/11 (medido em 13/11, VAL-B2) e o export do bot parou em ~11/11.
SHOPEE_MARCAS: tuple[str, ...] = ("apice", "barbours", "kokeshi", "lescent", "rituaria")
#: Contas cuja Saude da Conta AINDA so' vem do bot do Seller Centre (Neon):
#: `raw.shopee_account_health_*` nao tem a Kokeshi (C1-102). Tirar daqui quando
#: a DAG de health gravar a conta.
SHOPEE_SAUDE_EXPORT: tuple[str, ...] = ("kokeshi",)

JANELA_PADRAO_DIAS = 30
DIAS_FOTOGRAFIA_DEVOLUCAO = 90

#: Publicacao mais velha que isto ganha aviso. O `ml_orders_etl` roda a cada
#: 15 min e o `shopee_orders_etl` a cada 6 h.
LIMITE_FRESCOR_HORAS = {"mercado_livre": 3.0, "shopee": 12.0}

MOTIVO_ERRO = "Fonte indisponível nesta carga. Tente novamente em alguns minutos."

FONTE_ML = "Data Mart · api.vw_ml_orders (ml_orders_etl)"
FONTE_SHOPEE = "Data Mart · silver.stg_shopee_orders (shopee_orders_etl)"

# ---------------------------------------------------------------------------
# Rotulos de motivo. Codigo fora do mapa NUNCA some: sai com o texto da
# plataforma e `mapeado = False`, para o mapa ser corrigido.
# ---------------------------------------------------------------------------

#: `cancel_detail.code` do ML -> (rotulo, natureza). Medido em 03/11/2026.
MOTIVOS_ML: dict[str, tuple[str, str]] = {
    "buyer_cancel_express": ("Comprador cancelou antes do envio", "comprador"),
    "mediations": ("Cancelado por reclamação do comprador", "reclamacao"),
    "shipment_not_delivered": ("Envio não entregue", "logistica"),
    "shipment_operative_issue": ("Problema operacional no envio", "logistica"),
    "pack_splitted": ("Pacote dividido pelo ML", "plataforma"),
    "pack_creation_error": ("Erro do ML ao criar o pacote", "plataforma"),
    "fraud": ("Suspeita de fraude", "plataforma"),
    "unknown": ("Sem causa identificada pelo ML", "plataforma"),
    "fiscal_buyer_forbidden": ("Restrição fiscal do comprador", "plataforma"),
}

#: `cancel_reason` da Shopee (minusculas, sem espaco nas pontas) ->
#: (codigo, rotulo, natureza). Grafias diferentes do mesmo motivo caem no
#: mesmo codigo. Medido em 03/11/2026.
MOTIVOS_SHOPEE: dict[str, tuple[str, str, str]] = {
    "don't want to buy anymore": ("desistiu", "Desistiu da compra", "comprador"),
    "others / change of mind": ("mudou_de_ideia", "Mudou de ideia", "comprador"),
    "others": ("outros_comprador", "Outros motivos do comprador", "comprador"),
    "need to modify order": ("alterar_pedido", "Quer alterar o pedido", "comprador"),
    "modify existing order (colour, size, address, voucher, etc.)":
        ("alterar_pedido", "Quer alterar o pedido", "comprador"),
    "need to input / change voucher code": ("cupom", "Quer usar ou trocar o cupom", "comprador"),
    "found cheaper elsewhere": ("mais_barato", "Achou mais barato em outro lugar", "comprador"),
    "need to change delivery address": ("endereco", "Quer mudar o endereço de entrega", "comprador"),
    "payment procedure too troublesome": ("pagamento", "Achou o pagamento complicado", "comprador"),
    "failed delivery": ("falha_entrega", "Falha na entrega", "logistica"),
    "seller did not ship": ("vendedor_nao_enviou", "Vendedor não enviou no prazo", "vendedor"),
    "out of stock": ("sem_estoque", "Sem estoque", "vendedor"),
}
#: Motivos que comecam com estes prefixos (o texto da Shopee traz frase extra).
PREFIXOS_SHOPEE: tuple[tuple[str, tuple[str, str, str]], ...] = (
    ("parcel lost", ("extravio", "Pacote extraviado no transporte", "logistica")),
)
#: Cancelado por falta de pagamento: nao e' venda nem atendimento.
SHOPEE_NAO_PAGO = "unpaid order"

_NATUREZA_POR_AUTOR = {"buyer": "comprador", "seller": "vendedor"}


def _natureza_do_autor(autor: Any) -> str:
    return _NATUREZA_POR_AUTOR.get(str(autor or "").strip().lower(), "plataforma")


def _slug(texto: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", texto.lower()).strip("_")
    return s[:60] or "sem_codigo"


def rotular_ml(codigo: Any, solicitante: Any) -> tuple[str, str, str, bool]:
    """(codigo, rotulo, natureza, mapeado) de um cancelamento ML."""
    cod = str(codigo or "").strip()
    if not cod:
        return "sem_motivo", "Sem motivo informado", _natureza_do_autor(solicitante), True
    if cod in MOTIVOS_ML:
        rotulo, natureza = MOTIVOS_ML[cod]
        return cod, rotulo, natureza, True
    return cod, cod, _natureza_do_autor(solicitante), False


def rotular_shopee(motivo: Any, autor: Any) -> tuple[str, str, str, bool]:
    """(codigo, rotulo, natureza, mapeado) de um cancelamento Shopee."""
    bruto = str(motivo or "").strip()
    chave = bruto.lower()
    if not chave:
        return "sem_motivo", "Sem motivo informado", _natureza_do_autor(autor), True
    if chave in MOTIVOS_SHOPEE:
        cod, rotulo, natureza = MOTIVOS_SHOPEE[chave]
        return cod, rotulo, natureza, True
    for prefixo, (cod, rotulo, natureza) in PREFIXOS_SHOPEE:
        if chave.startswith(prefixo):
            return cod, rotulo, natureza, True
    return _slug(chave), bruto[:120], _natureza_do_autor(autor), False


# ---------------------------------------------------------------------------
# Janela
# ---------------------------------------------------------------------------
def calcular_janela(dias: int, agora: Optional[datetime] = None) -> Janela:
    """`dias` fechados ate' D-1 no fuso do negocio (o dia corrente e' parcial)."""
    hoje = (agora or datetime.now(timezone.utc)).astimezone(TZ_OPERACIONAL).date()
    fim = hoje - timedelta(days=1)
    return Janela(inicio=fim - timedelta(days=dias - 1), fim=fim, dias=dias)


def _texto_janela(j: Janela) -> str:
    return f"{j.dias} dias fechados ({j.inicio.strftime('%d/%m')} a {j.fim.strftime('%d/%m')})"


# ---------------------------------------------------------------------------
# SQL (somente leitura; parametros nomeados, nada interpolado)
# ---------------------------------------------------------------------------
_CTE_ML = """
WITH o AS (
    SELECT DISTINCT ON (order_id)
           order_id, brand, status, cancel_detail, updated_at
      FROM api.vw_ml_orders
     WHERE brand = ANY(:marcas)
       AND date_created >= :inicio
       AND date_created < :fim_exclusivo
     ORDER BY order_id, updated_at DESC NULLS LAST
)
"""

SQL_ML_MARCAS = _CTE_ML + """
SELECT brand AS marca,
       COUNT(*) AS pedidos,
       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelados,
       MAX(updated_at) AS atualizado_em
  FROM o
 GROUP BY brand
"""

SQL_ML_MOTIVOS = _CTE_ML + """
SELECT cancel_detail->>'code' AS codigo,
       cancel_detail->>'requested_by' AS solicitante,
       COUNT(*) AS quantidade
  FROM o
 WHERE status = 'cancelled'
 GROUP BY 1, 2
"""

SQL_SHOPEE_MARCAS = """
SELECT shop_account AS marca,
       COUNT(*) FILTER (WHERE NOT (order_status = 'unpaid'
                                   OR (order_status = 'cancelled'
                                       AND lower(trim(cancel_reason)) = :nao_pago))) AS pedidos,
       COUNT(*) FILTER (WHERE order_status = 'cancelled'
                          AND lower(trim(coalesce(cancel_reason, ''))) <> :nao_pago) AS cancelados,
       COUNT(*) FILTER (WHERE order_status = 'cancelled' AND cancel_by = 'buyer') AS cancelados_comprador,
       COUNT(*) FILTER (WHERE order_status = 'cancelled'
                          AND lower(trim(cancel_reason)) = :nao_pago) AS nao_pagos,
       MAX(ingested_at) AS atualizado_em
  FROM silver.stg_shopee_orders
 WHERE shop_account = ANY(:marcas)
   AND created_date_brt BETWEEN :inicio AND :fim
 GROUP BY shop_account
"""

SQL_SHOPEE_MOTIVOS = """
SELECT cancel_reason AS motivo, cancel_by AS autor, COUNT(*) AS quantidade
  FROM silver.stg_shopee_orders
 WHERE shop_account = ANY(:marcas)
   AND created_date_brt BETWEEN :inicio AND :fim
   AND order_status = 'cancelled'
 GROUP BY 1, 2
"""

SQL_SHOPEE_DEVOLUCAO = """
SELECT shop_account AS marca, COUNT(*) AS em_devolucao
  FROM silver.stg_shopee_orders
 WHERE shop_account = ANY(:marcas)
   AND order_status = 'to_return'
   AND created_date_brt >= :desde
 GROUP BY shop_account
"""


def consultar_torre(sql: str, params: dict) -> list[dict]:
    """Neon da Torre (contas do bot, CX-KOKESHI-BOT)."""
    from app.services import torre_leitura  # import tardio: testes injetam `consultar_torre`

    return torre_leitura.consultar(sql, params)


def consultar_datamart(sql: str, params: dict) -> list[dict]:
    """Direto no Data Mart; se o banco recusar por permissao, pelo Metabase
    (ver `datamart_leitura`, a mesma leitura da Performance oficial)."""
    from app.services import datamart_leitura  # import tardio: testes injetam `consultar`

    return datamart_leitura.consultar(sql, params)


def _rodar(consultar: Consultar, nome: str, sql: str, params: dict) -> Optional[list[dict]]:
    """None = falhou (o motivo fixo sai na resposta; o log leva so' a classe)."""
    inicio = time.perf_counter()
    try:
        return consultar(sql, params)
    except Exception as exc:  # noqa: BLE001 — isolamento por fonte e' o contrato
        logger.warning("cx_atendimento: consulta %s falhou (%s)", nome, type(exc).__name__)
        return None
    finally:
        # duracao por consulta (com cache = ~0 s): base para achar a que pesa no Render
        logger.info("cx_atendimento: consulta %s em %.2f s", nome, time.perf_counter() - inicio)


# ---------------------------------------------------------------------------
# Montagem
# ---------------------------------------------------------------------------
def _int(v: Any) -> Optional[int]:
    if v is None or isinstance(v, bool):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _pct(num: Optional[int], den: Optional[int]) -> Optional[float]:
    if num is None or not den:
        return None
    return round(num / den * 100, 2)


def _utc(v: Any) -> Optional[datetime]:
    """Instante da fonte em UTC. Naive = UTC (o `updated_at` do ML e' UTC)."""
    if not isinstance(v, datetime):
        return None
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


def _aviso_frescor(canal: str, instante: Optional[datetime], agora: datetime) -> Optional[str]:
    if instante is None:
        return None
    horas = (agora - instante).total_seconds() / 3600
    limite = LIMITE_FRESCOR_HORAS[canal]
    if horas > limite:
        return f"Fonte sem atualização há {horas:.0f} h (esperado até {limite:.0f} h)."
    return None


def _corte_carga(instante: Optional[datetime], agora: datetime) -> Optional[date]:
    """Carga mais velha que o limite da Shopee: o ultimo dia medido e' o da
    carga (BRT), como no `cx_site_service`. Carga em dia ou sem instante: None."""
    if instante is None:
        return None
    if (agora - instante).total_seconds() / 3600 <= LIMITE_FRESCOR_HORAS["shopee"]:
        return None
    return instante.astimezone(TZ_OPERACIONAL).date()


def _float_ou_none(v: Optional[int]) -> Optional[float]:
    return None if v is None else float(v)


def _rotulo_marca(chave: str) -> str:
    return BRAND_LABELS.get(chave, chave.title())


def _cobertura(selecionadas: list[str], do_canal: tuple[str, ...], motivo_fora: str) -> Cobertura:
    return Cobertura(
        marcas=[m for m in selecionadas if m in do_canal],
        fora=[MarcaFora(marca=m, motivo=motivo_fora) for m in selecionadas if m not in do_canal],
    )


def _indicador(codigo: str, rotulo: str, *, valor: Optional[float], unidade: str, janela: str,
               fonte: str, ajuda: str, ok: bool, atualizado_em: Optional[datetime] = None,
               aviso: Optional[str] = None, cobertura: Optional[str] = None,
               motivo_vazio: Optional[str] = None) -> Indicador:
    """`ok=False` = fonte falhou (erro). `valor=None` com fonte ok = vazio legitimo."""
    if not ok:
        estado, valor, motivo = "erro", None, MOTIVO_ERRO
    elif valor is None:
        estado, motivo = "vazio_legitimo", motivo_vazio or "Sem pedidos no recorte."
    else:
        estado, motivo = "dado", None
    return Indicador(
        codigo=codigo, rotulo=rotulo, tipo="torre", estado=estado, valor=valor,
        unidade=unidade, janela=janela, limiar=None, fonte=fonte,
        atualizado_em=atualizado_em, aviso_frescor=aviso, cobertura=cobertura,
        ajuda=ajuda, motivo_indisponivel=motivo,
    )


def _sem_fonte(codigo: str, rotulo: str, unidade: str, motivo: str, ajuda: str) -> Indicador:
    return Indicador(
        codigo=codigo, rotulo=rotulo, tipo="torre", estado="sem_fonte", valor=None,
        unidade=unidade, janela=None, limiar=None, fonte="—", ajuda=ajuda,
        motivo_indisponivel=motivo,
    )


def _bloco_motivos(titulo: str, ajuda: str, linhas: Optional[list[tuple]],
                   excluidos: Optional[int] = None,
                   rotulo_excluidos: Optional[str] = None,
                   texto_vazio: str = "Nenhum cancelamento no recorte.") -> BlocoMotivos:
    """`linhas` = [(codigo, rotulo, natureza, mapeado, quantidade)] ou None (erro)."""
    if linhas is None:
        return BlocoMotivos(titulo=titulo, estado="erro", ajuda=ajuda,
                            motivo_indisponivel=MOTIVO_ERRO)
    agregados: dict[str, dict] = {}
    for codigo, rotulo, natureza, mapeado, qtd in linhas:
        if not qtd:
            continue
        item = agregados.setdefault(codigo, {"codigo": codigo, "rotulo": rotulo,
                                             "natureza": natureza, "mapeado": mapeado,
                                             "quantidade": 0})
        item["quantidade"] += qtd
    total = sum(i["quantidade"] for i in agregados.values())
    extra = {"excluidos": excluidos, "rotulo_excluidos": rotulo_excluidos} if excluidos else {}
    if total == 0:
        return BlocoMotivos(titulo=titulo, estado="vazio_legitimo", ajuda=ajuda,
                            motivo_indisponivel=texto_vazio, **extra)
    itens = sorted(agregados.values(), key=lambda i: (-i["quantidade"], i["rotulo"]))
    return BlocoMotivos(
        titulo=titulo, estado="dado", total=total, ajuda=ajuda,
        itens=[Motivo(pct=round(i["quantidade"] / total * 100, 1), **i) for i in itens],
        **extra,
    )


PENDENCIAS_ML = [
    Pendencia(codigo="ml_fila_acao", titulo="Reclamações aguardando nossa resposta",
              motivo="Depende da leitura das reclamações pela API do ML (post-purchase), ainda não publicada."),
    Pendencia(codigo="ml_motivos_reclamacao", titulo="Motivo das reclamações",
              motivo="O pedido guarda só o número da reclamação; o motivo vem da API do ML, ainda não publicada."),
    Pendencia(codigo="ml_perguntas", titulo="Perguntas sem resposta",
              motivo="Depende da leitura das perguntas pela API do ML, ainda não publicada."),
]
PENDENCIAS_SHOPEE = [
    Pendencia(codigo="shopee_devolucoes", titulo="Devoluções com motivo e prazo",
              motivo="Depende da leitura de devoluções pela API da Shopee (v2.returns), ainda não publicada."),
]
PENDENCIAS_TIKTOK = [
    Pendencia(codigo="tiktok_devolucoes", titulo="Devoluções e reembolsos",
              motivo="Depende da leitura pela API Return & Refund do TikTok, ainda não publicada."),
    Pendencia(codigo="tiktok_cancelamentos", titulo="Cancelamentos com motivo",
              motivo="Os pedidos do TikTok no Data Mart não trazem o motivo do cancelamento."),
]


def _canal_ml(consultar: Consultar, marcas: list[str], janela: Janela, agora: datetime) -> CanalAtendimento:
    cobertura = _cobertura(marcas, tuple(ML_BRANDS), "Sem conta Mercado Livre integrada.")
    if not cobertura.marcas:
        return CanalAtendimento(canal="mercado_livre", cobertura=cobertura, indicadores=[])
    params = {"marcas": cobertura.marcas, "inicio": janela.inicio,
              "fim_exclusivo": janela.fim + timedelta(days=1)}
    linhas = _rodar(consultar, "ml_marcas", SQL_ML_MARCAS, params)
    motivos = _rodar(consultar, "ml_motivos", SQL_ML_MOTIVOS, params)
    jt = _texto_janela(janela)
    ok = linhas is not None

    por_marca = {str(r.get("marca")): r for r in (linhas or [])}
    marcas_linhas = []
    for m in cobertura.marcas:
        r = por_marca.get(m)
        pedidos = _int(r.get("pedidos")) if r else None
        cancelados = _int(r.get("cancelados")) if r else None
        marcas_linhas.append(LinhaMarca(
            marca=m, pedidos=pedidos, cancelamentos=cancelados,
            taxa_cancelamento_pct=_pct(cancelados, pedidos),
        ))
    pedidos = sum(x.pedidos for x in marcas_linhas if x.pedidos is not None) if ok else None
    canc = sum(x.cancelamentos for x in marcas_linhas if x.cancelamentos is not None) if ok else None
    instante = max((t for t in (_utc(r.get("atualizado_em")) for r in (linhas or [])) if t),
                   default=None)
    aviso = _aviso_frescor("mercado_livre", instante, agora)
    sem_linha = [m for m in cobertura.marcas if m not in por_marca]
    cob_txt = (f"Sem pedidos no recorte: {', '.join(_rotulo_marca(m) for m in sem_linha)}."
               if ok and sem_linha else None)
    vazio = ok and not pedidos

    # Sem "taxa de reclamacao" aqui DE PROPOSITO: a contagem por `mediations`
    # inclui cancelamento pedido pelo comprador e nao aplica as exclusoes do ML.
    # Medido em 03/11/2026: Kokeshi 2,5% aqui contra 0,61% na reputacao oficial.
    # O numero oficial vem do snapshot de reputacao (aba Performance).
    indicadores = [
        _indicador("ml_cancelamentos", "Cancelamentos",
                   valor=None if vazio else canc, unidade="contagem", janela=jt, fonte=FONTE_ML,
                   ok=ok, atualizado_em=instante, aviso=aviso, cobertura=cob_txt,
                   ajuda="Pedidos criados na janela e cancelados, de qualquer autor (comprador, ML ou logística)."),
        _indicador("ml_taxa_cancelamento", "Taxa de cancelamento",
                   valor=_pct(canc, pedidos), unidade="pct", janela=jt, fonte=FONTE_ML, ok=ok,
                   atualizado_em=instante, aviso=aviso, cobertura=cob_txt,
                   ajuda="Cancelamentos ÷ pedidos criados na janela, de qualquer autor. Não é a taxa "
                         "\"Canceladas por você\" da reputação do ML, que conta só o que o vendedor cancelou."),
    ]
    bloco = _bloco_motivos(
        "Motivos de cancelamento",
        "Motivo registrado pelo ML no pedido cancelado (cancel_detail).",
        None if motivos is None else [
            (*rotular_ml(r.get("codigo"), r.get("solicitante")), _int(r.get("quantidade")) or 0)
            for r in motivos
        ],
    )
    return CanalAtendimento(
        canal="mercado_livre", cobertura=cobertura, indicadores=indicadores, motivos=bloco,
        marcas=marcas_linhas, pendencias=PENDENCIAS_ML, atualizado_em=instante,
    )


def _canal_shopee(consultar: Consultar, marcas: list[str], janela: Janela, agora: datetime,
                  anterior: Optional[Janela] = None,
                  cortes: Optional[dict[str, date]] = None) -> CanalAtendimento:
    """Pedidos e cancelamentos das lojas com app (Silver).

    `anterior` (aba CX): a mesma contagem na janela anterior. Loja cuja Silver
    comeca depois do inicio dela (`_desde`) ou com carga parada fica None,
    nunca um numero parcial.
    `cortes` (saida): marca -> ultimo dia carregado, so' das lojas com carga
    parada antes do fim da janela (dia sem carga sai None, nunca 0).
    """
    cobertura = _cobertura(marcas, SHOPEE_MARCAS, "Sem app Shopee.")
    if not cobertura.marcas:
        return CanalAtendimento(canal="shopee", cobertura=cobertura, indicadores=[])
    api = cobertura.marcas
    params = {"marcas": api, "inicio": janela.inicio, "fim": janela.fim,
              "nao_pago": SHOPEE_NAO_PAGO}
    linhas = _rodar(consultar, "shopee_marcas", SQL_SHOPEE_MARCAS, params)
    motivos = _rodar(consultar, "shopee_motivos", SQL_SHOPEE_MOTIVOS, params)
    devol = _rodar(consultar, "shopee_devolucao", SQL_SHOPEE_DEVOLUCAO,
                   {"marcas": api,
                    "desde": janela.fim - timedelta(days=DIAS_FOTOGRAFIA_DEVOLUCAO - 1)})
    linhas_ant = None
    if anterior is not None:
        linhas_ant = _rodar(consultar, "shopee_marcas_anterior", SQL_SHOPEE_MARCAS,
                            {**params, "inicio": anterior.inicio, "fim": anterior.fim})
    # Silver com historico: loja sem linha na janela anterior = zero medido
    ant_marca = None if linhas_ant is None else {str(r.get("marca")): r for r in linhas_ant}
    jt = _texto_janela(janela)
    ok = linhas is not None
    ok_dev = devol is not None

    por_marca = {str(r.get("marca")): r for r in (linhas or [])}
    dev_marca = {str(r.get("marca")): _int(r.get("em_devolucao")) for r in (devol or [])}
    parada: dict[str, date] = {}
    marcas_linhas = []
    for m in cobertura.marcas:
        r = por_marca.get(m)
        corte = _corte_carga(_utc(r.get("atualizado_em")), agora) if r else None
        if corte is not None and corte < janela.fim:
            parada[m] = corte
        pedidos_m = _int(r.get("pedidos")) if r else None
        cancelados_m = _int(r.get("cancelados")) if r else None
        cobre_ant = (ant_marca is not None and anterior is not None and m not in parada
                     and anterior.inicio >= _desde("cancelamento", m))
        ra = ant_marca.get(m, {}) if cobre_ant else None
        marcas_linhas.append(LinhaMarca(
            pedidos_anterior=None if ra is None else (_int(ra.get("pedidos")) or 0),
            cancelamentos_anterior=None if ra is None else (_int(ra.get("cancelados")) or 0),
            marca=m,
            pedidos=pedidos_m,
            cancelamentos=cancelados_m,
            taxa_cancelamento_pct=_pct(cancelados_m, pedidos_m),
            cancelamentos_comprador=_int(r.get("cancelados_comprador")) if r else None,
            # fotografia: sem linha para a marca = nenhum pedido em devolucao (zero medido)
            em_devolucao=dev_marca.get(m, 0) if ok_dev else None,
        ))
    if cortes is not None:
        cortes.update(parada)

    def soma(campo):
        vals = [getattr(x, campo) for x in marcas_linhas if getattr(x, campo) is not None]
        return sum(vals) if vals else None

    pedidos = soma("pedidos") if ok else None
    canc = soma("cancelamentos") if ok else None
    nao_pagos = sum(_int(r.get("nao_pagos")) or 0 for r in (linhas or [])) if ok else None
    instante = max((t for t in (_utc(r.get("atualizado_em")) for r in (linhas or [])) if t),
                   default=None)
    aviso = _aviso_frescor("shopee", instante, agora)
    vazio = ok and not pedidos
    # total com loja de carga parada: parcial, dito no campo `cobertura` do indicador
    cob_txt = ("Parcial: " + "; ".join(f"{_rotulo_marca(m)} com carga parada desde {d.strftime('%d/%m')}"
                                       for m, d in sorted(parada.items()))
               + " (o que veio depois não aparece).") if parada else None

    indicadores = [
        _indicador("shopee_cancelamentos", "Cancelamentos",
                   valor=None if vazio else canc, unidade="contagem", janela=jt, fonte=FONTE_SHOPEE,
                   ok=ok, atualizado_em=instante, aviso=aviso, cobertura=cob_txt,
                   ajuda="Pedidos criados na janela e cancelados, exceto os não pagos que a Shopee cancela sozinha."),
        _indicador("shopee_taxa_cancelamento", "Taxa de cancelamento",
                   valor=_pct(canc, pedidos), unidade="pct", janela=jt, fonte=FONTE_SHOPEE, ok=ok,
                   atualizado_em=instante, aviso=aviso, cobertura=cob_txt,
                   ajuda="Cancelamentos ÷ pedidos criados na janela, os dois sem os pedidos não pagos."),
        _indicador("shopee_em_devolucao", "Pedidos em devolução agora",
                   valor=_float_ou_none(soma("em_devolucao")) if ok_dev else None, unidade="contagem",
                   janela=f"fotografia atual · pedidos dos últimos {DIAS_FOTOGRAFIA_DEVOLUCAO} dias",
                   fonte=FONTE_SHOPEE, ok=ok_dev,
                   ajuda="Pedidos com status 'to_return' na Shopee neste momento. Sem motivo nem prazo: "
                         "esses detalhes dependem da API de devoluções."),
    ]
    bloco = _bloco_motivos(
        "Motivos de cancelamento",
        "Motivo registrado pela Shopee no pedido cancelado (cancel_reason).",
        None if motivos is None else [
            (*rotular_shopee(r.get("motivo"), r.get("autor")), _int(r.get("quantidade")) or 0)
            for r in motivos
            if str(r.get("motivo") or "").strip().lower() != SHOPEE_NAO_PAGO
        ],
        excluidos=nao_pagos or None,
        rotulo_excluidos="pedidos não pagos cancelados pela Shopee (fora da contagem)",
    )
    return CanalAtendimento(
        canal="shopee", cobertura=cobertura, indicadores=indicadores, motivos=bloco,
        marcas=marcas_linhas, pendencias=PENDENCIAS_SHOPEE, atualizado_em=instante,
    )


def _canal_tiktok(marcas: list[str]) -> CanalAtendimento:
    cobertura = _cobertura(marcas, tuple(BRANDS_IN_SCOPE), "Fora do escopo da Torre.")
    if not cobertura.marcas:
        return CanalAtendimento(canal="tiktok", cobertura=cobertura, indicadores=[])
    motivo = "Devoluções e cancelamentos do TikTok ainda não são lidos pela Torre (API Return & Refund)."
    return CanalAtendimento(
        canal="tiktok", cobertura=cobertura,
        indicadores=[
            _sem_fonte("tiktok_devolucoes", "Devoluções e reembolsos", "contagem", motivo,
                       "Pedidos de devolução ou reembolso abertos pelo comprador."),
            _sem_fonte("tiktok_cancelamentos", "Cancelamentos com motivo", "contagem", motivo,
                       "Cancelamentos com o motivo registrado pelo TikTok."),
        ],
        pendencias=PENDENCIAS_TIKTOK,
    )


def montar_atendimento(*, brands: Optional[list[str]] = None, dias: int = JANELA_PADRAO_DIAS,
                       consultar: Optional[Consultar] = None,
                       agora: Optional[datetime] = None) -> AtendimentoResponse:
    agora = agora or datetime.now(timezone.utc)
    consultar = consultar or consultar_datamart
    marcas = [m for m in MARCAS_PERMITIDAS if brands is None or m in brands]
    janela = calcular_janela(dias, agora)
    return AtendimentoResponse(
        gerado_em=agora,
        janela=janela,
        canais=[
            _canal_ml(consultar, marcas, janela, agora),
            _canal_shopee(consultar, marcas, janela, agora),
            _canal_tiktok(marcas),
        ],
    )


# ---------------------------------------------------------------------------
# Aba CX (menu principal) — primeira versao, so' Shopee (04/11/2026)
# ---------------------------------------------------------------------------
GRUPO_ATENDIMENTO = "Atendimento"


def _chat_shopee(brands: Optional[list[str]], consultar: Consultar, agora: datetime,
                 consultar_torre: Optional[Consultar] = None) -> ChatShopee:
    """Recorte de atendimento da Saude da Conta, a mesma leitura da Performance."""
    from app.services import performance_oficial_service as po  # import tardio: evita ciclo

    oficial = po.montar_performance_oficial(canal="shopee", brands=brands,
                                            consultar=consultar, consultar_torre=consultar_torre,
                                            agora=agora)
    contas = []
    for conta in oficial.contas:
        metricas = [m for m in conta.metricas if m.grupo == GRUPO_ATENDIMENTO]
        fora = sum(1 for m in metricas if m.situacao == "fora")
        contas.append(ContaCx(**{
            **conta.model_dump(),
            "metricas": metricas,
            "destaques": [],
            "resumo": (f"{fora} métrica(s) de atendimento fora da meta" if fora
                       else "Atendimento dentro da meta da Shopee"),
            "tom": "atencao" if fora else "bom",
        }))
    return ChatShopee(estado=oficial.estado, motivo=oficial.motivo, fonte=oficial.fonte,
                      contas=contas, sem_foto=oficial.sem_foto)



# ---------------------------------------------------------------------------
# Coleta de CX da Shopee no Airflow (DAG `shopee_cx_coleta`, 04/11/2026)
# ---------------------------------------------------------------------------
FONTE_CX_SHOPEE = "Data Mart · raw.shopee_returns e raw.shopee_chat_snapshot (shopee_cx_coleta)"
MOTIVO_SEM_COLETA = "Aguardando a primeira coleta de CX da Shopee no Airflow (DAG shopee_cx_coleta)."

SQL_TABELAS_CX = (
    "SELECT to_regclass('raw.shopee_returns') IS NOT NULL AS returns, "
    "to_regclass('raw.shopee_chat_snapshot') IS NOT NULL AS chat, "
    "to_regclass('raw.shopee_chat_respostas') IS NOT NULL AS respostas"
)

#: Status da devolucao na Shopee (04/11/2026: ACCEPTED, CANCELLED, PROCESSING,
#: JUDGING, REQUESTED, CLOSED, SELLER_DISPUTE). So' ACCEPTED vira reembolso;
#: CANCELLED = o comprador desistiu do pedido de devolucao.
STATUS_ACEITA = "ACCEPTED"
STATUS_CANCELADA = "CANCELLED"
STATUS_EM_ANDAMENTO = ("REQUESTED", "PROCESSING", "JUDGING", "SELLER_DISPUTE")

#: `atualizado_em` = ultima coleta da loja: cada run rele as devolucoes criadas
#: nos ultimos 30 dias e regrava `captured_at` (upsert por return_sn).
SQL_DEVOLUCOES_MARCAS = """
SELECT brand AS marca,
       COUNT(*) AS devolucoes,
       COUNT(*) FILTER (WHERE status = 'ACCEPTED') AS aceitas,
       COUNT(*) FILTER (WHERE status IN ('REQUESTED', 'PROCESSING', 'JUDGING', 'SELLER_DISPUTE')) AS em_andamento,
       COUNT(*) FILTER (WHERE status = 'CANCELLED') AS canceladas,
       SUM(refund_amount) FILTER (WHERE status = 'ACCEPTED') AS reembolsado,
       MAX(captured_at) AS atualizado_em
  FROM raw.shopee_returns
 WHERE brand = ANY(:marcas)
   AND (create_time AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN :inicio AND :fim
 GROUP BY brand
"""

#: Motivos so' dos pedidos que o comprador NAO cancelou: o desistido nao e'
#: problema a tratar e aparece a' parte (`excluidos`).
SQL_DEVOLUCOES_MOTIVOS = """
SELECT COALESCE(reason, '') AS motivo,
       COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'CANCELLED') AS quantidade,
       COUNT(*) FILTER (WHERE status = 'CANCELLED') AS canceladas
  FROM raw.shopee_returns
 WHERE brand = ANY(:marcas)
   AND (create_time AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN :inicio AND :fim
 GROUP BY 1
"""

#: `to_jsonb(s)` le as colunas de conversas mesmo antes de a coleta cria-las
#: (ALTER TABLE ... ADD COLUMN IF NOT EXISTS no primeiro run): coluna que nao
#: existe vira NULL em vez de quebrar a consulta.
SQL_NAO_LIDAS = """
SELECT DISTINCT ON (brand) brand AS marca, unread_count, captured_at,
       (to_jsonb(s) ->> 'conversas_7d')::int        AS conversas_7d,
       (to_jsonb(s) ->> 'conversas_30d')::int       AS conversas_30d,
       (to_jsonb(s) ->> 'aguardando_resposta')::int AS aguardando_resposta,
       (to_jsonb(s) ->> 'conversas_truncado')::boolean AS conversas_truncado,
       (to_jsonb(s) ->> 'aguardando_ate_1h')::int   AS aguardando_ate_1h,
       (to_jsonb(s) ->> 'aguardando_1a4h')::int     AS aguardando_1a4h,
       (to_jsonb(s) ->> 'aguardando_4a24h')::int    AS aguardando_4a24h,
       (to_jsonb(s) ->> 'aguardando_mais_24h')::int AS aguardando_mais_24h,
       (to_jsonb(s) ->> 'espera_max_s')::int        AS espera_max_s,
       (to_jsonb(s) ->> 'tempo_resposta_medio_s')::int AS tempo_resposta_medio_s
  FROM raw.shopee_chat_snapshot s
 WHERE brand = ANY(:marcas)
 ORDER BY brand, captured_at DESC
"""

#: Tempo de resposta do chat (05/11/2026): uma linha por resposta da loja
#: (`shopee_cx_coleta` + `get_message`). Mediana e p90 da espera, sem as
#: respostas automaticas (origem com "auto" ou "bot").
SQL_TEMPO_RESPOSTA = """
SELECT brand AS marca,
       COUNT(*) AS respostas,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY espera_s) AS mediana_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY espera_s) AS p90_s,
       COUNT(*) FILTER (WHERE espera_s <= 3600) AS ate_1h,
       MIN(respondido_em) AS desde_em
  FROM raw.shopee_chat_respostas
 WHERE brand = ANY(:marcas)
   AND respondido_em >= :desde
   AND COALESCE(origem, '') !~* '(auto|bot)'
 GROUP BY brand
"""

#: Motivos de devolucao da Shopee (campo `reason`) -> (rotulo, natureza).
MOTIVOS_DEVOLUCAO: dict[str, tuple[str, str]] = {
    "CHANGE_MIND": ("Mudou de ideia", "comprador"),
    "MUTUAL_AGREE": ("Acordo entre as partes", "comprador"),
    "NOT_RECEIPT": ("Não recebeu o pedido", "logistica"),
    "NON_RECEIPT": ("Não recebeu o pedido", "logistica"),
    "DAMAGED_OTHERS": ("Chegou danificado", "logistica"),
    "PHYSICAL_DMG": ("Chegou danificado", "logistica"),
    "DAMAGED": ("Chegou danificado", "logistica"),
    "FUNCTIONAL_DMG": ("Com defeito de funcionamento", "vendedor"),
    "WRONG_ITEM": ("Item errado", "vendedor"),
    "ITEM_WRONGDAMAGED": ("Item errado ou danificado", "vendedor"),
    "ITEM_MISSING": ("Item faltando", "vendedor"),
    "DIFFERENT_DESCRIPTION": ("Diferente do anúncio", "vendedor"),
    "DIFF_DESC": ("Diferente do anúncio", "vendedor"),
    "EXPIRED_PRODUCT": ("Produto vencido", "vendedor"),
    "SPILLED_CONTENTS": ("Produto vazou", "vendedor"),
    "ITEM_FAKE": ("Suspeita de falsificação", "vendedor"),
    "SUSPICIOUS_PARCEL": ("Pacote suspeito ou violado", "logistica"),
    "COUNTERFEIT": ("Suspeita de falsificação", "vendedor"),
    "USED_PRODUCT": ("Produto usado", "vendedor"),
    "OTHERS": ("Outros", "comprador"),
    "OTHER": ("Outros", "comprador"),
}


def rotular_devolucao(motivo: Any) -> tuple[str, str, str, bool]:
    """(codigo, rotulo, natureza, mapeado) de um motivo de devolucao Shopee."""
    bruto = str(motivo or "").strip()
    if not bruto or bruto.upper() == "NONE":
        return "sem_motivo", "Sem motivo informado", "reclamacao", True
    chave = bruto.upper()
    if chave in MOTIVOS_DEVOLUCAO:
        rotulo, natureza = MOTIVOS_DEVOLUCAO[chave]
        return chave.lower(), rotulo, natureza, True
    return _slug(bruto.lower()), bruto[:120], "reclamacao", False


def _tabelas_cx(consultar: Consultar) -> Optional[dict]:
    linhas = _rodar(consultar, "tabelas_cx", SQL_TABELAS_CX, {})
    if linhas is None:
        return None
    r = linhas[0] if linhas else {}
    return {"returns": bool(r.get("returns")), "chat": bool(r.get("chat")),
            "respostas": bool(r.get("respostas"))}


def _devolucoes_shopee(consultar: Consultar, marcas: list[str], janela: Janela,
                       existe: Optional[bool], agora: Optional[datetime] = None,
                       cortes: Optional[dict[str, date]] = None) -> DevolucoesShopee:
    """Devolucoes das lojas com app (`raw.shopee_returns`).

    `cortes` (saida): marca -> dia da ultima coleta, so' das lojas com coleta
    parada antes do fim da janela.
    """
    ajuda = "Motivo registrado pela Shopee na devolução ou reembolso (campo reason)."
    if existe is None:
        return DevolucoesShopee(estado="erro", fonte=FONTE_CX_SHOPEE, motivo_indisponivel=MOTIVO_ERRO)
    if not existe:
        return DevolucoesShopee(estado="sem_fonte", fonte=FONTE_CX_SHOPEE,
                                motivo_indisponivel=MOTIVO_SEM_COLETA)
    if not marcas:
        return DevolucoesShopee(estado="vazio_legitimo", fonte=FONTE_CX_SHOPEE,
                                motivo_indisponivel="Nenhuma loja Shopee no filtro.")
    params = {"marcas": marcas, "inicio": janela.inicio, "fim": janela.fim}
    por_marca = _rodar(consultar, "devolucoes_marcas", SQL_DEVOLUCOES_MARCAS, params)
    motivos = _rodar(consultar, "devolucoes_motivos", SQL_DEVOLUCOES_MOTIVOS, params)
    if por_marca is None:
        return DevolucoesShopee(estado="erro", fonte=FONTE_CX_SHOPEE, motivo_indisponivel=MOTIVO_ERRO)
    linhas = {str(r.get("marca")): r for r in por_marca}
    marcas_linhas = []
    for m in marcas:
        r = linhas.get(m)
        corte = _corte_carga(_utc(r.get("atualizado_em")), agora) if r and agora else None
        if cortes is not None and corte is not None and corte < janela.fim:
            cortes[m] = corte
        # tabela existe e a marca nao tem linha = zero medido na janela
        if r is None:
            marcas_linhas.append(LinhaDevolucao(marca=m, devolucoes=0, aceitas=0, em_andamento=0,
                                                canceladas=0, reembolsado=0.0))
            continue
        reemb = r.get("reembolsado")
        aceitas = _int(r.get("aceitas"))
        marcas_linhas.append(LinhaDevolucao(
            marca=m,
            devolucoes=_int(r.get("devolucoes")),
            aceitas=aceitas,
            em_andamento=_int(r.get("em_andamento")),
            canceladas=_int(r.get("canceladas")),
            # sem aceita = nada reembolsado (zero); com aceita e soma nula = ausente
            reembolsado=round(float(reemb), 2) if reemb is not None else (0.0 if not aceitas else None),
        ))

    def soma(campo):
        vals = [getattr(x, campo) for x in marcas_linhas if getattr(x, campo) is not None]
        return sum(vals) if vals else None

    reembolsado = soma("reembolsado")
    canceladas_motivos = sum(_int(r.get("canceladas")) or 0 for r in (motivos or []))
    bloco = _bloco_motivos(
        "Motivos de devolução", ajuda,
        None if motivos is None else [
            (*rotular_devolucao(r.get("motivo")), _int(r.get("quantidade")) or 0) for r in motivos
        ],
        excluidos=canceladas_motivos or None,
        rotulo_excluidos="pedidos de devolução cancelados pelo próprio comprador (fora dos motivos)",
        texto_vazio="Nenhuma devolução no recorte.",
    )
    return DevolucoesShopee(
        estado="dado", fonte=FONTE_CX_SHOPEE, total=soma("devolucoes"), aceitas=soma("aceitas"),
        em_andamento=soma("em_andamento"), canceladas=soma("canceladas"),
        reembolsado=None if reembolsado is None else round(reembolsado, 2),
        motivos=bloco, marcas=marcas_linhas,
    )


def _nao_lidas(consultar: Consultar, marcas: list[str],
               existe: Optional[bool]) -> tuple[str, list[NaoLidas]]:
    if existe is None:
        return "erro", []
    if not existe:
        return "sem_fonte", []
    if not marcas:
        return "vazio_legitimo", []
    linhas = _rodar(consultar, "nao_lidas", SQL_NAO_LIDAS, {"marcas": marcas})
    if linhas is None:
        return "erro", []
    return "dado", [
        NaoLidas(marca=str(r.get("marca")), valor=_int(r.get("unread_count")),
                 capturado_em=_utc(r.get("captured_at")),
                 conversas_7d=_int(r.get("conversas_7d")),
                 conversas_30d=_int(r.get("conversas_30d")),
                 aguardando_resposta=_int(r.get("aguardando_resposta")),
                 conversas_truncado=(r.get("conversas_truncado")
                                     if isinstance(r.get("conversas_truncado"), bool) else None),
                 aguardando_ate_1h=_int(r.get("aguardando_ate_1h")),
                 aguardando_1a4h=_int(r.get("aguardando_1a4h")),
                 aguardando_4a24h=_int(r.get("aguardando_4a24h")),
                 aguardando_mais_24h=_int(r.get("aguardando_mais_24h")),
                 espera_max_s=_int(r.get("espera_max_s")),
                 tempo_resposta_s=_int(r.get("tempo_resposta_medio_s")),
                 tempo_resposta_fonte=("media_seller_centre"
                                       if _int(r.get("tempo_resposta_medio_s")) is not None else None))
        for r in linhas if str(r.get("marca")) in marcas
    ]


def _com_tempo_resposta(consultar: Consultar, nao_lidas: list[NaoLidas], marcas: list[str],
                        existe: Optional[bool], desde: datetime) -> list[NaoLidas]:
    """Junta a mediana do tempo de resposta (lojas com app) em cada foto.

    Tabela ausente ou falha: as fotos seguem sem tempo (None, nunca zero).
    """
    if not existe or not marcas:
        return nao_lidas
    linhas = _rodar(consultar, "tempo_resposta", SQL_TEMPO_RESPOSTA, {"marcas": marcas, "desde": desde})
    if not linhas:
        return nao_lidas
    por_marca = {str(r.get("marca")): r for r in linhas}
    out = []
    for n in nao_lidas:
        r = por_marca.get(n.marca)
        total = _int(r.get("respostas")) if r else None
        if not r or not total:
            out.append(n)
            continue
        ate_1h = _int(r.get("ate_1h")) or 0
        mediana, p90 = r.get("mediana_s"), r.get("p90_s")
        out.append(n.model_copy(update={
            "tempo_resposta_s": None if mediana is None else int(round(float(mediana))),
            "tempo_resposta_p90_s": None if p90 is None else int(round(float(p90))),
            "respostas": total,
            "respostas_ate_1h_pct": round(ate_1h * 100 / total, 1),
            "respostas_desde": _utc(r.get("desde_em")),
            "tempo_resposta_fonte": "mediana",
        }))
    return out


def montar_cx_shopee(*, brands: Optional[list[str]] = None, dias: int = JANELA_PADRAO_DIAS,
                     consultar: Optional[Consultar] = None,
                     consultar_torre: Optional[Consultar] = None,
                     agora: Optional[datetime] = None) -> CxShopeeResponse:
    """Aba CX: chat (Saude da Conta) + cancelamentos e devolucoes (pedidos).

    Lojas com app pelo Data Mart. O Neon (bot do Seller Centre) so' entra na
    Saude da Conta das contas de `SHOPEE_SAUDE_EXPORT`.
    """
    agora = agora or datetime.now(timezone.utc)
    consultar = consultar or consultar_datamart
    consultar_torre = consultar_torre or consultar_torre_padrao
    marcas = [m for m in MARCAS_PERMITIDAS if brands is None or m in brands]
    janela = calcular_janela(dias, agora)
    marcas_shopee = [m for m in marcas if m in SHOPEE_MARCAS]
    saude_exp = [m for m in marcas_shopee if m in SHOPEE_SAUDE_EXPORT]
    anterior = Janela(inicio=janela.inicio - timedelta(days=janela.dias),
                      fim=janela.inicio - timedelta(days=1), dias=janela.dias)
    hoje = agora.astimezone(TZ_OPERACIONAL).date()
    # API-3: as consultas da comparacao correm em paralelo com as da aba
    with ThreadPoolExecutor(max_workers=1) as pool:
        comparacao = pool.submit(_rodar_juntas, _tarefas_comparacao(
            consultar, consultar_torre, marcas_shopee, saude_exp, janela, anterior, agora, hoje))
        return _montar_cx_shopee(consultar, consultar_torre, marcas, marcas_shopee, brands,
                                 janela, anterior, agora, hoje, comparacao.result)


def _montar_cx_shopee(consultar: Consultar, consultar_torre: Consultar, marcas: list[str],
                      marcas_shopee: list[str], brands: Optional[list[str]],
                      janela: Janela, anterior: Janela, agora: datetime, hoje: date,
                      comparacao: Callable[[], dict]) -> CxShopeeResponse:
    # sem loja com app no filtro: nada a checar no Data Mart (bloco vazio legitimo)
    tabelas = _tabelas_cx(consultar) if marcas_shopee else {"returns": True, "chat": True}
    chat = _chat_shopee(brands, consultar, agora, consultar_torre)

    estado_nl, nao_lidas = _nao_lidas(consultar, marcas_shopee,
                                      None if tabelas is None else tabelas["chat"])
    nao_lidas = _com_tempo_resposta(consultar, nao_lidas, marcas_shopee,
                                    None if tabelas is None else tabelas.get("respostas"),
                                    agora - timedelta(days=janela.dias))
    chat = chat.model_copy(update={"nao_lidas_estado": estado_nl, "nao_lidas": nao_lidas})
    cortes: dict[str, dict[str, date]] = {"cancelamento": {}, "reembolso": {}}
    atendimento = _canal_shopee(consultar, marcas, janela, agora, anterior, cortes["cancelamento"])
    devolucoes = _devolucoes_shopee(consultar, marcas_shopee, janela,
                                    None if tabelas is None else tabelas["returns"],
                                    agora, cortes["reembolso"])
    novos = _aplicar_comparacao(comparacao(), janela=janela, anterior=anterior, agora=agora, hoje=hoje,
                                chat=chat, atendimento=atendimento, devolucoes=devolucoes,
                                lojas=marcas_shopee, cortes=cortes)
    return CxShopeeResponse(gerado_em=agora, janela=janela, janela_anterior=anterior, **novos)


# ---------------------------------------------------------------------------
# API-3 (09/11/2026): periodo anterior e serie diaria da aba CX
# ---------------------------------------------------------------------------
#: Primeiro dia com dado de cada fonte das lojas com app, medido em 08/11/2026.
#: Janela anterior que comeca antes disso = None com motivo, nunca um numero
#: parcial. Dia da serie antes disso = None.
DESDE: dict[str, date] = {
    "cancelamento": date(2026, 1, 1),    # Silver
    "reembolso": date(2026, 10, 5),      # raw.shopee_returns
    "resposta": date(2026, 11, 4),       # Saude da Conta
    "contact_rate": date(2026, 11, 4),   # foto do chat
}
#: Loja que entrou depois na fonte do indicador (T-0114).
DESDE_MARCA: dict[tuple[str, str], date] = {
    # Silver: Kokeshi de 31/08 a 13/11 (SQL de 13/11, VAL-B2)
    ("cancelamento", "kokeshi"): date(2026, 8, 31),
    # [INFERENCIA, conservador] a coleta rele 30 dias de devolucoes e a Kokeshi
    # entrou entre 11/11 e 13/11 18:29Z (VAL-C1): o primeiro dia inteiro e' no
    # maximo 14/10. Confirmar com MIN(create_time) e trocar pela data medida.
    ("reembolso", "kokeshi"): date(2026, 10, 15),
    # Saude da Conta da Kokeshi segue no bot (SHOPEE_SAUDE_EXPORT)
    ("resposta", "kokeshi"): date(2026, 11, 6),
    # [INFERENCIA] foto do chat da Kokeshi existe em 13/11 13:15 (VAL-C1)
    ("contact_rate", "kokeshi"): date(2026, 11, 13),
}
#: Nome curto da fonte no motivo ("coleta desde 04/11").
FONTE_CURTA = {"cancelamento": "pedidos", "reembolso": "devoluções",
               "resposta": "coleta", "contact_rate": "coleta"}
#: Foto do chat aceita como "a de N dias atras": a coleta roda a cada 2 h.
TOLERANCIA_FOTO_CHAT = timedelta(hours=6)
METRICA_RESPOSTA = 11  # shopee_11, "Taxa de resposta do chat"

SEM_SERIE_CONTACT = SemComparacao(
    motivo="sem contagem diária", a_partir_de=None,
    detalhe="As conversas vêm de uma foto acumulada (7 ou 30 dias), sem contagem por dia.")
SEM_CONTACT_90 = SemComparacao(motivo="só em 7 e 30 dias", a_partir_de=None,
                               detalhe="Contact rate só existe nas janelas de 7 e 30 dias.")
SEM_FONTE_ERRO = SemComparacao(motivo="fonte indisponível", a_partir_de=None, detalhe=MOTIVO_ERRO)


def _desde(indicador: str, marca: str) -> date:
    return DESDE_MARCA.get((indicador, marca), DESDE[indicador])


# Em producao cada consulta do Data Mart vira uma chamada ao Metabase, que as
# atende em fila: 4 chamadas a mais custaram ~+1 s a frio (medido 09/11/2026).
# Por isso as partes da comparacao vao numa consulta so' por fonte; `parte`
# diz de qual veio cada linha. Regras: pedidos = `SQL_SHOPEE_MARCAS` por dia;
# devolucoes = `SQL_DEVOLUCOES_MARCAS` (so' ACCEPTED vira reembolso) por dia;
# chat = a foto de `agora - dias`.
_PARTE_DEVOLUCOES = """
SELECT 'devolucoes' AS parte, brand AS marca, (create_time AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       (COUNT(*) FILTER (WHERE status = 'ACCEPTED'))::numeric AS a,
       (SUM(refund_amount) FILTER (WHERE status = 'ACCEPTED'))::numeric AS b
  FROM raw.shopee_returns
 WHERE brand = ANY(:marcas)
   AND (create_time AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN :dev_inicio AND :dev_fim
 GROUP BY 2, 3"""
_PARTE_RESPOSTA = """
SELECT 'resposta', brand, captured_date, current_period::numeric, NULL::numeric
  FROM raw.shopee_account_health_metric
 WHERE brand = ANY(:marcas)
   AND metric_id = :metrica
   AND captured_date BETWEEN :resp_inicio AND :resp_fim"""
_PARTE_CHAT = """
(SELECT DISTINCT ON (brand) 'chat', brand, NULL::date,
        (to_jsonb(s) ->> 'conversas_7d')::numeric, (to_jsonb(s) ->> 'conversas_30d')::numeric
   FROM raw.shopee_chat_snapshot s
  WHERE brand = ANY(:marcas)
    AND captured_at BETWEEN :desde AND :ate
  ORDER BY brand, captured_at DESC)"""
_PARTE_PEDIDOS = """
SELECT 'pedidos', shop_account, created_date_brt,
       (COUNT(*) FILTER (WHERE NOT (order_status = 'unpaid'
                                    OR (order_status = 'cancelled'
                                        AND lower(trim(cancel_reason)) = :nao_pago))))::numeric,
       (COUNT(*) FILTER (WHERE order_status = 'cancelled'
                           AND lower(trim(coalesce(cancel_reason, ''))) <> :nao_pago))::numeric
  FROM silver.stg_shopee_orders
 WHERE shop_account = ANY(:marcas)
   AND created_date_brt BETWEEN :ped_inicio AND :ped_fim
 GROUP BY 2, 3"""
#: Taxa de resposta (shopee_11) das contas cuja Saude da Conta so' o bot grava
#: (`SHOPEE_SAUDE_EXPORT`), no Neon. Se a mesma conta aparecer tambem no Data
#: Mart, esta vem depois em `_juntar` e prevalece (a mesma fonte do cartao).
SQL_RESPOSTA_EXPORT = """
SELECT 'resposta' AS parte, brand AS marca, captured_date AS dia, current_period::numeric AS a, NULL::numeric AS b
  FROM marts.shopee_saude_metrica_export
 WHERE brand = ANY(:marcas)
   AND metric_id = :metrica
   AND captured_date BETWEEN :resp_inicio AND :resp_fim
"""
#: Colunas de cada parte, no lugar de `a` e `b`.
_COLUNAS_PARTE = {"devolucoes": ("aceitas", "reembolsado"), "resposta": ("valor", None),
                  "chat": ("conversas_7d", "conversas_30d"), "pedidos": ("pedidos", "cancelados")}


def sql_comparacao(*, exportar: bool, com_chat: bool) -> str:
    """A consulta unica da comparacao (texto fixo para cada combinacao).

    `exportar=True`: so' a taxa de resposta das contas do bot (Neon)."""
    if exportar:
        return SQL_RESPOSTA_EXPORT
    partes = [_PARTE_DEVOLUCOES, _PARTE_RESPOSTA]
    if com_chat:
        partes.append(_PARTE_CHAT)
    partes.append(_PARTE_PEDIDOS)
    return "\nUNION ALL".join(partes) + "\n"


def _separar_partes(linhas: Optional[list[dict]], sufixo: str,
                    com_chat: bool) -> dict[str, Optional[list[dict]]]:
    """Linhas da consulta unica -> uma lista por parte, com os nomes de antes."""
    if sufixo:
        nomes = ["resposta"]
    else:
        nomes = ["devolucoes", "resposta", "pedidos"] + (["chat"] if com_chat else [])
    if linhas is None:
        return {n + sufixo: None for n in nomes}
    out: dict[str, Optional[list[dict]]] = {n + sufixo: [] for n in nomes}
    for r in linhas:
        parte = str(r.get("parte"))
        if parte + sufixo not in out:
            continue
        col_a, col_b = _COLUNAS_PARTE[parte]
        linha = {"marca": r.get("marca"), "dia": r.get("dia"), col_a: r.get("a")}
        if col_b:
            linha[col_b] = r.get("b")
        out[parte + sufixo].append(linha)
    return out


def _dia(v: Any) -> Optional[date]:
    """Data direto do banco ou texto ISO (reserva pelo Metabase)."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _rodar_juntas(tarefas: dict[str, tuple[Consultar, str, dict]]) -> dict[str, Optional[list[dict]]]:
    """Consultas independentes em paralelo (a comparacao nao pode deixar a rota lenta)."""
    if not tarefas:
        return {}
    with ThreadPoolExecutor(max_workers=len(tarefas)) as pool:
        futuros = {nome: pool.submit(_rodar, c, nome, sql, p) for nome, (c, sql, p) in tarefas.items()}
        return {nome: f.result() for nome, f in futuros.items()}


def _tarefas_comparacao(consultar: Consultar, consultar_torre: Consultar, api: list[str],
                        saude_exp: list[str], janela: Janela, anterior: Janela, agora: datetime,
                        hoje: date) -> dict:
    """Uma consulta no Data Mart (`sql_comparacao`) e, para as contas do bot, a
    taxa de resposta no Neon."""
    t: dict[str, tuple[Consultar, str, dict]] = {}
    n = janela.dias
    alvo = agora - timedelta(days=n)
    # da foto mais velha que a comparacao pede (a de inicio - dias) ate' hoje
    p_resp = {"resp_inicio": janela.inicio - timedelta(days=n), "resp_fim": hoje, "metrica": METRICA_RESPOSTA}
    if api:
        p = {"marcas": api, "dev_inicio": anterior.inicio, "dev_fim": janela.fim, **p_resp,
             "ped_inicio": janela.inicio, "ped_fim": janela.fim, "nao_pago": SHOPEE_NAO_PAGO}
        if n <= 30:
            p.update(desde=alvo - TOLERANCIA_FOTO_CHAT, ate=alvo)
        t["comparacao"] = (consultar, sql_comparacao(exportar=False, com_chat=n <= 30), p)
    if saude_exp:
        t["comparacao_export"] = (consultar_torre, SQL_RESPOSTA_EXPORT, {"marcas": saude_exp, **p_resp})
    return t


def _juntar(res: dict, nome: str) -> Optional[list[dict]]:
    """Linhas das duas fontes; None se alguma das consultadas falhou."""
    partes = [res[k] for k in (nome, nome + "_export") if k in res]
    if any(p is None for p in partes):
        return None
    return [linha for p in partes for linha in p]


def _por_marca_dia(linhas: Optional[list[dict]]) -> Optional[dict[tuple[str, Optional[date]], dict]]:
    if linhas is None:
        return None
    return {(str(r.get("marca")), _dia(r.get("dia"))): r for r in linhas}


def _rotulos(marcas) -> str:
    return ", ".join(_rotulo_marca(m) for m in sorted(set(marcas)))


def sem_cobertura(indicador: str, faltam: list[str], precisa_de: date, fator: int, dias: int,
                  erro: bool = False) -> SemComparacao:
    """Motivo de faltar comparacao. `precisa_de` = o dia mais velho que ela exige;
    `fator` = quantas janelas para tras (1 = foto de N dias atras ou a serie; 2 =
    soma da janela anterior). `a_partir_de` = coleta mais nova entre as lojas + fator x dias."""
    if erro:
        return SEM_FONTE_ERRO
    desde = max(_desde(indicador, m) for m in faltam)
    if precisa_de < desde:
        return SemComparacao(
            motivo=f"{FONTE_CURTA[indicador]} desde {desde.strftime('%d/%m')}",
            a_partir_de=desde + timedelta(days=fator * dias),
            detalhe=(f"O dado começa em {desde.strftime('%d/%m')} ({_rotulos(faltam)}): "
                     f"o período de comparação ainda não está coberto."))
    return SemComparacao(motivo="sem medida", a_partir_de=None,
                         detalhe=f"Sem medida no período de comparação: {_rotulos(faltam)}.")


def _sem_carga_parada(cortes: dict[str, date]) -> SemComparacao:
    """Loja com carga parada: o que veio depois do ultimo dia carregado nao e' medido."""
    dia = min(cortes.values())
    return SemComparacao(
        motivo=f"carga parada desde {dia.strftime('%d/%m')}", a_partir_de=None,
        detalhe=f"Carga parada desde {dia.strftime('%d/%m')} ({_rotulos(cortes)}): "
                f"o que veio depois não aparece.")


def _aplicar_comparacao(res: dict, *, janela: Janela, anterior: Janela, agora: datetime, hoje: date,
                        chat: ChatShopee, atendimento: CanalAtendimento, devolucoes: DevolucoesShopee,
                        lojas: list[str], cortes: Optional[dict[str, dict[str, date]]] = None) -> dict:
    """Preenche os `*_anterior` e devolve os campos da resposta (API-3).

    `cortes`: indicador -> marca -> ultimo dia carregado (carga parada). Dia
    depois dele sai None na serie, e o anterior da loja sai None (o periodo
    atual esta' incompleto: o delta seria falso)."""
    cortes = cortes or {}
    corte_ped = cortes.get("cancelamento", {})
    corte_dev = cortes.get("reembolso", {})
    n = janela.dias
    res = dict(res)
    for sufixo in ("", "_export"):
        if "comparacao" + sufixo in res:
            res.update(_separar_partes(res.pop("comparacao" + sufixo), sufixo, n <= 30))
    sem_anterior: dict[str, SemComparacao] = {}
    sem_serie: dict[str, SemComparacao] = {}

    # --- Cancelamento: o anterior ja' vem do `_canal_shopee` (Silver)
    linhas_at = list(atendimento.marcas)
    faltam = [l.marca for l in linhas_at if l.pedidos_anterior is None]
    if faltam:
        parados = {m: corte_ped[m] for m in faltam if m in corte_ped}
        erro = any(l.pedidos is None for l in linhas_at if l.marca in faltam)
        sem_anterior["cancelamento"] = (_sem_carga_parada(parados) if parados and not erro else
                                        sem_cobertura("cancelamento", faltam, anterior.inicio, 2, n, erro))

    # --- Reembolso: devolucoes aceitas e R$ por loja e dia
    dev_dia = _por_marca_dia(_juntar(res, "devolucoes"))
    linhas_dev = {l.marca: l for l in devolucoes.marcas} if devolucoes.estado == "dado" else {}

    def soma_dev(m: str, inicio: date, fim: date) -> tuple[Optional[int], Optional[float]]:
        """None = loja sem carga de devolucoes, consulta falhou ou periodo antes da coleta."""
        l = linhas_dev.get(m)
        if dev_dia is None or l is None or l.devolucoes is None or inicio < _desde("reembolso", m):
            return None, None
        if m in corte_dev and fim > corte_dev[m]:
            return None, None  # depois da ultima coleta: nao medido
        aceitas, valor, sem_valor = 0, 0.0, False
        for (marca, dia), r in dev_dia.items():
            if marca == m and dia is not None and inicio <= dia <= fim:
                q = _int(r.get("aceitas")) or 0
                aceitas += q
                if r.get("reembolsado") is not None:
                    valor += float(r["reembolsado"])
                elif q:
                    sem_valor = True  # aceita sem valor: o total e' desconhecido (nunca zero)
        return aceitas, (None if sem_valor else round(valor, 2))

    if devolucoes.estado == "dado":
        novas = []
        for l in devolucoes.marcas:
            a, v = (None, None) if l.marca in corte_dev else soma_dev(l.marca, anterior.inicio, anterior.fim)
            novas.append(l.model_copy(update={"aceitas_anterior": a, "reembolsado_anterior": v}))
        devolucoes = devolucoes.model_copy(update={"marcas": novas})
        faltam = [l.marca for l in novas if l.aceitas_anterior is None]
        if faltam:
            erro = dev_dia is None or any(l.devolucoes is None for l in novas if l.marca in faltam)
            parados = {m: corte_dev[m] for m in faltam if m in corte_dev}
            sem_anterior["reembolso"] = (_sem_carga_parada(parados) if parados and not erro else
                                         sem_cobertura("reembolso", faltam, anterior.inicio, 2, n, erro))
    elif lojas:
        sem_anterior["reembolso"] = (SEM_FONTE_ERRO if devolucoes.estado == "erro" else SemComparacao(
            motivo="sem devoluções", a_partir_de=None, detalhe=devolucoes.motivo_indisponivel))

    # --- Taxa de resposta (shopee_11): foto de N dias antes da foto atual.
    # NAO e' `metricas[].anterior` (o `last_period` da Shopee = foto do dia anterior).
    resp_dia = _por_marca_dia(_juntar(res, "resposta"))

    def resposta(m: str, dia: Optional[date]) -> Optional[float]:
        r = (resp_dia or {}).get((m, dia))
        return None if r is None or r.get("valor") is None else float(r["valor"])

    contas = [c.model_copy(update={"resposta_anterior_pct": resposta(c.marca, c.dia - timedelta(days=n))})
              for c in chat.contas]
    faltam = [c.marca for c in contas if c.resposta_anterior_pct is None] + [s.marca for s in chat.sem_foto]
    if faltam:
        sem_anterior["resposta"] = sem_cobertura("resposta", faltam, hoje - timedelta(days=n), 1, n,
                                                 resp_dia is None)

    # --- Contact rate: conversas na foto do chat de `agora - dias`
    nao_lidas = chat.nao_lidas
    if n > 30:
        sem_anterior["contact_rate"] = SEM_CONTACT_90
    elif lojas:
        fotos = _juntar(res, "chat")
        por_marca = {str(r.get("marca")): r for r in (fotos or [])}
        campo = "conversas_7d" if n == 7 else "conversas_30d"
        nao_lidas = [x.model_copy(update={"conversas_anterior": _int(por_marca.get(x.marca, {}).get(campo))})
                     for x in nao_lidas]
        com_chat = {x.marca for x in nao_lidas}
        faltam = [x.marca for x in nao_lidas if x.conversas_anterior is None] + \
                 [m for m in lojas if m not in com_chat]
        if faltam:
            sem_anterior["contact_rate"] = sem_cobertura(
                "contact_rate", faltam, (agora - timedelta(days=n)).astimezone(TZ_OPERACIONAL).date(), 1, n,
                fotos is None or chat.nao_lidas_estado == "erro")
    if lojas:
        sem_serie["contact_rate"] = SEM_SERIE_CONTACT
    chat = chat.model_copy(update={"contas": contas, "nao_lidas": nao_lidas})

    # --- Serie diaria: dia x loja; None = nao medido naquele dia
    ped_dia = _por_marca_dia(_juntar(res, "pedidos"))
    ped_ok = {l.marca for l in linhas_at if l.pedidos is not None}
    serie: list[PontoDiaShopee] = []
    falta = {"cancelamento": set(), "reembolso": set(), "resposta": set()}
    for i in range(n):
        dia = janela.inicio + timedelta(days=i)
        for m in lojas:
            ponto = {"dia": dia, "marca": m, "resposta_pct": resposta(m, dia)}
            depois_da_carga = m in corte_ped and dia > corte_ped[m]  # nao medido, nunca 0
            if (ped_dia is not None and m in ped_ok and dia >= _desde("cancelamento", m)
                    and not depois_da_carga):
                r = ped_dia.get((m, dia), {})  # fonte com historico: dia sem linha = zero medido
                ponto["pedidos"] = _int(r.get("pedidos")) or 0
                ponto["cancelamentos"] = _int(r.get("cancelados")) or 0
            ponto["devolucoes_aceitas"], ponto["reembolsado"] = soma_dev(m, dia, dia)
            if ponto.get("pedidos") is None:
                falta["cancelamento"].add(m)
            if ponto["devolucoes_aceitas"] is None or ponto.get("pedidos") is None:
                falta["reembolso"].add(m)
            if ponto["resposta_pct"] is None:
                falta["resposta"].add(m)
            serie.append(PontoDiaShopee(**ponto))
    erros = {"cancelamento": ped_dia is None, "reembolso": dev_dia is None or devolucoes.estado != "dado",
             "resposta": resp_dia is None}
    parados_serie = {"cancelamento": corte_ped, "reembolso": corte_dev}
    for ind, faltam in falta.items():
        if faltam:
            parados = {m: d for m, d in parados_serie.get(ind, {}).items() if m in faltam}
            sem_serie[ind] = (_sem_carga_parada(parados) if parados and not erros[ind] else
                              sem_cobertura(ind, list(faltam), janela.inicio, 1, n, erros[ind]))
    return {"chat": chat, "atendimento": atendimento, "devolucoes": devolucoes, "serie_diaria": serie,
            "sem_anterior": sem_anterior, "sem_serie": sem_serie}


consultar_torre_padrao = consultar_torre
