"""DRE gerencial por canal e marca — DRE-MVP-1.

Implementa o contrato `docs/dre_contrato_0.md` (PR #65). A unidade de calculo
e' a CELULA BASE `mes x canal x marca`; total, canal, marca e canal x marca sao
agregacoes dela, nunca calculos paralelos.

O QUE ESTE MODULO GARANTE, E POR QUE
-----------------------------------
- **Ausencia nunca vira zero.** Componente sem observacao tem `valor=None` e um
  `status` que diz por que. Zero so' aparece quando a fonte mediu zero.
- **Afiliado TikTok nunca e' somado.** Esta DENTRO do `fee_and_tax` do repasse
  (contrato §6: identidade do repasse em 100% das transacoes). Entra como
  decomposicao, `somavel=False`, e a margem so' soma componentes somaveis.
- **Comissao do ML entra uma vez**, como `taxas`, a partir de `total_fees` do
  mart. Nenhum outro componente a contem (`ad_spend` e `seller_shipping_cost`
  sao colunas separadas na mesma fonte).
- **Sinal normalizado num unico lugar** (`normalizar_custo`): ML e Shopee gravam
  custo positivo, o repasse TikTok grava negativo. Sinal inesperado nao e'
  corrigido com `abs()` — o componente sai como `sinal_inesperado`.
- **Nada aqui se chama margem liquida.** O melhor nivel possivel hoje e'
  "margem de contribuicao conhecida": devolucoes em valor nao tem fonte
  (contrato §1, §8). Impostos entram como REALIZADO (webgex, T-0069) so' onde
  foram publicados; sem publicacao, seguem indisponiveis.

FONTES — SO' O NEON (Gate DRE-DATA-BRIDGE-1)
-------------------------------------------
- `marts.fact_marketplace_daily_performance`: receita, taxas ML/Shopee, Ads,
  frete ML/Shopee.
- `marts.fact_tiktok_affiliate_cost_order_monthly`: afiliados TikTok.
- `marts.fact_tiktok_order_discounts_daily.buyer_shipping_fee` (T-0068): frete
  pago pelo comprador, subtraido do GMV TikTok na receita quando completo.
- `marts.fact_dre_insumo_mensal`: CMV fiscal e repasse TikTok por coorte,
  e (T-0059) a taxa da Shopee do escrow (`shopee_taxa_escrow`), que substitui
  o `total_fees` do mart quando ele nao cobre a celula (ver `_taxa_shopee_escrow`),
  e (T-0069) os impostos realizados do webgex (`imposto_icms`, `imposto_difal`,
  `imposto_pis_cofins`, ver `_impostos`), AGREGADOS e publicados pelo `pipelines.dre.insumo_publisher`, que e' o unico
  que le o Data Mart. A requisicao nunca toca o Data Mart: o Render nao o
  alcanca (Gate G4).

FALHA FECHADA
-------------
Insumo ausente (migration nao aplicada, competencia nao publicada, lote nao
concluido) ou vencido (publicado ha mais de `INSUMO_IDADE_MAXIMA`) torna o
componente indisponivel, com o motivo. Nao ha fallback: o `total_fees` TikTok
do mart esta congelado (contrato §4.5, §7) e nunca substitui o repasse.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import dre_premissas
from app.services.performance_service import BRAND_LABELS, ML_ID, SHOPEE_ID, TIKTOK_ID

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Vocabulario fechado
# ---------------------------------------------------------------------------
COMPLETA = "COMPLETA"
PARCIAL = "PARCIAL"
#: T-0090: mes imaturo (regra M+2) COM receita. Sai com valores e `fecha_em`.
PREVIA = "PREVIA"
#: T-0090: so' quando a receita e' nula.
NAO_CALCULAVEL = "NAO_CALCULAVEL"

#: Status de componente. `disponivel` entra como realizado; os de
#: `STATUS_PARCIAIS`, com valor, entram como parciais (T-0090).
DISPONIVEL = "disponivel"
COBERTURA_PARCIAL = "parcial"
INDISPONIVEL = "indisponivel"
SNAPSHOT_AUSENTE = "snapshot_ausente"
SNAPSHOT_VENCIDO = "snapshot_vencido"
NAO_RECONCILIADO = "nao_reconciliado"
NAO_CONFIRMADO = "nao_confirmado"
PROVISORIO = "provisorio"
SINAL_INESPERADO = "sinal_inesperado"
NAO_APLICAVEL = "nao_aplicavel"
#: T-0090: status com valor medido mas incompleto ou nao confirmado. Com valor,
#: o componente entra na margem conhecida como PARCIAL (decisao do Mario, 11/11).
STATUS_PARCIAIS = (COBERTURA_PARCIAL, NAO_CONFIRMADO, PROVISORIO, NAO_RECONCILIADO)

#: T-0090: `origem` de cada componente (celula e agregado).
ORIGEM_REALIZADO = "realizado"
ORIGEM_PARCIAL = "parcial"
ORIGEM_INDISPONIVEL = "indisponivel"
ORIGEM_NAO_APLICAVEL = "nao_aplicavel"
ORIGENS_NA_MARGEM = (ORIGEM_REALIZADO, ORIGEM_PARCIAL)
AVISO_MARGEM_PARCIAL = ("Margem conhecida inclui custos parciais ({}); custo não medido não entra, "
                        "então a margem tende a estar acima da real.")

CANAIS = ("tiktok", "ml", "shopee")
CANAL_LABEL = {"tiktok": "TikTok Shop", "ml": "Mercado Livre", "shopee": "Shopee"}
CANAL_POR_MKT = {TIKTOK_ID: "tiktok", ML_ID: "ml", SHOPEE_ID: "shopee"}
MKT_POR_CANAL = {v: k for k, v in CANAL_POR_MKT.items()}
#: `plataforma` da fonte fiscal para cada canal.
PLATAFORMA_FISCAL = {"tiktok": "tiktokshop", "ml": "mercadolivre", "shopee": "shopee"}

#: Ordem de exibicao. `afiliados` vem logo apos `taxas` porque e' decomposicao dela.
COMPONENTES = ("receita", "devolucoes", "taxas", "afiliados", "ads", "frete", "cmv", "impostos")
#: Custos que, quando `disponivel`, sao subtraidos da receita. Afiliado NAO esta aqui.
CUSTOS_SOMAVEIS = ("devolucoes", "taxas", "ads", "frete", "cmv", "impostos")
#: Sem estes tres, nao ha margem conhecida (contrato §8).
REQUISITOS_PARCIAL = ("receita", "taxas", "cmv")

#: Contrato §7 / D5: mes M so' fecha depois que M+2 terminou.
MESES_MATURACAO = 2
#: Contrato §8 / F7, C7: receita fiscal / GMV aceita para usar o CMV fiscal.
CMV_RAZAO_MIN = 0.95
CMV_RAZAO_MAX = 1.05
#: CMV integralmente provisorio = mes nao fechado na fonte fiscal (contrato §4.9).
CMV_PROVISORIO_INTEGRAL = 0.995
#: Cobertura minima do CMV (T-0055 C3): `cobertura` = receita com custo /
#: receita fiscal, como o publisher grava. Abaixo dela o CMV sai `parcial`
#: (fora da margem conhecida); o custo da parte descoberta NUNCA e' extrapolado.
#: 0,98 e' RECOMENDACAO PENDENTE DE DECISAO DO MARIO (FASE1, decisao E1).
COBERTURA_CMV_MINIMA = 0.98
#: T-0064: rotulo do trecho do `motivo` que o publisher de insumos grava no
#: CMV quando a numeracao de NF da marca tem buraco no mes. O CHECK de status
#: da 025 nao tem `parcial`, entao o estado viaja no texto. Mesma constante de
#: `pipelines.dre.insumo_publisher.BURACO_NF_MARCA` (um teste compara).
BURACO_NF_MARCA = "buraco de numeracao de NF em "
#: T-0069: rotulo dos trechos do `motivo` com que o publisher marca o imposto
#: como parcial (cobertura < 98%, Shopee, Rituaria out/26+). Mesma constante de
#: `pipelines.dre.insumo_publisher.IMPOSTO_PARCIAL` (um teste compara).
IMPOSTO_PARCIAL = "imposto parcial: "
#: Componente publicado -> nome da parte na resposta (`partes` da linha impostos).
PARTES_IMPOSTO = {"imposto_icms": "icms", "imposto_difal": "difal", "imposto_pis_cofins": "pis_cofins"}
#: Mesmo minimo do publisher (`IMPOSTO_COBERTURA_MINIMA`) e do CMV. Defesa em
#: profundidade: o publisher ja' rotula a celula abaixo dele.
COBERTURA_IMPOSTO_MINIMA = 0.98
#: Celula SEM imposto realizado publicado: o comportamento de antes da T-0069.
MOTIVO_IMPOSTOS_SEM_REALIZADO = "imposto realizado (webgex) ainda nao publicado para a celula: migration 040 pendente, sem NF casada ou impostos recusados no lote"
#: Residuo tolerado na identidade settlement = revenue + fee_and_tax + shipping.
#: Medido: 0,00 em 758.324 transacoes (contrato §6.1, P1).
RESIDUO_REPASSE_MAX = 1.0
#: Idade maxima de um lote de insumos, contada de `publicado_em` (marcado no
#: INICIO da publicacao). Passado isso o insumo e' tratado como vencido — nunca
#: exibido como atual.
#:
#: 54 h = 48 h + 6 h de folga (DRE-TTL-54, 21/10/2026). A DAG publica uma vez por
#: dia, as 10h BRT. Com 48 h, perder UM dia dava margem ~0: o lote de D vencia
#: no mesmo instante em que a execucao de D+2 comecava, e um retry (15 min) ou a
#: propria varredura ja deixavam a tela `vencido`. A folga cobre a execucao
#: seguinte com retries (3 x 15 min), varredura e atraso de agenda. Falha de UM
#: dia deixa de vencer a tela; o alerta de falha da DAG (goca-se/airflow#2089 +
#: listener global) avisa no primeiro dia. Ha' teste de paridade com `DRE_MAX_SNAPSHOT_HOURS` do Oraculo.
INSUMO_IDADE_MAXIMA = timedelta(hours=54)
TABELA_INSUMOS = "marts.fact_dre_insumo_mensal"

#: Sinal com que cada fonte grava custo. Medido no contrato §4.5/§4.8.
SINAL_FONTE = {
    ("taxas", "ml"): +1, ("taxas", "shopee"): +1, ("taxas", "tiktok"): -1,
    ("ads", "ml"): +1, ("ads", "shopee"): +1,
    ("frete", "ml"): +1, ("frete", "shopee"): +1, ("frete", "tiktok"): -1,
    ("afiliados", "tiktok"): -1,
    ("cmv", "ml"): +1, ("cmv", "shopee"): +1, ("cmv", "tiktok"): +1,
}

ROTULO_MARGEM = "Margem de contribuição conhecida"



# ---------------------------------------------------------------------------
# Utilitarios puros
# ---------------------------------------------------------------------------

def _num(v) -> float | None:
    if v is None:
        return None
    return float(Decimal(str(v)))


#: Fuso do negocio. Offset fixo: o Brasil nao tem horario de verao desde 2019.
TZ_BRT = timezone(timedelta(hours=-3), "BRT")


def data_brt(v) -> date | None:
    """Instante -> data no fuso do negocio; `date` passa intacta.

    `data_max_origem` do CMV e' a ultima EMISSAO fiscal (uma data), publicada
    como meia-noite BRT = 03:00 UTC. O contrato expoe `cmv_ultima_emissao`
    como `date`: entregar o instante fazia o Pydantic recusar a resposta
    inteira (500) assim que a primeira fotografia foi publicada.
    """
    if v is None:
        return None
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(TZ_BRT).date()
    return v


def _pct(valor: float | None, receita: float | None) -> float | None:
    if valor is None or not receita:
        return None
    return round(valor / receita * 100, 2)


def pct_br(fracao: float, casas: int = 1) -> str:
    """Fracao (0..1) -> "93,0%" (virgula decimal, para rotulo da tela)."""
    return f"{fracao * 100:.{casas}f}".replace(".", ",") + "%"


def origem_componente(valor: float | None, status: str) -> str:
    """T-0090: de onde vem o numero do componente.

    `realizado` = `disponivel` com valor; `parcial` = valor e status em
    `STATUS_PARCIAIS`; `nao_aplicavel`; o resto (sem valor, snapshot ausente ou
    vencido, sinal inesperado, indisponivel) e' `indisponivel`.
    """
    if status == NAO_APLICAVEL:
        return ORIGEM_NAO_APLICAVEL
    if valor is None:
        return ORIGEM_INDISPONIVEL
    if status == DISPONIVEL:
        return ORIGEM_REALIZADO
    if status in STATUS_PARCIAIS:
        return ORIGEM_PARCIAL
    return ORIGEM_INDISPONIVEL


def ultimo_dia(mes: date) -> date:
    prox = date(mes.year + (mes.month // 12), mes.month % 12 + 1, 1)
    return prox - timedelta(days=1)


def somar_meses(mes: date, n: int) -> date:
    total = mes.year * 12 + (mes.month - 1) + n
    return date(total // 12, total % 12 + 1, 1)


def mes_maduro(mes: date, hoje: date) -> bool:
    """Mes M e' maduro quando o mes M+MESES_MATURACAO ja terminou."""
    return hoje > ultimo_dia(somar_meses(mes, MESES_MATURACAO))


def competencia_madura_mais_recente(hoje: date) -> date:
    """Ultima competencia que `mes_maduro` aceita em `hoje`.

    E' o periodo padrao da DRE: o "mes anterior" dos outros endpoints nunca e'
    maduro pela regra M+2, e abriria a tela sempre NAO_CALCULAVEL.
    """
    return somar_meses(date(hoje.year, hoje.month, 1), -(MESES_MATURACAO + 1))


def meses_do_periodo(inicio: date, fim: date) -> list[date]:
    """Meses calendario cobertos. Exige periodo alinhado a meses inteiros."""
    if inicio.day != 1 or fim != ultimo_dia(date(fim.year, fim.month, 1)):
        raise ValueError(
            "A DRE e' mensal: o periodo precisa comecar no dia 1 e terminar no "
            "ultimo dia de um mes."
        )
    out, m = [], inicio
    while m <= fim:
        out.append(m)
        m = somar_meses(m, 1)
    return out


def normalizar_custo(componente: str, canal: str, valor: float | None) -> tuple[float | None, bool]:
    """Converte o valor da fonte em MAGNITUDE de custo (>= 0).

    Devolve `(magnitude, sinal_ok)`. Valor nulo continua nulo. Um valor com o
    sinal contrario ao medido para a fonte NAO e' corrigido: `sinal_ok=False`,
    e quem chama marca o componente como `sinal_inesperado`.
    """
    if valor is None:
        return None, True
    sinal = SINAL_FONTE[(componente, canal)]
    magnitude = valor * sinal
    if magnitude < -0.005:
        return None, False
    return max(magnitude, 0.0), True


# ---------------------------------------------------------------------------
# Insumos da celula base
# ---------------------------------------------------------------------------

@dataclass
class InsumosCelula:
    """Tudo o que a celula base `mes x canal x marca` precisa, ja lido.

    `cmv` e `repasse` vem de `marts.fact_dre_insumo_mensal`, ja agrupados por
    chave. `None` = nada publicado para a chave. Quando ha linha, `_estado`
    diz se ela pode ser usada (`ok`) ou por que nao (`snapshot_ausente`,
    `snapshot_vencido`), e `_motivo` explica.
    """

    mes: date
    canal: str
    marca: str
    mart: dict
    afiliado: dict | None = None
    cmv: dict | None = None
    repasse: dict | None = None
    #: Taxa da Shopee do escrow (T-0059), so' para celula Shopee. `None` = nada publicado.
    taxa_shopee: dict | None = None
    #: Impostos realizados do webgex (T-0069). `None` = nada publicado para a chave.
    impostos: dict | None = None
    motivo_sem_insumo: str = "competencia nao publicada em marts.fact_dre_insumo_mensal"
    #: T-0068, so' celula TikTok: frete pago pelo comprador nos dias com GMV
    #: (`ler_frete_comprador`). `None` = nada lido para a chave.
    frete_comprador: dict | None = None
    #: `False` = a coluna `buyer_shipping_fee` nao existe no Neon (041 nao aplicada).
    frete_comprador_coluna: bool = False


def _comp(valor=None, status=INDISPONIVEL, motivo=None, fonte=None, somavel=True, partes=None,
          data_as_of=None, publicado_em=None) -> dict:
    origem = origem_componente(valor, status)
    return {
        "valor": valor, "status": status, "motivo": motivo, "fonte": fonte,
        "somavel": somavel, "partes": partes, "data_as_of": data_as_of, "publicado_em": publicado_em,
        # So' o CMV preenche (T-0055 C3); nos demais componentes ficam nulos.
        "cobertura": None, "cmv_pct_receita_coberta": None,
        # T-0090. `_finalizar` recalcula `origem` e `entra_na_margem` depois que
        # o status final e' decidido (ex.: taxa da Shopee vira nao_confirmado).
        "origem": origem, "entra_na_margem": somavel and origem in ORIGENS_NA_MARGEM,
        "cobertura_rotulo": None,
    }


def _pct_coberto(custo: float | None, receita_com_custo: float | None) -> float | None:
    """CMV % sobre a receita COM custo: custo / receita_com_custo x 100.

    Denominador proprio, diferente de `pct_receita` (custo / GMV). Nulo quando
    falta o custo ou a receita com custo e' nula/zero — nunca 0%.
    """
    if custo is None or not receita_com_custo:
        return None
    return round(custo / receita_com_custo * 100, 2)


def _com_cobertura(comp: dict, custo: float | None, receita_fiscal: float | None,
                   cobertura: float | None) -> dict:
    """Anexa a cobertura publicada e o CMV % sobre a receita com custo.

    `receita_com_custo` = cobertura x receita fiscal (o publisher grava a razao,
    nao a receita; erro de arredondamento <= 5e-7 x receita). As chaves `_...`
    sao internas, para o agregado somar numerador e denominador; o contrato
    Pydantic as descarta.
    """
    rcc = cobertura * receita_fiscal if (cobertura is not None and receita_fiscal is not None) else None
    comp["cobertura"] = None if cobertura is None else round(cobertura, 6)
    comp["cmv_pct_receita_coberta"] = _pct_coberto(custo, rcc)
    comp["_receita_fiscal"] = receita_fiscal
    comp["_receita_com_custo"] = rcc
    return comp


def _bloqueio_do_insumo(insumo: dict | None, motivo_sem: str, fonte: str, somavel: bool = True) -> dict | None:
    """Componente indisponivel quando o insumo publicado nao pode ser usado. None = pode."""
    if insumo is None:
        return _comp(status=SNAPSHOT_AUSENTE, motivo=motivo_sem, fonte=fonte, somavel=somavel)
    if insumo["_estado"] != "ok":
        return _comp(status=insumo["_estado"], motivo=insumo["_motivo"], fonte=fonte, somavel=somavel,
                     data_as_of=insumo.get("data_as_of"), publicado_em=insumo.get("publicado_em"))
    return None


def _cobertura_diaria(n_valores: int, dias: int) -> str:
    if n_valores == 0:
        return INDISPONIVEL
    if n_valores < dias:
        return COBERTURA_PARCIAL
    return DISPONIVEL


def _custo_do_mart(componente: str, canal: str, soma, n_valores: int, n_negativos: int,
                   linhas: int, fonte: str, motivo_ausente: str, dias: int | None = None) -> dict:
    """Componente de custo lido de uma coluna diaria do mart.

    A cobertura e' medida contra o numero de LINHAS da celula (dia x loja), nao
    contra dias distintos: uma marca com duas lojas no canal tem duas linhas
    por dia, e comparar com dias faria uma coluna meio vazia parecer completa.
    `dias` (dias distintos da celula) so' escolhe a palavra do rotulo (T-0090).
    """
    status = _cobertura_diaria(int(n_valores or 0), linhas)
    if status == INDISPONIVEL:
        return _comp(status=INDISPONIVEL, motivo=motivo_ausente, fonte=fonte)
    sinal_fonte = SINAL_FONTE[(componente, canal)]
    # Para fontes que gravam positivo, qualquer dia negativo e' sinal inesperado.
    if sinal_fonte > 0 and int(n_negativos or 0) > 0:
        return _comp(status=SINAL_INESPERADO,
                     motivo=f"{n_negativos} dia(s) com valor negativo numa fonte que grava custo positivo",
                     fonte=fonte)
    magnitude, ok = normalizar_custo(componente, canal, _num(soma))
    if not ok:
        return _comp(status=SINAL_INESPERADO, motivo="soma com sinal contrario ao da fonte", fonte=fonte)
    if status == COBERTURA_PARCIAL:
        comp = _comp(valor=magnitude, status=COBERTURA_PARCIAL,
                     motivo=f"valor presente em {n_valores} de {linhas} linhas diarias", fonte=fonte)
        unidade = "dias" if dias == linhas else "linhas diárias"
        comp["cobertura_rotulo"] = f"presente em {n_valores} de {linhas} {unidade}"
        return comp
    return _comp(valor=magnitude, status=DISPONIVEL, fonte=fonte)


# ---------------------------------------------------------------------------
# Celula base
# ---------------------------------------------------------------------------

def montar_celula_base(ins: InsumosCelula, hoje: date) -> dict:
    """Aplica o contrato a uma celula `mes x canal x marca`. Funcao PURA."""
    canal, mart = ins.canal, ins.mart
    dias_mes = ultimo_dia(ins.mes).day
    dias = int(mart.get("dias") or 0)
    linhas = int(mart.get("linhas") or 0)
    avisos: list[str] = []
    motivos: list[str] = []
    comps: dict[str, dict] = {}

    # --- receita -----------------------------------------------------------
    # `gmv` fica guardado: a razao do CMV (receita fiscal / GMV) segue sobre o
    # GMV do mart, mesmo quando a receita TikTok sai sem o frete (T-0068).
    gmv = _num(mart.get("gmv"))
    receita = gmv
    fonte_receita = "marts.fact_marketplace_daily_performance.gmv"
    motivo_receita = None
    if canal == "tiktok":
        receita, fonte_receita, motivo_receita = _receita_tiktok_sem_frete(ins, gmv, fonte_receita, avisos)
    if receita is None:
        # T-0090: receita nula e' o UNICO caso NAO_CALCULAVEL; o status diz isso.
        comps["receita"] = _comp(status=INDISPONIVEL, fonte=fonte_receita, somavel=False,
                                 motivo="GMV nulo no mart: receita nao observada")
    elif dias >= dias_mes:
        comps["receita"] = _comp(valor=receita, status=DISPONIVEL, fonte=fonte_receita, somavel=False,
                                 motivo=motivo_receita)
    else:
        parcial = f"receita presente em {dias} de {dias_mes} dias do mes"
        comps["receita"] = _comp(valor=receita, status=COBERTURA_PARCIAL, fonte=fonte_receita, somavel=False,
                                 motivo=f"{parcial}; {motivo_receita}" if motivo_receita else parcial)
        comps["receita"]["cobertura_rotulo"] = f"presente em {dias} de {dias_mes} dias"

    # --- devolucoes: sem fonte servivel em nenhum canal ----------------------
    comps["devolucoes"] = _comp(motivo="sem fonte de devolucao/reembolso em valor (perguntas C6, F5)")
    # --- impostos: realizado do webgex quando publicado (T-0069) -------------
    comps["impostos"] = _impostos(ins)

    # --- taxas ---------------------------------------------------------------
    if canal in ("ml", "shopee"):
        fonte = "marts.fact_marketplace_daily_performance.total_fees"
        motivo_aus = ("comissao do ML nao carregada neste periodo" if canal == "ml"
                      else "taxa da Shopee ausente no mart")
        tx = _custo_do_mart("taxas", canal, mart.get("fees"), mart.get("fees_n"),
                            mart.get("fees_neg_n"), linhas, fonte, motivo_aus, dias=dias)
        if canal == "shopee" and tx["status"] == DISPONIVEL:
            tx["status"] = NAO_CONFIRMADO
            tx["motivo"] = "sem contraprova independente do repasse (pergunta C4)"
        elif canal == "shopee":
            tx = _taxa_shopee_escrow(ins.taxa_shopee, tx)
        comps["taxas"] = tx
    else:
        comps["taxas"] = _taxa_tiktok(ins, avisos)

    # --- afiliados -----------------------------------------------------------
    if canal == "tiktok":
        comps["afiliados"] = _afiliado_tiktok(ins.afiliado)
    elif canal == "ml":
        comps["afiliados"] = _comp(status=NAO_APLICAVEL, somavel=False, motivo="sem programa de afiliados medido no ML")
    else:
        comps["afiliados"] = _comp(somavel=False,
                                   motivo="nao verificado se esta dentro da comissao da Shopee (pergunta C3)")

    # --- ads -----------------------------------------------------------------
    if canal in ("ml", "shopee"):
        comps["ads"] = _custo_do_mart("ads", canal, mart.get("ads"), mart.get("ads_n"), mart.get("ads_neg_n"),
                                      linhas, "marts.fact_marketplace_daily_performance.ad_spend",
                                      "Ads ausente no mart", dias=dias)
    else:
        comps["ads"] = _comp(motivo="sem fonte de Ads do TikTok no mart")

    # --- frete do vendedor -----------------------------------------------------
    if canal == "ml":
        comps["frete"] = _custo_do_mart("frete", canal, mart.get("frete"), mart.get("frete_n"),
                                        mart.get("frete_neg_n"), linhas,
                                        "marts.fact_marketplace_daily_performance.seller_shipping_cost",
                                        "frete do vendedor ausente no mart", dias=dias)
    elif canal == "shopee":
        fr = _custo_do_mart("frete", canal, mart.get("frete"), mart.get("frete_n"), mart.get("frete_neg_n"),
                            linhas, "marts.fact_marketplace_daily_performance.seller_shipping_cost",
                            "frete ausente no mart", dias=dias)
        if fr["status"] in (DISPONIVEL, COBERTURA_PARCIAL):
            fr["status"] = NAO_CONFIRMADO
            fr["motivo"] = "'Valor estimado do frete' nao provado como custo do vendedor (pergunta C4)"
        comps["frete"] = fr
    else:
        comps["frete"] = _frete_tiktok(ins)

    # --- cmv -------------------------------------------------------------------
    comps["cmv"] = _cmv(ins, gmv, avisos)

    # --- guardrails de dupla contagem e classificacao -------------------------
    tx, af = comps["taxas"], comps["afiliados"]
    if canal == "tiktok" and tx["status"] == DISPONIVEL and af["valor"] is not None:
        if af["valor"] > tx["valor"] + 0.01:
            motivos.append("afiliado maior que a taxa do repasse: a premissa de inclusao falhou")
        else:
            avisos.append("Afiliados ja estao dentro das taxas do TikTok; exibidos so' como decomposicao.")

    if comps["receita"]["status"] != DISPONIVEL:
        motivos.append(f"receita incompleta: {comps['receita']['motivo']}")
    for req in ("taxas", "cmv"):
        c = comps[req]
        if c["status"] != DISPONIVEL:
            motivos.append(f"{req} {c['status']}: {c['motivo']}")
    maduro = mes_maduro(ins.mes, hoje)
    fecha_em = ultimo_dia(somar_meses(ins.mes, MESES_MATURACAO))
    if not maduro:
        motivos.append(
            f"mes imaturo: fecha apos {fecha_em.isoformat()} "
            f"(regra M+{MESES_MATURACAO}, decisao D5)"
        )

    # T-0090 (decisao do Mario, 11/11): a DRE sempre mostra numeros. Os motivos
    # continuam todos listados, como texto; so' a receita nula tira a margem.
    if comps["receita"]["valor"] is None:
        classificacao = NAO_CALCULAVEL
    elif not maduro:
        classificacao = PREVIA
    elif motivos or not all(comps[c]["status"] in (DISPONIVEL, NAO_APLICAVEL) for c in CUSTOS_SOMAVEIS):
        classificacao = PARCIAL
    else:
        classificacao = COMPLETA

    datas = {
        "receita_ultimo_dia": mart.get("max_date"),
        "mart_carregado_em": mart.get("ingested_at"),
        "cmv_ultima_emissao": data_brt((ins.cmv or {}).get("data_as_of")),
        "repasse_tiktok_atualizado_em": (ins.repasse or {}).get("data_as_of"),
        "insumo_publicado_em": max(
            (x["publicado_em"] for x in (ins.cmv, ins.repasse) if x and x.get("publicado_em")), default=None),
    }
    celula = {
        "mes": ins.mes.isoformat()[:7], "canal": canal, "marca": ins.marca,
        "componentes": comps, "classificacao": classificacao,
        "previa": classificacao == PREVIA,
        "fecha_em": fecha_em.isoformat() if classificacao == PREVIA else None,
        "motivos_classificacao": motivos, "avisos_qualidade": avisos, "data_maxima": datas,
    }
    return _finalizar(celula)


#: T-0059: taxa da Shopee do escrow publicada em `marts.fact_dre_insumo_mensal`.
FONTE_TAXA_SHOPEE_ESCROW = (f"{TABELA_INSUMOS}.shopee_taxa_escrow "
                            "(escrow da Shopee: comissao + servico + transacao, por coorte de pedido)")


def _taxa_shopee_escrow(esc: dict | None, do_mart: dict) -> dict:
    """Taxa da Shopee quando o mart NAO cobre todas as linhas da celula (T-0059).

    Desde o `daily_shopee` (22/10/2026) a fato diaria grava `total_fees` NULL
    nas lojas com API (apice, barbours, lescent, rituaria): a API de pedidos
    nao tem taxa. A taxa dessas lojas vem do escrow, publicada por mes.

    PRECEDENCIA (uma fonte por celula; nunca soma as duas):
      1. `total_fees` do mart em TODAS as linhas -> decidido antes de chegar
         aqui (kokeshi; meses anteriores ao corte);
      2. escrow publicado com valor -> valor do escrow. Cobertura (pedidos com
         escrow / pedidos nao cancelados) = 1 -> `nao_confirmado` (mesmo nivel
         da taxa do mart; C4 segue aberta); < 1 -> `parcial`, com o motivo. A
         parte sem escrow nunca e' extrapolada;
      3. escrow publicado mas inutilizavel (lote nao concluido/vencido) ->
         esse estado, com o motivo: falha fechada, como os demais insumos;
      4. sem escrow para a chave (nada publicado, ou `ausente_na_origem`) ->
         o resultado do mart como estava (`parcial`/`indisponivel`).
    """
    if esc is None or (esc["_estado"] == "ok" and esc.get("valor") is None):
        return do_mart
    fonte = FONTE_TAXA_SHOPEE_ESCROW
    if esc["_estado"] != "ok":
        return _comp(status=esc["_estado"], motivo=esc["_motivo"], fonte=fonte,
                     data_as_of=esc.get("data_as_of"), publicado_em=esc.get("publicado_em"))
    meta = {"fonte": fonte, "data_as_of": esc.get("data_as_of"), "publicado_em": esc.get("publicado_em")}
    if esc.get("sinal") != SINAL_FONTE[("taxas", "shopee")]:
        return _comp(status=SINAL_INESPERADO, motivo="convencao de sinal publicada diferente da esperada", **meta)
    magnitude, ok = normalizar_custo("taxas", "shopee", _num(esc["valor"]))
    if not ok:
        return _comp(status=SINAL_INESPERADO, motivo="soma do escrow com sinal contrario ao da fonte", **meta)
    cobertura = _num(esc.get("cobertura"))
    if cobertura is None or cobertura < 1:
        pct = "desconhecida" if cobertura is None else f"{cobertura * 100:.1f}%"
        comp = _comp(valor=magnitude, status=COBERTURA_PARCIAL,
                     motivo=f"escrow cobre {pct} dos pedidos nao cancelados ({esc.get('motivo')}); "
                            "a parte sem escrow nao e' estimada", **meta)
        # T-0090: fracao estruturada, para o rotulo e para o cenario estimado
        # extrapolar (so' la'; o realizado nunca extrapola). Interna: o contrato a descarta.
        comp["_cobertura_pedidos"] = cobertura
        if cobertura is not None:
            comp["cobertura_rotulo"] = f"escrow em {pct_br(cobertura)} dos pedidos"
        return comp
    return _comp(valor=magnitude, status=NAO_CONFIRMADO,
                 motivo="escrow da Shopee; sem contraprova independente do repasse (pergunta C4)", **meta)


#: T-0069: imposto sobre venda realizado, publicado em `marts.fact_dre_insumo_mensal`.
FONTE_IMPOSTOS_WEBGEX = (f"{TABELA_INSUMOS}.imposto_icms + imposto_difal + imposto_pis_cofins "
                         "(webgex VX/DB: ICMS, DIFAL e PIS+COFINS das NFs de venda casadas pela chave)")


def _impostos(ins: InsumosCelula) -> dict:
    """Linha `impostos` da celula (T-0069). Funcao PURA.

    PRECEDENCIA (uma fonte por celula; a premissa nunca entra no realizado):
      1. nada publicado para a chave, ou os tres componentes `ausente_na_origem`
         -> o comportamento de antes (`indisponivel`, sem valor). Nulo nao vira 0;
      2. publicado mas inutilizavel (lote nao concluido/vencido) -> esse estado,
         com o motivo: falha fechada, como os demais insumos;
      3. realizado -> valor = ICMS + DIFAL + PIS/COFINS (magnitude, custo >= 0),
         `partes` com os tres e `cobertura` da celula. `disponivel` (entra na
         margem) so' com os tres presentes, cobertura >= 98% e nenhum trecho
         `imposto parcial: ` no motivo. Senao `parcial`: o valor e' o medido,
         nada e' extrapolado, e fica FORA da margem conhecida (como o CMV).
         SUPOSICAO: faltando um ou dois componentes, soma-se o que existe e o
         motivo nomeia o que falta.
    """
    imp = ins.impostos
    if imp is None:
        return _comp(motivo=MOTIVO_IMPOSTOS_SEM_REALIZADO)
    fonte = FONTE_IMPOSTOS_WEBGEX
    meta = {"fonte": fonte, "data_as_of": imp.get("data_as_of"), "publicado_em": imp.get("publicado_em")}
    linhas = imp["linhas"]
    com_valor = {parte: r for parte, r in linhas.items() if r is not None and r.get("valor") is not None}
    if imp["_estado"] != "ok":
        return _comp(status=imp["_estado"], motivo=imp["_motivo"], **meta)
    if not com_valor:
        return _comp(motivo=MOTIVO_IMPOSTOS_SEM_REALIZADO)
    for parte, r in com_valor.items():
        if r.get("sinal_origem") != 1:
            return _comp(status=SINAL_INESPERADO, motivo=f"{parte}: convencao de sinal publicada diferente da esperada",
                         **meta)
        if _num(r["valor"]) < 0:
            return _comp(status=SINAL_INESPERADO, motivo=f"{parte} negativo", **meta)
    partes = {parte: (_num(com_valor[parte]["valor"]) if parte in com_valor else None)
              for parte in PARTES_IMPOSTO.values()}
    valor = sum(v for v in partes.values() if v is not None)
    coberturas = [_num(r.get("cobertura")) for r in com_valor.values()]
    cobertura = None if any(c is None for c in coberturas) else min(coberturas)

    motivos: list[str] = []
    faltam = [parte for parte, v in partes.items() if v is None]
    if faltam:
        motivos.append(f"sem {', '.join(faltam)} na origem (ausencia nao e' zero); soma so' do que existe")
    trechos: list[str] = []
    for r in com_valor.values():
        for t in (r.get("motivo") or "").split("; "):
            if t.startswith(IMPOSTO_PARCIAL) and t[len(IMPOSTO_PARCIAL):] not in trechos:
                trechos.append(t[len(IMPOSTO_PARCIAL):])
    motivos.extend(trechos)
    cob_txt = "desconhecida" if cobertura is None else f"{cobertura * 100:.2f}%"
    if cobertura is None or (cobertura < COBERTURA_IMPOSTO_MINIMA and not any("cobertura" in t for t in trechos)):
        motivos.append(f"imposto cobre {cob_txt} da receita fiscal (minimo {COBERTURA_IMPOSTO_MINIMA * 100:.0f}%)")
    if motivos:
        comp = _comp(valor=valor, status=COBERTURA_PARCIAL,
                     motivo="; ".join(motivos) + "; nada e' extrapolado", **meta)
        if cobertura is not None and cobertura < COBERTURA_IMPOSTO_MINIMA:
            comp["cobertura_rotulo"] = f"imposto em {pct_br(cobertura)} da receita fiscal"
    else:
        comp = _comp(valor=valor, status=DISPONIVEL,
                     motivo=f"imposto realizado (webgex): NFs casadas cobrem {cob_txt} da receita fiscal", **meta)
    comp["partes"] = partes
    comp["cobertura"] = None if cobertura is None else round(cobertura, 6)
    # Internas, para a cobertura do agregado (razao das somas). O contrato as descarta.
    rf = _num((ins.cmv or {}).get("receita_fiscal"))
    comp["_imp_receita_fiscal"] = rf
    comp["_imp_receita_casada"] = cobertura * rf if (cobertura is not None and rf is not None) else None
    return comp


def _impostos_agregados(destino: dict, partes: list[dict]) -> None:
    """`partes` e `cobertura` dos impostos num agregado. Funcao PURA.

    Partes: soma por imposto entre as celulas COM valor; nula se alguma delas
    nao tem a parte (nunca vira zero). Cobertura: razao das SOMAS (receita
    casada / receita fiscal), so' quando TODA celula aplicavel tem os dois.
    """
    com_valor = [p for p in partes if p["valor"] is not None]
    if com_valor and all(p.get("partes") for p in com_valor):
        destino["partes"] = {
            nome: (None if any(p["partes"].get(nome) is None for p in com_valor)
                   else round(sum(p["partes"][nome] for p in com_valor), 2))
            for nome in PARTES_IMPOSTO.values()
        }
    if partes and all(p["valor"] is not None and p.get("_imp_receita_fiscal") and
                      p.get("_imp_receita_casada") is not None for p in partes):
        rf = sum(p["_imp_receita_fiscal"] for p in partes)
        destino["cobertura"] = round(sum(p["_imp_receita_casada"] for p in partes) / rf, 6)


#: T-0068: frete pago pelo comprador do TikTok, por dia x marca.
TABELA_DESCONTOS_TIKTOK = "marts.fact_tiktok_order_discounts_daily"
FONTE_FRETE_COMPRADOR = f"{TABELA_DESCONTOS_TIKTOK}.buyer_shipping_fee"
MOTIVO_FRETE_COMPRADOR_AUSENTE = "receita TikTok inclui frete do comprador: buyer_shipping_fee ausente"


def _receita_tiktok_sem_frete(ins: InsumosCelula, gmv: float | None, fonte_gmv: str,
                              avisos: list[str]) -> tuple[float | None, str, str | None]:
    """Receita TikTok = GMV do mart − frete pago pelo comprador (T-0068, D6 opcao a).

    O GMV TikTok e' `SUM(total_amount)`, que contem o frete pago pelo
    comprador; o frete da DRE e' o `shipping_cost_amount` do repasse, que ja'
    vem LIQUIDO desse frete. Somar os dois conta o frete do comprador duas
    vezes a favor da margem. Aqui ele sai da receita.

    So' subtrai quando o dado existe: coluna presente e valor nao nulo em TODO
    dia do mes com GMV no mart. Faltando, devolve o GMV como antes, com o
    motivo `MOTIVO_FRETE_COMPRADOR_AUSENTE` — sem estimar a parte que falta.
    Devolve `(receita, fonte, motivo)`.
    """
    def ausente(detalhe: str) -> tuple[float | None, str, str]:
        avisos.append(f"Receita do TikTok inclui o frete pago pelo comprador ({detalhe}); ML e Shopee nao incluem.")
        return gmv, fonte_gmv, f"{MOTIVO_FRETE_COMPRADOR_AUSENTE} ({detalhe})"

    if gmv is None:
        return gmv, fonte_gmv, None
    if not ins.frete_comprador_coluna:
        return ausente(f"coluna nao existe em {TABELA_DESCONTOS_TIKTOK}; migration 041 nao aplicada")
    fr = ins.frete_comprador
    if fr is None or not fr.get("dias_com_gmv"):
        if gmv == 0:
            return gmv, fonte_gmv, None
        return ausente("nenhum dia com GMV encontrado na fato de descontos")
    dias_gmv = int(fr["dias_com_gmv"])
    faltam = dias_gmv - int(fr.get("dias_com_frete") or 0)
    if faltam > 0:
        return ausente(f"nulo ou sem linha em {faltam} de {dias_gmv} dias com GMV")
    frete = _num(fr.get("frete"))
    if frete is None or frete < 0:
        return ausente("soma do mes nula ou negativa")
    avisos.append(f"Receita do TikTok sem o frete pago pelo comprador (R$ {frete:.2f} no mes, {FONTE_FRETE_COMPRADOR}); "
                  "o frete liquido do repasse segue em frete.")
    return round(gmv - frete, 2), f"{fonte_gmv} − {FONTE_FRETE_COMPRADOR}", None


def _taxa_tiktok(ins: InsumosCelula, avisos: list[str]) -> dict:
    fonte = f"{TABELA_INSUMOS}.tiktok_taxa_repasse (repasse por coorte de pedido)"
    bloqueio = _bloqueio_do_insumo(ins.repasse, ins.motivo_sem_insumo, fonte)
    if bloqueio:
        return bloqueio
    rep = ins.repasse
    meta = {"fonte": fonte, "data_as_of": rep["data_as_of"], "publicado_em": rep["publicado_em"]}
    if rep.get("taxa") is None:
        return _comp(status=INDISPONIVEL, motivo="sem transacoes de repasse para a coorte na origem", **meta)
    if rep["status_taxa"] != "reconciliado":
        return _comp(status=NAO_RECONCILIADO, motivo=f"publicacao: {rep['motivo_taxa']}", **meta)
    residuo = abs(_num(rep.get("residuo")) or 0.0)
    if residuo > RESIDUO_REPASSE_MAX:
        return _comp(status=NAO_RECONCILIADO, motivo=f"identidade do repasse violada (residuo {residuo:.2f})", **meta)
    if (_num(rep.get("violacoes")) or 0) > 0:
        return _comp(status=NAO_RECONCILIADO, motivo="ha transacao com afiliado maior que a taxa", **meta)
    if rep.get("sinal_taxa") != SINAL_FONTE[("taxas", "tiktok")]:
        return _comp(status=SINAL_INESPERADO, motivo="convencao de sinal publicada diferente da esperada", **meta)
    magnitude, ok = normalizar_custo("taxas", "tiktok", _num(rep["taxa"]))
    if not ok:
        return _comp(status=SINAL_INESPERADO, motivo="fee_and_tax positivo na soma da coorte", **meta)
    mart_fees = _num(ins.mart.get("fees"))
    if mart_fees is not None and magnitude:
        div = (abs(mart_fees) / magnitude - 1) * 100
        if abs(div) >= 1.0:
            avisos.append(f"total_fees do mart diverge {div:+.1f}% do repasse; a DRE usa o repasse.")
    return _comp(valor=magnitude, status=DISPONIVEL, **meta)


def _frete_tiktok(ins: InsumosCelula) -> dict:
    fonte = f"{TABELA_INSUMOS}.tiktok_frete_repasse (repasse por coorte de pedido)"
    bloqueio = _bloqueio_do_insumo(ins.repasse, ins.motivo_sem_insumo, fonte)
    if bloqueio:
        return bloqueio
    rep = ins.repasse
    meta = {"fonte": fonte, "data_as_of": rep["data_as_of"], "publicado_em": rep["publicado_em"]}
    if rep.get("frete") is None:
        return _comp(status=INDISPONIVEL, motivo="sem transacoes de repasse para a coorte na origem", **meta)
    if rep["status_taxa"] != "reconciliado":
        return _comp(status=NAO_RECONCILIADO, motivo=f"publicacao: {rep['motivo_taxa']}", **meta)
    if rep.get("sinal_frete") != SINAL_FONTE[("frete", "tiktok")]:
        return _comp(status=SINAL_INESPERADO, motivo="convencao de sinal publicada diferente da esperada", **meta)
    magnitude, ok = normalizar_custo("frete", "tiktok", _num(rep["frete"]))
    if not ok:
        return _comp(status=SINAL_INESPERADO, motivo="shipping_cost positivo na soma da coorte", **meta)
    return _comp(valor=magnitude, status=DISPONIVEL, **meta)


def _afiliado_tiktok(af: dict | None) -> dict:
    fonte = "marts.fact_tiktok_affiliate_cost_order_monthly"
    if af is None:
        return _comp(somavel=False, fonte=fonte, motivo="sem lancamento de afiliado para o mes")
    nomes = ("creator", "partner", "ads")
    brutos = {n: _num(af.get(n)) for n in nomes}
    partes = {}
    for n, v in brutos.items():
        mag, ok = normalizar_custo("afiliados", "tiktok", v)
        if not ok:
            return _comp(status=SINAL_INESPERADO, somavel=False, fonte=fonte,
                         motivo=f"componente {n} positivo numa fonte assinada negativa")
        partes[n] = mag
    if any(v is None for v in partes.values()):
        return _comp(status=COBERTURA_PARCIAL, somavel=False, fonte=fonte, partes=partes,
                     motivo="algum componente ausente na fonte")
    return _comp(valor=sum(partes.values()), status=DISPONIVEL, somavel=False, fonte=fonte, partes=partes,
                 motivo="ja incluido em taxas (contrato §6); decomposicao, nao custo adicional")


def _cmv(ins: InsumosCelula, receita: float | None, avisos: list[str]) -> dict:
    fonte = f"{TABELA_INSUMOS}.cmv (CMV fiscal agregado)"
    bloqueio = _bloqueio_do_insumo(ins.cmv, ins.motivo_sem_insumo, fonte)
    if bloqueio:
        return bloqueio
    c = ins.cmv
    meta = {"fonte": fonte, "data_as_of": c["data_as_of"], "publicado_em": c["publicado_em"]}
    if c.get("custo") is None:
        return _comp(status=INDISPONIVEL, motivo="sem NF de venda para marca x plataforma x mes na origem", **meta)
    if c.get("sinal") != SINAL_FONTE[("cmv", ins.canal)]:
        return _comp(status=SINAL_INESPERADO, motivo="convencao de sinal publicada diferente da esperada", **meta)
    custo = _num(c["custo"])
    if custo < 0:
        return _comp(status=SINAL_INESPERADO, motivo="CMV negativo", **meta)
    receita_fiscal = _num(c.get("receita_fiscal"))
    cobertura = _num(c.get("cobertura"))
    razao_nf = (receita_fiscal / receita) if receita and receita_fiscal is not None else None

    def comp(status, motivo=None) -> dict:
        # Cobertura e CMV % coberto acompanham TODO estado com custo conhecido.
        out = _com_cobertura(_comp(valor=custo, status=status, motivo=motivo, **meta),
                             custo, receita_fiscal, cobertura)
        # T-0090: base estruturada do rotulo e do "NF cobre Y%" do cenario. Interna.
        out["_razao_nf_gmv"] = razao_nf
        if status != DISPONIVEL:
            partes = []
            if razao_nf is not None and not (CMV_RAZAO_MIN <= razao_nf <= CMV_RAZAO_MAX):
                partes.append(f"NF cobre {razao_nf * 100:.0f}% do GMV")
            if cobertura is not None and cobertura < COBERTURA_CMV_MINIMA:
                partes.append(f"custo em {pct_br(cobertura)} da receita fiscal")
            out["cobertura_rotulo"] = "; ".join(partes) or None
        return out

    # T-0064: buraco de numeracao de NF no mes = base fiscal incompleta (notas
    # nao ingeridas ou rejeitadas). Vem ANTES da razao com o GMV: o buraco e' a
    # causa conhecida de uma razao baixa, e o motivo carrega a razao publicada.
    buraco = next((p for p in (c.get("motivo") or "").split("; ") if p.startswith(BURACO_NF_MARCA)), None)
    if buraco:
        return comp(COBERTURA_PARCIAL,
                    f"{buraco}: notas ausentes da base fiscal (nao ingeridas ou rejeitadas); CMV e receita fiscal "
                    f"do mes incompletos, nada e' extrapolado (publicacao: {c['status']})")
    if c["status"] != "reconciliado":
        return comp(NAO_RECONCILIADO, f"publicacao: {c['motivo']} (pergunta F1/F7)")
    # A publicacao reconciliou contra o GMV DAQUELE instante. O GMV pode ter
    # mudado desde entao: a razao e' conferida de novo com o valor de agora.
    razao = razao_nf
    if razao is None or not (CMV_RAZAO_MIN <= razao <= CMV_RAZAO_MAX):
        txt = "sem receita para comparar" if razao is None else f"razao receita fiscal / GMV atual = {razao:.3f}"
        return comp(NAO_RECONCILIADO, f"{txt}; aceito entre {CMV_RAZAO_MIN} e {CMV_RAZAO_MAX} (pergunta F1/F7)")
    share = _num(c.get("provisorio_share")) or 0.0
    if share >= CMV_PROVISORIO_INTEGRAL:
        return comp(PROVISORIO, "CMV integralmente provisorio: mes nao fechado na fonte fiscal (pergunta F2)")
    if share > 0:
        avisos.append(f"{share * 100:.0f}% do CMV ainda e' provisorio na fonte fiscal.")
    avisos.append(f"CMV fiscal reconciliado: receita fiscal / GMV = {razao:.3f}.")
    # Cobertura (T-0055 C3): receita sem custo NAO tem custo zero. Abaixo do
    # minimo o CMV sai `parcial` (desde a T-0090 entra na margem conhecida como
    # parcial, com aviso), sem extrapolar a parte descoberta. Cobertura nao publicada mantem o estado de antes (nao e'
    # tratada como 100%): o campo sai nulo e um aviso diz por que.
    if cobertura is None:
        avisos.append("Cobertura do CMV nao publicada: CMV % sobre a receita com custo indisponivel.")
    elif cobertura < COBERTURA_CMV_MINIMA:
        return comp(COBERTURA_PARCIAL,
                    f"CMV cobre {cobertura * 100:.2f}% da receita fiscal (minimo {COBERTURA_CMV_MINIMA * 100:.0f}%); "
                    "custo ausente nao e' zero nem e' extrapolado")
    return comp(DISPONIVEL)


# ---------------------------------------------------------------------------
# Margem, completude e apresentacao
# ---------------------------------------------------------------------------

def _finalizar(celula: dict, agregado: dict | None = None) -> dict:
    """Calcula percentuais, origem, listas de disponivel/ausente, completude e margem.

    `agregado` (so' para agregacoes) traz a margem ja somada celula a celula e
    as listas de custos usados em TODAS / em ALGUMA celula (e os parciais).

    T-0090: entra na margem conhecida todo custo somavel com origem `realizado`
    ou `parcial`; a margem existe sempre que ha receita. Custo nao medido nao
    entra, entao com parciais a margem tende a estar ACIMA da real (`aviso`).
    """
    comps = celula["componentes"]
    receita = comps["receita"]["valor"]
    for nome, c in comps.items():
        c["pct_receita"] = _pct(c["valor"], receita)
        c["origem"] = origem_componente(c["valor"], c["status"])
        if agregado is None:
            c["entra_na_margem"] = (receita is not None and nome in CUSTOS_SOMAVEIS and bool(c["somavel"])
                                    and c["origem"] in ORIGENS_NA_MARGEM)
        else:
            c["entra_na_margem"] = nome in agregado["usados_em_alguma"]

    aplicaveis = [c for c in CUSTOS_SOMAVEIS if comps[c]["status"] != NAO_APLICAVEL]
    if agregado is None:
        usados = [c for c in CUSTOS_SOMAVEIS if comps[c]["entra_na_margem"]]
        usados_algum = list(usados)
        parciais = [c for c in usados if comps[c]["origem"] == ORIGEM_PARCIAL]
        valor = None if receita is None else receita - sum(comps[c]["valor"] for c in usados)
    else:
        usados = agregado["usados_em_todas"]
        usados_algum = agregado["usados_em_alguma"]
        parciais = agregado["parciais_em_alguma"]
        valor = agregado["margem"]
    celula["componentes_disponiveis"] = [c for c in COMPONENTES if comps[c]["status"] == DISPONIVEL]
    celula["componentes_ausentes"] = [
        {"componente": c, "status": comps[c]["status"], "motivo": comps[c]["motivo"]}
        for c in COMPONENTES
        if comps[c]["status"] not in (DISPONIVEL, NAO_APLICAVEL)
    ]
    # No agregado, `usados` conta os custos que entraram em TODAS as celulas;
    # `parciais` conta, entre eles, os que foram parciais em alguma.
    n_parciais = len([c for c in usados if c in parciais])
    texto = f"{len(usados)} de {len(aplicaveis)} custos"
    if n_parciais:
        texto += f" ({n_parciais} {'parcial' if n_parciais == 1 else 'parciais'})"
    celula["completude"] = {
        "usados": len(usados), "aplicaveis": len(aplicaveis), "parciais": n_parciais, "texto": texto,
    }

    faltam = [c for c in aplicaveis if c not in usados]
    if valor is None or receita is None:
        celula["margem_contribuicao_conhecida"] = {
            "valor": None, "pct_receita": None, "rotulo": ROTULO_MARGEM,
            "formula": None, "componentes_usados": [], "componentes_parciais": [],
            "faltam": faltam, "aviso": None,
        }
        return celula
    if agregado is not None and usados_algum != usados:
        formula = ("soma, celula a celula (mes x canal x marca), de: receita − custos que entram na margem "
                   "na celula (realizados e parciais)")
    else:
        formula = " − ".join(["receita"] + list(usados))
    celula["margem_contribuicao_conhecida"] = {
        "valor": round(valor, 2),
        "pct_receita": _pct(valor, receita),
        "rotulo": ROTULO_MARGEM,
        "formula": formula,
        "componentes_usados": usados_algum,
        "componentes_parciais": list(parciais),
        "faltam": faltam,
        "aviso": AVISO_MARGEM_PARCIAL.format(", ".join(parciais)) if parciais else None,
    }
    return celula


def _cobertura_agregada(destino: dict, partes: list[dict]) -> None:
    """Cobertura e CMV % coberto de um agregado: razao das SOMAS, nunca media de razoes.

    So' sai quando TODA celula aplicavel tem custo, receita fiscal e cobertura;
    senao fica nula — uma celula sem cobertura nao vira 100% nem e' ignorada.
    """
    if not partes or any(p["valor"] is None or p.get("_receita_fiscal") is None
                         or p.get("_receita_com_custo") is None for p in partes):
        return
    receita_fiscal = sum(p["_receita_fiscal"] for p in partes)
    receita_com_custo = sum(p["_receita_com_custo"] for p in partes)
    destino["cobertura"] = round(receita_com_custo / receita_fiscal, 6) if receita_fiscal else None
    destino["cmv_pct_receita_coberta"] = _pct_coberto(sum(p["valor"] for p in partes), receita_com_custo)


#: Ordem de pior entre celulas COM receita (T-0090). NAO_CALCULAVEL fica fora:
#: o agregado so' e' NAO_CALCULAVEL quando TODAS as celulas o sao.
_ORDEM_PIOR = {PREVIA: 0, PARCIAL: 1, COMPLETA: 2}


def _rotulo_agregado(nome: str, aplic: list[tuple[dict, dict]], receita_total: float | None) -> str | None:
    """`cobertura_rotulo` de um componente agregado com origem parcial (T-0090).

    Uma celula so': o rotulo dela. Varias: a fatia da receita (das celulas com
    receita) em que o componente e' realizado e, se houver, a fatia parcial.
    """
    if len(aplic) == 1:
        return aplic[0][0].get("cobertura_rotulo")
    if nome == "receita":
        completas = sum(1 for p, _ in aplic if p["status"] == DISPONIVEL)
        return f"{completas} de {len(aplic)} células com receita do mês inteiro"
    if not receita_total:
        return None

    def fatia(origem: str) -> float:
        return sum(c["componentes"]["receita"]["valor"] or 0.0 for p, c in aplic if p.get("origem") == origem)

    rotulo = f"{pct_br(fatia(ORIGEM_REALIZADO) / receita_total)} da receita com dado realizado"
    parcial = fatia(ORIGEM_PARCIAL)
    if parcial:
        rotulo += f", {pct_br(parcial / receita_total)} com dado parcial"
    return rotulo


def agregar(celulas: list[dict], **chave) -> dict | None:
    """Agrega celulas base (soma de valores, pior classificacao).

    Regras:
    - componente `disponivel` no agregado so' se `disponivel` em TODAS as
      celulas onde e' aplicavel; senao `parcial` (com o valor conhecido e a
      cobertura sobre a receita) ou o status comum quando nenhuma tem valor;
    - classificacao (T-0090): NAO_CALCULAVEL so' se TODAS as celulas o forem;
      senao a pior entre as que tem receita (PREVIA < PARCIAL < COMPLETA).
      Celula sem receita aparece em `motivos_classificacao`;
    - margem e' a SOMA das margens das celulas que tem margem. Usar so' os
      custos presentes em todas as celulas descartaria custo conhecido (ex.:
      Ads do ML ao agregar com o TikTok, que nao tem Ads) e superestimaria a
      margem. `faltam` lista o que faltou em pelo menos uma celula.
    """
    if not celulas:
        return None
    com_receita = [c for c in celulas if c["componentes"]["receita"]["valor"] is not None]
    receita_total = sum(c["componentes"]["receita"]["valor"] for c in com_receita) if com_receita else None
    comps: dict[str, dict] = {}
    for nome in COMPONENTES:
        parts = [c["componentes"][nome] for c in celulas]
        aplic = [(p, c) for p, c in zip(parts, celulas) if p["status"] != NAO_APLICAVEL]
        somavel = parts[0]["somavel"]
        if not aplic:
            comps[nome] = _comp(status=NAO_APLICAVEL, somavel=somavel, motivo=parts[0]["motivo"])
            continue
        com_valor = [(p, c) for p, c in aplic if p["valor"] is not None]
        valor = sum(p["valor"] for p, _ in com_valor) if com_valor else None
        status_set = {p["status"] for p, _ in aplic}
        if status_set == {DISPONIVEL}:
            comps[nome] = _comp(valor=valor, status=DISPONIVEL, somavel=somavel)
        elif len(status_set) == 1:
            unico = aplic[0][0]
            comps[nome] = _comp(valor=valor, status=unico["status"], somavel=somavel, motivo=unico["motivo"])
        else:
            rec_ok = sum((c["componentes"]["receita"]["valor"] or 0.0)
                         for p, c in aplic if p["status"] == DISPONIVEL)
            cob = _pct(rec_ok, receita_total)
            comps[nome] = _comp(
                valor=valor, status=COBERTURA_PARCIAL, somavel=somavel,
                motivo=f"disponivel em celulas que somam {cob}% da receita; status: {', '.join(sorted(status_set))}",
            )
        if origem_componente(comps[nome]["valor"], comps[nome]["status"]) == ORIGEM_PARCIAL:
            comps[nome]["cobertura_rotulo"] = _rotulo_agregado(nome, aplic, receita_total)
        # Datas do insumo publicado: a MAIS ANTIGA entre as celulas. Um agregado
        # nunca pode parecer mais fresco que a sua parcela mais velha.
        for chave_data in ("data_as_of", "publicado_em"):
            datas = [p[chave_data] for p, _ in aplic if p.get(chave_data) is not None]
            comps[nome][chave_data] = min(datas) if datas else None
        if nome == "cmv":
            _cobertura_agregada(comps[nome], [p for p, _ in aplic])
        if nome == "impostos":
            _impostos_agregados(comps[nome], [p for p, _ in aplic])
    rec_status = {c["componentes"]["receita"]["status"] for c in celulas}
    if receita_total is None:
        comps["receita"] = _comp(status=INDISPONIVEL, somavel=False, motivo="nenhuma celula com receita")
    else:
        rec_ok = rec_status == {DISPONIVEL}
        comps["receita"] = _comp(valor=receita_total, status=DISPONIVEL if rec_ok else COBERTURA_PARCIAL,
                                 somavel=False)
        if not rec_ok:
            comps["receita"]["cobertura_rotulo"] = _rotulo_agregado(
                "receita", [(c["componentes"]["receita"], c) for c in celulas], receita_total)

    com_classe = [c["classificacao"] for c in celulas if c["classificacao"] != NAO_CALCULAVEL]
    classificacao = min(com_classe, key=_ORDEM_PIOR.get) if com_classe else NAO_CALCULAVEL
    motivos = []
    for c in celulas:
        prefixo = f"{c['mes']} {c['canal']} {c['marca']}"
        if c["classificacao"] == NAO_CALCULAVEL:
            motivos.append(f"{prefixo}: sem receita")
        for m in c["motivos_classificacao"]:
            motivos.append(f"{prefixo}: {m}")
    avisos = []
    for c in celulas:
        for a in c["avisos_qualidade"]:
            if a not in avisos:
                avisos.append(a)
    datas: dict[str, Any] = {}
    for c in celulas:
        for k, v in c["data_maxima"].items():
            if v is not None and (datas.get(k) is None or v > datas[k]):
                datas[k] = v
        for k in c["data_maxima"]:
            datas.setdefault(k, None)

    com_margem = [c["margem_contribuicao_conhecida"] for c in celulas
                  if c["margem_contribuicao_conhecida"]["valor"] is not None]
    usados_cel = [m["componentes_usados"] for m in com_margem]
    parciais_cel = [m["componentes_parciais"] for m in com_margem]
    agregado = {
        "usados_em_todas": [n for n in CUSTOS_SOMAVEIS if usados_cel and all(n in u for u in usados_cel)],
        "usados_em_alguma": [n for n in CUSTOS_SOMAVEIS if any(n in u for u in usados_cel)],
        "parciais_em_alguma": [n for n in CUSTOS_SOMAVEIS if any(n in p for p in parciais_cel)],
        "margem": sum(m["valor"] for m in com_margem) if com_margem else None,
    }
    fechas = [c["fecha_em"] for c in celulas if c.get("fecha_em")]
    out = {
        **chave, "componentes": comps, "classificacao": classificacao,
        "previa": classificacao == PREVIA, "fecha_em": max(fechas) if fechas else None,
        "motivos_classificacao": motivos, "avisos_qualidade": avisos, "data_maxima": datas,
        "celulas": len(celulas),
    }
    return _finalizar(out, agregado=agregado)


# ---------------------------------------------------------------------------
# Leitura — Neon
# ---------------------------------------------------------------------------

SQL_MART = """
    SELECT
        date_trunc('month', f.date)::date               AS mes,
        f.marketplace_id                                AS marketplace_id,
        l.brand_key                                     AS marca,
        COUNT(DISTINCT f.date)                          AS dias,
        COUNT(*)                                        AS linhas,
        SUM(f.gmv)                                      AS gmv,
        SUM(f.total_fees)                               AS fees,
        COUNT(f.total_fees)                             AS fees_n,
        COUNT(*) FILTER (WHERE f.total_fees < 0)        AS fees_neg_n,
        SUM(f.ad_spend)                                 AS ads,
        COUNT(f.ad_spend)                               AS ads_n,
        COUNT(*) FILTER (WHERE f.ad_spend < 0)          AS ads_neg_n,
        SUM(f.seller_shipping_cost)                     AS frete,
        COUNT(f.seller_shipping_cost)                   AS frete_n,
        COUNT(*) FILTER (WHERE f.seller_shipping_cost < 0) AS frete_neg_n,
        MAX(f.date)                                     AS max_date,
        MAX(f.ingested_at)                              AS ingested_at
    FROM marts.fact_marketplace_daily_performance f
    JOIN marts.dim_loja l ON l.loja_id = f.loja_id
    WHERE f.date BETWEEN :inicio AND :fim
      AND f.marketplace_id = ANY(:mkt_ids)
      AND l.brand_key = ANY(:marcas)
    GROUP BY 1, 2, 3
"""

SQL_AFILIADO = """
    SELECT ref_month AS mes, brand AS marca,
           affiliate_creator_commission AS creator,
           affiliate_partner_commission AS partner,
           affiliate_ads_commission     AS ads
    FROM marts.fact_tiktok_affiliate_cost_order_monthly
    WHERE ref_month BETWEEN :inicio AND :fim
      AND brand = ANY(:marcas)
"""


def ler_neon(db: Session, inicio: date, fim: date, mkt_ids: list[int], marcas: list[str]) -> tuple[list[dict], list[dict]]:
    params = {"inicio": inicio, "fim": fim, "mkt_ids": mkt_ids, "marcas": marcas}
    mart = [dict(r) for r in db.execute(text(SQL_MART), params).mappings().all()]
    afiliado = []
    if TIKTOK_ID in mkt_ids:
        afiliado = [dict(r) for r in db.execute(text(SQL_AFILIADO), params).mappings().all()]
    return mart, afiliado


#: T-0068. `pg_attribute` (nao `information_schema`, que filtra por privilegio);
#: `to_regclass` devolve NULL sem a tabela, sem envenenar a transacao.
SQL_FRETE_COMPRADOR_EXISTE = """
    SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('marts.fact_tiktok_order_discounts_daily')
          AND attname = 'buyer_shipping_fee'
          AND NOT attisdropped
    )
"""

#: Frete do comprador SO' nos dias em que o mart tem GMV TikTok nao nulo e
#: diferente de zero: e' a receita de que ele sera' subtraido. Mesmo relogio
#: dos dois lados (`created_at::date` do pedido). `dias_com_frete` conta so'
#: valor nao nulo; dia com GMV sem linha na fato conta como ausente.
SQL_FRETE_COMPRADOR = """
    WITH dias_com_gmv AS (
        SELECT f.date AS ref_date, l.brand_key AS marca
        FROM marts.fact_marketplace_daily_performance f
        JOIN marts.dim_loja l ON l.loja_id = f.loja_id
        WHERE f.date BETWEEN :inicio AND :fim
          AND f.marketplace_id = :mkt_id
          AND l.brand_key = ANY(:marcas)
        GROUP BY 1, 2
        HAVING SUM(f.gmv) <> 0
    )
    SELECT date_trunc('month', d.ref_date)::date AS mes,
           d.marca                                AS marca,
           COUNT(*)                               AS dias_com_gmv,
           COUNT(t.buyer_shipping_fee)            AS dias_com_frete,
           SUM(t.buyer_shipping_fee)              AS frete
    FROM dias_com_gmv d
    LEFT JOIN marts.fact_tiktok_order_discounts_daily t
           ON t.ref_date = d.ref_date AND t.brand = d.marca
    GROUP BY 1, 2
"""


@dataclass
class LeituraFreteComprador:
    coluna_existe: bool
    linhas: list[dict] = field(default_factory=list)


def ler_frete_comprador(db: Session, inicio: date, fim: date, marcas: list[str]) -> LeituraFreteComprador:
    """Frete pago pelo comprador TikTok por mes x marca (T-0068).

    Coluna ausente (migration 041 nao aplicada) nao e' erro: `coluna_existe=False`
    e a receita TikTok sai como antes, com motivo.
    """
    if db.execute(text(SQL_FRETE_COMPRADOR_EXISTE)).scalar() is not True:
        return LeituraFreteComprador(coluna_existe=False)
    rows = db.execute(text(SQL_FRETE_COMPRADOR), {"inicio": inicio, "fim": fim, "mkt_id": TIKTOK_ID,
                                                  "marcas": marcas}).mappings().all()
    return LeituraFreteComprador(coluna_existe=True, linhas=[dict(r) for r in rows])


def marcas_ativas(db: Session) -> list[str]:
    return sorted(db.execute(text("SELECT brand_key FROM marts.dim_loja WHERE ativo")).scalars().all())


# ---------------------------------------------------------------------------
# Leitura — insumos publicados (Neon)
# ---------------------------------------------------------------------------

SQL_INSUMOS_EXISTE = "SELECT to_regclass('marts.fact_dre_insumo_mensal') IS NOT NULL"

SQL_INSUMOS = """
    SELECT i.competencia, i.canal, i.marca, i.componente, i.valor, i.sinal_origem,
           i.cobertura, i.provisorio_share, i.status_reconciliacao, i.motivo,
           i.data_max_origem, i.publicado_em, i.lote_id, a.status AS lote_status
    FROM marts.fact_dre_insumo_mensal i
    LEFT JOIN audit.source_sync_run a ON a.sync_run_id = i.lote_id
    WHERE i.competencia BETWEEN :inicio AND :fim
      AND i.canal = ANY(:canais)
      AND i.marca = ANY(:marcas)
"""


@dataclass
class LeituraInsumos:
    tabela_existe: bool
    linhas: list[dict] = field(default_factory=list)


def ler_insumos(db: Session, inicio: date, fim: date, canais: list[str], marcas: list[str]) -> LeituraInsumos:
    """Le os insumos publicados. Tabela ausente (migration 025 nao aplicada) nao
    e' erro: devolve `tabela_existe=False` e os componentes saem
    `snapshot_ausente`. `to_regclass` evita uma excecao que envenenaria a
    transacao da sessao."""
    if not db.execute(text(SQL_INSUMOS_EXISTE)).scalar():
        return LeituraInsumos(tabela_existe=False)
    rows = db.execute(text(SQL_INSUMOS), {"inicio": inicio, "fim": fim, "canais": canais,
                                          "marcas": marcas}).mappings().all()
    return LeituraInsumos(tabela_existe=True, linhas=[dict(r) for r in rows])


def _estado_do_lote(linhas: list[dict], agora: datetime) -> tuple[str, str | None]:
    """`ok`, ou o estado que torna o insumo inutilizavel e o motivo."""
    if any(r.get("lote_status") != "success" for r in linhas):
        return SNAPSHOT_AUSENTE, "lote de publicacao nao concluido com sucesso"
    publicado = min(r["publicado_em"] for r in linhas)
    if agora - publicado > INSUMO_IDADE_MAXIMA:
        return SNAPSHOT_VENCIDO, (
            f"publicado em {publicado.isoformat()}; limite de {int(INSUMO_IDADE_MAXIMA.total_seconds() // 3600)} h"
        )
    return "ok", None


def indexar_insumos(linhas: list[dict], agora: datetime) -> tuple[dict, dict]:
    """Agrupa as linhas publicadas em insumo de CMV e de repasse por chave."""
    por_chave: dict[tuple, dict[str, dict]] = {}
    for r in linhas:
        k = (_chave_mes(r["competencia"]), r["canal"], r["marca"])
        por_chave.setdefault(k, {})[r["componente"]] = r
    cmv, repasse = {}, {}
    for k, comps in por_chave.items():
        if "cmv" in comps:
            c, rf = comps["cmv"], comps.get("cmv_receita_fiscal") or {}
            grupo = [x for x in (c, rf) if x]
            estado, motivo = _estado_do_lote(grupo, agora)
            cmv[k] = {
                "_estado": estado, "_motivo": motivo,
                "custo": c["valor"], "receita_fiscal": rf.get("valor"), "sinal": c["sinal_origem"],
                "provisorio_share": c["provisorio_share"], "cobertura": c.get("cobertura"),
                "status": c["status_reconciliacao"],
                "motivo": c["motivo"], "data_as_of": c["data_max_origem"], "publicado_em": c["publicado_em"],
                "lote_id": c["lote_id"],
            }
        if "tiktok_taxa_repasse" in comps:
            tx = comps["tiktok_taxa_repasse"]
            frete = comps.get("tiktok_frete_repasse") or {}
            estado, motivo = _estado_do_lote(list(comps.values()), agora)
            repasse[k] = {
                "_estado": estado, "_motivo": motivo,
                "taxa": tx["valor"], "sinal_taxa": tx["sinal_origem"], "status_taxa": tx["status_reconciliacao"],
                "motivo_taxa": tx["motivo"],
                "frete": frete.get("valor"),
                "sinal_frete": frete.get("sinal_origem"),
                "residuo": (comps.get("tiktok_residuo_identidade") or {}).get("valor"),
                "violacoes": (comps.get("tiktok_tx_afiliado_maior_taxa") or {}).get("valor"),
                "data_as_of": tx["data_max_origem"], "publicado_em": tx["publicado_em"], "lote_id": tx["lote_id"],
            }
    return cmv, repasse


def indexar_taxa_shopee(linhas: list[dict], agora: datetime) -> dict:
    """Taxa da Shopee do escrow (`shopee_taxa_escrow`, T-0059) por chave.

    Funcao propria para nao mudar a forma de `indexar_insumos`. O estado do
    lote e' o da propria linha (mesma regra de `_estado_do_lote`).
    """
    out = {}
    for r in linhas:
        if r["componente"] != "shopee_taxa_escrow":
            continue
        estado, motivo = _estado_do_lote([r], agora)
        out[(_chave_mes(r["competencia"]), r["canal"], r["marca"])] = {
            "_estado": estado, "_motivo": motivo,
            "valor": r["valor"], "sinal": r["sinal_origem"], "cobertura": r.get("cobertura"),
            "status": r["status_reconciliacao"], "motivo": r["motivo"],
            "data_as_of": r["data_max_origem"], "publicado_em": r["publicado_em"], "lote_id": r["lote_id"],
        }
    return out


def indexar_impostos(linhas: list[dict], agora: datetime) -> dict:
    """Impostos realizados (T-0069) por chave: `{"linhas": {parte: linha|None}, ...}`.

    Funcao propria, como `indexar_taxa_shopee`. O estado do lote e' o das
    linhas de imposto da chave (mesma regra de `_estado_do_lote`).
    """
    por_chave: dict[tuple, dict[str, dict]] = {}
    for r in linhas:
        parte = PARTES_IMPOSTO.get(r["componente"])
        if parte is not None:
            por_chave.setdefault((_chave_mes(r["competencia"]), r["canal"], r["marca"]), {})[parte] = r
    out = {}
    for k, partes in por_chave.items():
        rows = list(partes.values())
        estado, motivo = _estado_do_lote(rows, agora)
        datas = [r["data_max_origem"] for r in rows if r.get("data_max_origem") is not None]
        out[k] = {
            "_estado": estado, "_motivo": motivo,
            "linhas": {parte: partes.get(parte) for parte in PARTES_IMPOSTO.values()},
            "data_as_of": max(datas) if datas else None,
            "publicado_em": min(r["publicado_em"] for r in rows),
        }
    return out


def resumo_insumos(leitura: LeituraInsumos, agora: datetime) -> dict:
    if not leitura.tabela_existe:
        return {"estado": "tabela_ausente", "publicado_em": None,
                "publicado_em_mais_antigo": None, "publicado_em_mais_recente": None,
                "motivo": "marts.fact_dre_insumo_mensal nao existe (migration 025 nao aplicada)"}
    if not leitura.linhas:
        return {"estado": "nao_publicado", "publicado_em": None,
                "publicado_em_mais_antigo": None, "publicado_em_mais_recente": None,
                "motivo": "nenhum insumo publicado para o periodo"}
    # `publicado_em` e' a publicacao MAIS ANTIGA do conjunto: referencia
    # conservadora. Mostrar so' o lote mais novo esconderia a parte velha.
    mais_antigo = min(r["publicado_em"] for r in leitura.linhas)
    mais_recente = max(r["publicado_em"] for r in leitura.linhas)
    vencidas = sum(1 for r in leitura.linhas if agora - r["publicado_em"] > INSUMO_IDADE_MAXIMA)
    estado = "ok" if vencidas == 0 else ("vencido" if vencidas == len(leitura.linhas) else "parcialmente_vencido")
    return {"estado": estado, "publicado_em": mais_antigo, "publicado_em_mais_antigo": mais_antigo,
            "publicado_em_mais_recente": mais_recente, "motivo": None if estado == "ok" else
            f"{vencidas} de {len(leitura.linhas)} linhas publicadas ha mais de "
            f"{int(INSUMO_IDADE_MAXIMA.total_seconds() // 3600)} h"}


# ---------------------------------------------------------------------------
# Orquestracao
# ---------------------------------------------------------------------------

def _chave_mes(v) -> date:
    if isinstance(v, datetime):
        v = v.date()
    return date(v.year, v.month, 1)


# ---------------------------------------------------------------------------
# Leitura — premissas estimadas (Neon, DRE-PREMISSAS-1)
# ---------------------------------------------------------------------------

SQL_PREMISSAS_EXISTE = f"SELECT to_regclass('{dre_premissas.TABELA_PREMISSAS}') IS NOT NULL"

#: So' a competencia exata do periodo: a premissa nunca e' estendida a outro mes.
SQL_PREMISSAS = f"""
    SELECT p.competencia, p.brand, p.component, p.rate, p.somavel, p.status, p.source_period,
           p.source_sha256, p.source_sent_on, p.loaded_at, p.run_id, a.status AS lote_status
    FROM {dre_premissas.TABELA_PREMISSAS} p
    LEFT JOIN audit.source_sync_run a ON a.sync_run_id = p.run_id
    WHERE p.competencia BETWEEN :inicio AND :fim
      AND p.brand = ANY(:marcas)
"""


def ler_premissas(db: Session, inicio: date, fim: date, marcas: list[str]) -> dre_premissas.LeituraPremissas:
    """Tabela ausente (migration 026 nao aplicada) nao e' erro: `tabela_existe=False`.
    `to_regclass` evita a excecao que envenenaria a transacao da sessao."""
    if not db.execute(text(SQL_PREMISSAS_EXISTE)).scalar():
        return dre_premissas.LeituraPremissas(tabela_existe=False)
    rows = db.execute(text(SQL_PREMISSAS), {"inicio": inicio, "fim": fim, "marcas": marcas}).mappings().all()
    return dre_premissas.LeituraPremissas(tabela_existe=True, linhas=[dict(r) for r in rows])


def _com_cenario(base: list[dict], premissas: dre_premissas.LeituraPremissas | None, hoje: date) -> None:
    """Acrescenta `cenario_premissas` em cada celula base. NAO toca nos campos realizados."""
    idx = dre_premissas.indexar_premissas(premissas)
    for c in base:
        mes = date.fromisoformat(c["mes"] + "-01")
        c["cenario_premissas"] = dre_premissas.montar_cenario(
            c, idx.get((mes, c["marca"])), mes=mes, hoje=hoje, maduro=mes_maduro(mes, hoje),
            fim_do_mes=ultimo_dia(mes))


def montar_dre(
    *,
    inicio: date,
    fim: date,
    canais: list[str],
    marcas: list[str],
    mart_rows: list[dict],
    afiliado_rows: list[dict],
    insumos: LeituraInsumos,
    hoje: date,
    agora: datetime,
    periodo_origem: str = "informado",
    premissas: dre_premissas.LeituraPremissas | None = None,
    frete_comprador: LeituraFreteComprador | None = None,
) -> dict:
    """Monta a resposta inteira a partir de linhas ja lidas. Funcao PURA.

    `premissas` (opcional) acrescenta `cenario_premissas` — sempre estimado —
    sem alterar nenhum campo realizado. `frete_comprador` (T-0068) ausente
    equivale a coluna inexistente: receita TikTok com frete, com motivo.
    """
    meses = meses_do_periodo(inicio, fim)
    af_idx = {(_chave_mes(r["mes"]), r["marca"]): r for r in afiliado_rows}
    fc = frete_comprador or LeituraFreteComprador(coluna_existe=False)
    fc_idx = {(_chave_mes(r["mes"]), r["marca"]): r for r in fc.linhas}
    cmv_idx, rep_idx = indexar_insumos(insumos.linhas, agora)
    txs_idx = indexar_taxa_shopee(insumos.linhas, agora)
    imp_idx = indexar_impostos(insumos.linhas, agora)
    motivo_sem = ("marts.fact_dre_insumo_mensal nao existe (migration 025 nao aplicada)"
                  if not insumos.tabela_existe else
                  "competencia nao publicada em marts.fact_dre_insumo_mensal")

    base: list[dict] = []
    for r in mart_rows:
        canal = CANAL_POR_MKT.get(r["marketplace_id"])
        if canal not in canais or r["marca"] not in marcas:
            continue
        mes = _chave_mes(r["mes"])
        ins = InsumosCelula(
            mes=mes, canal=canal, marca=r["marca"], mart=r,
            afiliado=af_idx.get((mes, r["marca"])) if canal == "tiktok" else None,
            cmv=cmv_idx.get((mes, canal, r["marca"])),
            repasse=rep_idx.get((mes, canal, r["marca"])) if canal == "tiktok" else None,
            taxa_shopee=txs_idx.get((mes, canal, r["marca"])) if canal == "shopee" else None,
            impostos=imp_idx.get((mes, canal, r["marca"])),
            motivo_sem_insumo=motivo_sem,
            frete_comprador=fc_idx.get((mes, r["marca"])) if canal == "tiktok" else None,
            frete_comprador_coluna=fc.coluna_existe,
        )
        base.append(montar_celula_base(ins, hoje))
    base.sort(key=lambda c: (c["mes"], CANAIS.index(c["canal"]), c["marca"]))
    _com_cenario(base, premissas, hoje)

    def _agregar(cs: list[dict], **rotulos) -> dict | None:
        out = agregar(cs, **rotulos)
        if out is not None:
            # Soma dos cenarios das celulas base; nenhuma taxa e' reaplicada aqui.
            out["cenario_premissas"] = dre_premissas.agregar_cenarios([c["cenario_premissas"] for c in cs])
        return out

    def _grupo(chave_fn: Callable[[dict], tuple], rotulos: Callable[[tuple], dict]) -> list[dict]:
        grupos: dict[tuple, list[dict]] = {}
        for c in base:
            grupos.setdefault(chave_fn(c), []).append(c)
        return [_agregar(cs, **rotulos(k)) for k, cs in sorted(grupos.items(), key=lambda kv: kv[0])]

    por_canal = _grupo(lambda c: (CANAIS.index(c["canal"]),),
                       lambda k: {"canal": CANAIS[k[0]], "canal_label": CANAL_LABEL[CANAIS[k[0]]]})
    por_marca = _grupo(lambda c: (c["marca"],),
                       lambda k: {"marca": k[0], "marca_label": BRAND_LABELS.get(k[0], k[0].upper())})
    por_canal_marca = _grupo(
        lambda c: (CANAIS.index(c["canal"]), c["marca"]),
        lambda k: {"canal": CANAIS[k[0]], "canal_label": CANAL_LABEL[CANAIS[k[0]]],
                   "marca": k[1], "marca_label": BRAND_LABELS.get(k[1], k[1].upper())},
    )
    return {
        "periodo": {"date_from": inicio.isoformat(), "date_to": fim.isoformat(),
                    "meses": [m.isoformat()[:7] for m in meses], "origem": periodo_origem},
        "filtros": {"canais": canais, "marcas": marcas},
        "fontes": {"neon": "ok", "insumos_dre": resumo_insumos(insumos, agora),
                   "premissas_dre": dre_premissas.resumo_premissas(premissas, meses, marcas)},
        "regras": {
            "maturacao_meses": MESES_MATURACAO,
            "insumo_idade_maxima_horas": int(INSUMO_IDADE_MAXIMA.total_seconds() // 3600),
            "cmv_razao_aceita": [CMV_RAZAO_MIN, CMV_RAZAO_MAX],
            "cmv_cobertura_minima": COBERTURA_CMV_MINIMA,
            "impostos": "realizado do webgex (ICMS + DIFAL + PIS/COFINS) onde publicado; parcial entra na "
                        "margem conhecida como parcial; sem publicacao, indisponivel. Premissa so' no cenario estimado",
            "previa": "mes imaturo (M+2) sai como PREVIA com valores e fecha_em",
            "margem_conhecida": "receita − custos com origem realizado ou parcial (entra_na_margem); custo nao "
                                "medido nao entra, entao com parciais a margem tende a estar acima da real",
            "cmv_pct_receita_coberta": "CMV / receita com custo; cobertura = receita com custo / receita fiscal "
                                       "(NF fiscal, base de item). pct_receita do CMV segue CMV / receita (GMV)",
            "afiliado_tiktok": "decomposicao de taxas; nunca somado",
            "rotulo_margem": ROTULO_MARGEM,
            "rotulo_margem_estimada": dre_premissas.ROTULO_MARGEM_ESTIMADA,
            "contrato": "docs/dre_contrato_0.md",
            "contrato_premissas": "docs/dre_premissas_1.md",
        },
        "total": _agregar(base, escopo="total") if base else None,
        "por_canal": por_canal,
        "por_marca": por_marca,
        "por_canal_marca": por_canal_marca,
        "celulas_base": base,
    }


def get_dre(db: Session, *, inicio: date, fim: date, canais: list[str],
            marcas: list[str] | None, hoje: date, agora: datetime,
            periodo_origem: str = "informado") -> dict:
    """Le SO' o Neon. Nenhum caminho desta funcao abre conexao com o Data Mart."""
    meses_do_periodo(inicio, fim)  # valida antes de ir ao banco
    escopo_marcas = marcas if marcas else marcas_ativas(db)
    mkt_ids = [MKT_POR_CANAL[c] for c in canais]
    mart_rows, afiliado_rows = ler_neon(db, inicio, fim, mkt_ids, escopo_marcas)
    insumos = ler_insumos(db, inicio, fim, canais, escopo_marcas)
    premissas = ler_premissas(db, inicio, fim, escopo_marcas)
    frete_comprador = (ler_frete_comprador(db, inicio, fim, escopo_marcas)
                       if "tiktok" in canais else None)
    return montar_dre(inicio=inicio, fim=fim, canais=canais, marcas=escopo_marcas,
                      mart_rows=mart_rows, afiliado_rows=afiliado_rows, insumos=insumos,
                      hoje=hoje, agora=agora, periodo_origem=periodo_origem, premissas=premissas,
                      frete_comprador=frete_comprador)
