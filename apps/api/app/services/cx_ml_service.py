"""CX do Mercado Livre — `GET /api/v1/cx/mercadolivre`.

Contrato: `docs/cx_atendimento_contrato.md` §3.1 e §7.3. Mesmas regras da CX da
Shopee (`cx_atendimento_service`): calculo Torre, ausencia nunca vira zero, uma
fonte cai e as outras seguem (motivo FIXO, o texto da excecao nunca sai).

FONTES (Data Mart, coleta `mercadolivre_cx_coleta`, carga inicial de 90 dias)
  * `raw.vw_ml_cx_diario`: dia x marca (pedidos, reclamacoes, cancelamentos,
    mediacoes, perguntas) e a foto da conta (tempo de resposta oficial e
    mensagens pendentes, uma por dia);
  * `raw.ml_cx_reclamacoes` (+ `ml_cx_motivos`, `ml_cx_reclamacao_acoes`):
    fila "aguardando nossa resposta", motivo e 1a acao do vendedor.

Em producao cada consulta do Data Mart vira uma chamada ao Metabase, atendida em
fila: sao so' DUAS consultas (uma por fonte), em paralelo.

DEFINICOES
  * Reclamacao = claim que nao e' cancelamento (tipo `mediations`...), por data de
    abertura. Cancelamento = `cancel_purchase`/`cancel_sale`. Mediacao = etapa
    `dispute`. Taxa = contagem / pedidos do mesmo periodo (cohort diferente: o
    pedido pode ser de antes). NAO e' a taxa de reputacao do ML.
  * Cancelamento (cartao) = `pedidos_cancelados` ÷ pedidos, e Reembolso = `reembolsos` ÷
    pedidos (as mesmas contas de `pct_cancelados`/`pct_reembolsos` da view, somando
    contagens para a taxa fechar entre dias e marcas). Vem da view, nao das claims: cobrem
    os 90 dias de pedidos, sem o limite da coleta de reclamacoes. Os motivos de
    cancelamento (Pareto) seguem nas claims `cancel_*`.
  * Perguntas sem resposta ha' mais de 24 h: `perguntas_sem_resposta_24h` da view esta'
    distribuida pelo dia de CRIACAO da pergunta; o numero de agora e' a soma de todos os dias.
  * Devolucoes: `devolucoes` da view (migration 61) e' NULL no dia em que ha' reclamacao
    sem a devolucao lida. NULL e' falta de leitura, nunca zero: a soma da janela so' sai
    quando TODO dia dela tem leitura (senao o total sairia menor que o real).
  * "Respondida em": a 1a acao do vendedor (papel `respondent`) so' existe para
    as ~300 reclamacoes mais recentes de cada conta. Mediana PARCIAL, com a
    cobertura (`reclamacoes_com_historico`) ao lado.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from app.schemas.account_performance import Cobertura, MarcaFora
from app.schemas.cx_atendimento import BlocoMotivos, Janela, Pendencia, SemComparacao
from app.schemas.performance_oficial import ContaSemFoto
from app.schemas.cx_ml import CxMercadoLivreResponse, LinhaMl, PontoDiaMl, ReputacaoMl
from app.services import cx_atendimento_service as base
from app.services import performance_oficial_service as po
from app.services.gold_service import ML_BRANDS, TZ_OPERACIONAL

#: Primeiro dia coberto pela coleta de reclamacoes: a carga inicial pegou o que
#: foi atualizado nos 90 dias ate' 10/11/2026 (menor `atualizada_em` = 12/08). Antes
#: disso so' ha' o que continuou aberto, nunca a contagem inteira.
COLETA_DESDE = date(2026, 8, 12)
#: `raw.vw_ml_cx_diario` so' guarda pedidos dos ultimos 90 dias.
DIAS_PEDIDOS_NA_VIEW = 90
#: A coleta roda a cada ~2 h; passou disso por 3, o dado e' velho.
# A DAG mercadolivre_cx_coleta roda 1x por dia (06:20 BRT): 30 h toleram um atraso sem alarme falso.
LIMITE_FRESCOR_HORAS = 30.0

SQL_DIARIO = """
SELECT brand AS marca, dia, pedidos, reclamacoes, pedidos_cancelados, mediacoes,
       perguntas, perguntas_respondidas, tempo_resposta_min, mensagens_pendentes,
       reembolsos, valor_reembolsado, perguntas_sem_resposta_24h, devolucoes
  FROM raw.vw_ml_cx_diario
 WHERE brand = ANY(:marcas)
   AND (dia >= :desde OR perguntas_sem_resposta_24h > 0)
"""

#: UMA consulta para cinco blocos (`bloco`): motivo (janela), fila (agora), resposta
#: (janela, parcial), perguntas sem resposta (agora, de `raw.ml_cx_perguntas`) e fonte (frescor).
#: Colunas comuns: k1/k2 = chaves, n1..n3 = contagens, x = numero, instante_em = data.
SQL_RECLAMACOES = """
WITH r AS (
    SELECT c.brand, c.claim_id, c.status, c.acao_pendente_vendedor, c.prazo_vendedor,
           c.criada_em, c.acoes_lidas_em, c.captured_at,
           (c.criada_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
           COALESCE(m.nome, c.reason_id, '') AS motivo,
           COALESCE(c.tipo IN ('cancel_purchase', 'cancel_sale'), false) AS cancelamento
      FROM raw.ml_cx_reclamacoes c
      LEFT JOIN raw.ml_cx_motivos m ON m.reason_id = c.reason_id
     WHERE c.brand = ANY(:marcas)
), prim AS (
    SELECT claim_id, MIN(ocorreu_em) AS primeira
      FROM raw.ml_cx_reclamacao_acoes
     WHERE brand = ANY(:marcas) AND papel = 'respondent'
     GROUP BY claim_id
)
SELECT 'motivo' AS bloco, brand AS marca,
       CASE WHEN cancelamento THEN 'cancelamento' ELSE 'reclamacao' END AS k1, motivo AS k2,
       COUNT(*) AS n1, NULL::bigint AS n2, NULL::bigint AS n3,
       NULL::float8 AS x, NULL::timestamptz AS instante_em
  FROM r WHERE dia BETWEEN :inicio AND :fim GROUP BY 1, 2, 3, 4
UNION ALL
SELECT 'fila', brand, NULL, NULL,
       COUNT(*),
       COUNT(*) FILTER (WHERE prazo_vendedor < now()),
       COUNT(*) FILTER (WHERE prazo_vendedor >= now() AND prazo_vendedor < now() + interval '24 hours'),
       NULL, MIN(prazo_vendedor)
  FROM r WHERE status = 'opened' AND acao_pendente_vendedor GROUP BY 1, 2
UNION ALL
SELECT 'resposta', r.brand, NULL, NULL,
       COUNT(*) FILTER (WHERE r.acoes_lidas_em IS NOT NULL),
       COUNT(p.primeira),
       COUNT(*),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (p.primeira - r.criada_em)) / 3600.0)
           FILTER (WHERE p.primeira IS NOT NULL),
       NULL
  FROM r LEFT JOIN prim p ON p.claim_id = r.claim_id
 WHERE NOT r.cancelamento AND r.dia BETWEEN :inicio AND :fim GROUP BY 1, 2
UNION ALL
SELECT 'perguntas', brand, NULL, NULL,
       COUNT(*) FILTER (WHERE status = 'UNANSWERED'),
       NULL, NULL, NULL, MIN(criada_em) FILTER (WHERE status = 'UNANSWERED')
  FROM raw.ml_cx_perguntas WHERE brand = ANY(:marcas) GROUP BY 1, 2
UNION ALL
SELECT 'fonte', brand, NULL, NULL, NULL, NULL, NULL, NULL, MAX(captured_at) FROM r GROUP BY 1, 2
"""

# ---------------------------------------------------------------------------
# Rotulos de motivo (nome do motivo no `ml_cx_motivos` -> rotulo em portugues, natureza).
# Fora do mapa nunca some: sai com o nome do ML e `mapeado = False`.
# ---------------------------------------------------------------------------
MOTIVOS_ML_CX: dict[str, tuple[str, str]] = {
    # cancelamento (cancel_purchase / cancel_sale)
    "undelivered_repentant_buyer": ("Desistiu antes de receber", "comprador"),
    "undelivered_other": ("Cancelou antes de receber (outro motivo)", "comprador"),
    "estimated_delivery_out_of_time": ("Prazo de entrega estimado estourou", "logistica"),
    "change_receiver_address": ("Quis mudar o endereço de entrega", "comprador"),
    "shipping_address_change": ("Quis mudar o endereço de entrega", "comprador"),
    "out_of_stock": ("Sem estoque", "vendedor"),
    "other_cancellation_reason": ("Outro motivo de cancelamento", "comprador"),
    "respondent_unanswered": ("Vendedor não respondeu", "vendedor"),
    "seller_not_responding": ("Vendedor não respondeu", "vendedor"),
    "unauthorized_purchase": ("Compra não reconhecida", "comprador"),
    "purchase_no_longer_wanted": ("Não quer mais a compra", "comprador"),
    "selected_wrong_product": ("Escolheu o produto errado", "comprador"),
    "better_price_found": ("Achou preço melhor", "comprador"),
    "delivery_date_changed": ("Data de entrega mudou", "logistica"),
    "delivery_date_not_met": ("Prazo de entrega não cumprido", "logistica"),
    "delivery_date_was_not_met": ("Prazo de entrega não cumprido", "logistica"),
    "other_delivery_timing_reason": ("Outro motivo de prazo de entrega", "logistica"),
    "unclear_delivery_date": ("Data de entrega pouco clara", "logistica"),
    "need_earlier_delivery": ("Precisa receber antes", "logistica"),
    "payment_method_or_installments_change": ("Quis mudar pagamento ou parcelas", "comprador"),
    "other_product_change_reason": ("Quis trocar o produto", "comprador"),
    "other_shipping_payment_change_reason": ("Quis mudar envio ou pagamento", "comprador"),
    "delivery_or_pickup_method_change": ("Quis mudar a forma de entrega", "comprador"),
    "buy_out_of_ml": ("Comprou fora do Mercado Livre", "comprador"),
    "other_seller_listing_reason": ("Problema no anúncio", "vendedor"),
    # reclamacao (mediations)
    "repentant_buyer": ("Arrependimento do comprador", "comprador"),
    "repentant_beneficiary": ("Arrependimento do comprador", "comprador"),
    "broken_item": ("Produto com defeito ou quebrado", "vendedor"),
    "damaged_package_broken_item": ("Embalagem e produto danificados", "logistica"),
    "damaged_package_missing_accessories": ("Embalagem danificada e faltam acessórios", "logistica"),
    "damaged_package_empty_box": ("Embalagem danificada e caixa vazia", "logistica"),
    "damaged_package_not_working_item": ("Embalagem danificada e produto não funciona", "logistica"),
    "damaged_package_missing_item": ("Embalagem danificada e falta item", "logistica"),
    "damaged_product_other": ("Produto danificado (outro)", "vendedor"),
    "sup_broken_item": ("Produto quebrado, embalagem intacta", "vendedor"),
    "sup_damaged_package_broken_item": ("Produto quebrado, embalagem danificada", "logistica"),
    "different_item_other": ("Produto diferente do pedido", "vendedor"),
    "different_than_published": ("Diferente do anúncio", "vendedor"),
    "different_color_or_size": ("Cor ou tamanho diferente", "vendedor"),
    "fake_different": ("Parece falsificado ou diferente", "vendedor"),
    "missing_accessories": ("Faltam acessórios", "vendedor"),
    "missing_item": ("Falta item no pacote", "vendedor"),
    "missing_invoice": ("Falta a nota fiscal", "vendedor"),
    "empty_box": ("Caixa vazia", "vendedor"),
    "not_working_item": ("Produto não funciona", "vendedor"),
    "delivered_but_not_receive_package": ("Consta entregue, mas não recebeu", "logistica"),
}


def rotular_ml_cx(motivo: Any) -> tuple[str, str, str, bool]:
    """(codigo, rotulo, natureza, mapeado) do motivo de uma reclamacao/cancelamento."""
    cod = str(motivo or "").strip()
    if not cod:
        return "sem_motivo", "Sem motivo informado", "plataforma", True
    if cod in MOTIVOS_ML_CX:
        rotulo, natureza = MOTIVOS_ML_CX[cod]
        return cod, rotulo, natureza, True
    return cod, cod.replace("_", " "), "plataforma", False


PENDENCIAS: list[Pendencia] = []


def _soma(linhas: list[dict], campo: str, ini: date, fim: date) -> Optional[int]:
    """Soma do campo na janela. Sem nenhuma linha com o campo = None; dia sem linha dentro
    de janela coberta e' dia sem ocorrencia (a view e' um FULL JOIN)."""
    vals = [base._int(r.get(campo)) for r in linhas if (d := base._dia(r.get("dia"))) and ini <= d <= fim]
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else None


def _soma_valor(linhas: list[dict], campo: str, ini: date, fim: date) -> Optional[float]:
    vals = [float(r[campo]) for r in linhas if r.get(campo) is not None and (d := base._dia(r.get("dia"))) and ini <= d <= fim]
    return round(sum(vals), 2) if vals else None


def _soma_completa(linhas: list[dict], campo: str, ini: date, fim: date) -> Optional[int]:
    """Soma so' se todo dia da janela tem o campo lido; um dia NULL deixa a janela sem leitura."""
    vals = [base._int(r.get(campo)) for r in linhas if (d := base._dia(r.get("dia"))) and ini <= d <= fim]
    return sum(vals) if vals and None not in vals else None


def _cobre(janela: Janela) -> bool:
    return janela.inicio >= COLETA_DESDE


def sem_anterior_ml(janela: Janela, anterior: Janela, hoje: date) -> dict[str, SemComparacao]:
    """Por indicador: ausente = a janela anterior esta' coberta. Pedidos, cancelamento e
    reembolso so' dependem da base de pedidos de 90 dias; resposta, reclamacao e mediacao
    dependem tambem da coleta de reclamacoes."""
    if 2 * janela.dias > DIAS_PEDIDOS_NA_VIEW:
        sem = SemComparacao(
            motivo="base de pedidos de 90 dias", a_partir_de=None,
            detalhe=f"A base de pedidos guarda {DIAS_PEDIDOS_NA_VIEW} dias: os {janela.dias} anteriores não cabem nela.")
        return {i: sem for i in ("resposta", "reclamacao", "cancelamento", "mediacao", "reembolso", "devolucao")}
    if anterior.inicio < COLETA_DESDE:
        quando = COLETA_DESDE + timedelta(days=2 * janela.dias)
        sem = SemComparacao(
            motivo=f"coleta desde {COLETA_DESDE:%d/%m}", a_partir_de=quando,
            detalhe=f"A coleta de reclamações começou em {COLETA_DESDE:%d/%m/%Y} (carga de 90 dias); "
                    f"os {janela.dias} dias anteriores só ficam completos em {quando:%d/%m/%Y}.")
        return {i: sem for i in ("resposta", "reclamacao", "mediacao", "devolucao")}
    return {}


def montar_cx_ml(*, brands: Optional[list[str]] = None, dias: int = base.JANELA_PADRAO_DIAS,
                 consultar: Optional[base.Consultar] = None,
                 agora: Optional[datetime] = None) -> CxMercadoLivreResponse:
    agora = agora or datetime.now(timezone.utc)
    consultar = consultar or base.consultar_datamart
    marcas = [m for m in base.MARCAS_PERMITIDAS if brands is None or m in brands]
    cobertura = Cobertura(
        marcas=[m for m in marcas if m in ML_BRANDS],
        fora=[MarcaFora(marca=m, motivo="Sem conta Mercado Livre integrada.") for m in marcas if m not in ML_BRANDS])
    janela = base.calcular_janela(dias, agora)
    anterior = Janela(inicio=janela.inicio - timedelta(days=dias), fim=janela.inicio - timedelta(days=1), dias=dias)
    hoje = agora.astimezone(TZ_OPERACIONAL).date()
    resp = dict(gerado_em=agora, janela=janela, janela_anterior=anterior, cobertura=cobertura,
                coleta_desde=COLETA_DESDE)
    if not cobertura.marcas:
        return CxMercadoLivreResponse(**resp)

    res = base._rodar_juntas({
        "ml_cx_diario": (consultar, SQL_DIARIO, {"marcas": cobertura.marcas, "desde": anterior.inicio}),
        "ml_cx_reclamacoes": (consultar, SQL_RECLAMACOES, {"marcas": cobertura.marcas,
                                                            "inicio": janela.inicio, "fim": janela.fim}),
        "ml_reputacao": (consultar, po.SQL_ML, {"marcas": cobertura.marcas}),
    })
    diario, recl = res["ml_cx_diario"], res["ml_cx_reclamacoes"]
    resp["reputacao"] = _reputacao(res["ml_reputacao"], cobertura.marcas, hoje)
    resp["diario_estado"] = "dado" if diario is not None else "erro"
    resp["reclamacoes_estado"] = "dado" if recl is not None else "erro"
    if diario is None or recl is None:
        resp["motivo_indisponivel"] = base.MOTIVO_ERRO
    claims_ok = recl is not None and _cobre(janela)

    # frescor: a coleta mais recente entre as marcas
    por_bloco: dict[str, list[dict]] = {}
    for r in recl or []:
        por_bloco.setdefault(str(r.get("bloco")), []).append(r)
    instantes = [base._utc(r.get("instante_em")) for r in por_bloco.get("fonte", [])]
    instantes = [i for i in instantes if i]
    if instantes:
        resp["atualizado_em"] = max(instantes)
        horas = (agora - max(instantes)).total_seconds() / 3600
        if horas > LIMITE_FRESCOR_HORAS:
            resp["aviso_frescor"] = f"Coleta sem atualização há {horas:.0f} h (esperado até {LIMITE_FRESCOR_HORAS:.0f} h)."

    sem = sem_anterior_ml(janela, anterior, hoje)
    resp["sem_anterior"] = sem
    # pedidos, cancelamento e reembolso: so' a base de pedidos; o resto tambem a coleta de reclamacoes
    base_anterior = diario is not None and "cancelamento" not in sem
    com_anterior = base_anterior and recl is not None and not sem

    fila = {r["marca"]: r for r in por_bloco.get("fila", [])}
    resposta = {r["marca"]: r for r in por_bloco.get("resposta", [])}
    perguntas = {r["marca"]: r for r in por_bloco.get("perguntas", [])}
    # marca com reclamacao guardada = a coleta chegou nela: ausencia na janela e' zero de verdade
    lidas = {r["marca"] for r in por_bloco.get("fonte", [])}
    linhas: list[LinhaMl] = []
    for m in cobertura.marcas:
        rows = [r for r in diario or [] if r.get("marca") == m]
        tem = m in lidas
        c: dict[str, Any] = {"marca": m}
        if rows:
            c["pedidos"] = _soma(rows, "pedidos", janela.inicio, janela.fim)
            conta = [r for r in rows if r.get("tempo_resposta_min") is not None or r.get("mensagens_pendentes") is not None]
            if conta:
                u = max(conta, key=lambda r: base._dia(r.get("dia")) or date.min)
                tr = u.get("tempo_resposta_min")
                c.update(tempo_resposta_min=None if tr is None else float(tr),
                         mensagens_pendentes=base._int(u.get("mensagens_pendentes")), conta_dia=base._dia(u.get("dia")))
            c["perguntas"] = _soma(rows, "perguntas", janela.inicio, janela.fim)
            c["perguntas_respondidas"] = _soma(rows, "perguntas_respondidas", janela.inicio, janela.fim)
            # backlog de agora: soma de todos os dias (cada pergunta conta no dia em que foi criada)
            c["perguntas_sem_resposta_24h"] = _soma(rows, "perguntas_sem_resposta_24h", date.min, date.max)
            # a view traz cancelados e reembolsos em todo dia com pedido: ausente = sem leitura, nunca 0
            for campo, col in (("cancelamentos", "pedidos_cancelados"), ("reembolsos", "reembolsos")):
                c[campo] = _soma(rows, col, janela.inicio, janela.fim)
            c["valor_reembolsado"] = _soma_valor(rows, "valor_reembolsado", janela.inicio, janela.fim)
            if claims_ok and tem:
                for campo in ("reclamacoes", "mediacoes"):
                    c[campo] = _soma(rows, campo, janela.inicio, janela.fim) or 0
            if claims_ok:
                c["devolucoes"] = _soma_completa(rows, "devolucoes", janela.inicio, janela.fim)
            if base_anterior:
                c["pedidos_anterior"] = _soma(rows, "pedidos", anterior.inicio, anterior.fim)
                for campo, col in (("cancelamentos", "pedidos_cancelados"), ("reembolsos", "reembolsos")):
                    c[campo + "_anterior"] = _soma(rows, col, anterior.inicio, anterior.fim)
            if com_anterior:
                c["perguntas_anterior"] = _soma(rows, "perguntas", anterior.inicio, anterior.fim)
                c["perguntas_respondidas_anterior"] = _soma(rows, "perguntas_respondidas", anterior.inicio, anterior.fim)
                if tem:
                    for campo in ("reclamacoes", "mediacoes"):
                        c[campo + "_anterior"] = _soma(rows, campo, anterior.inicio, anterior.fim) or 0
                c["devolucoes_anterior"] = _soma_completa(rows, "devolucoes", anterior.inicio, anterior.fim)
        if recl is not None and tem:
            q = perguntas.get(m)
            c.update(perguntas_sem_resposta=base._int(q["n1"]) if q else 0,
                     pergunta_mais_antiga=q.get("instante_em") if q else None)
            f = fila.get(m)
            c.update(aguardando_nos=base._int(f["n1"]) if f else 0,
                     vencidas=base._int(f["n2"]) if f else 0, vencem_24h=base._int(f["n3"]) if f else 0,
                     prazo_mais_antigo=f.get("instante_em") if f else None)
            p = resposta.get(m)
            if p and claims_ok and base._int(p["n1"]):
                c.update(reclamacoes_com_historico=base._int(p["n1"]), reclamacoes_respondidas=base._int(p["n2"]),
                         resposta_mediana_h=None if p.get("x") is None else round(float(p["x"]), 1))
        linhas.append(LinhaMl(**c))
    resp["marcas"] = linhas

    resp["reclamacoes_motivos"] = _motivos(por_bloco.get("motivo"), "reclamacao", "Motivos das reclamações",
                                          "Nenhuma reclamação no período.", recl, claims_ok)
    resp["cancelamentos_motivos"] = _motivos(por_bloco.get("motivo"), "cancelamento", "Motivos dos cancelamentos",
                                            "Nenhum pedido de cancelamento no período.", recl, claims_ok)
    if diario is not None:
        resp["serie_diaria"] = _serie(diario, cobertura.marcas, janela, claims_ok)
    resp["pendencias"] = PENDENCIAS
    return CxMercadoLivreResponse(**resp)


def _reputacao(linhas: Optional[list[dict]], marcas: list[str], hoje: date) -> ReputacaoMl:
    """Reputacao oficial do ML por conta (a mesma leitura e regra da Performance das contas)."""
    if linhas is None:
        return ReputacaoMl(estado="erro", fonte=po.FONTE_ML, motivo=base.MOTIVO_ERRO)
    contas = [po.conta_ml(r, hoje) for r in linhas if r.get("brand") in marcas]
    contas.sort(key=lambda c: marcas.index(c.marca))
    com = {c.marca for c in contas}
    return ReputacaoMl(
        estado="dado", fonte=po.FONTE_ML, contas=contas,
        sem_foto=[ContaSemFoto(marca=m, motivo="Sem fotografia capturada ainda.") for m in marcas if m not in com])


def _motivos(linhas: Optional[list[dict]], tipo: str, titulo: str, vazio: str,
             recl: Optional[list[dict]], claims_ok: bool):
    ajuda = ("Motivo dado pelo Mercado Livre na abertura, por data de abertura da "
             f"{'reclamação' if tipo == 'reclamacao' else 'solicitação de cancelamento'}.")
    if recl is None:
        return base._bloco_motivos(titulo, ajuda, None)
    if not claims_ok:
        return BlocoMotivos(titulo=titulo, estado="sem_fonte", ajuda=ajuda,
                                 motivo_indisponivel=f"A coleta de reclamações começou em {COLETA_DESDE:%d/%m/%Y}.")
    itens = [(*rotular_ml_cx(r.get("k2")), base._int(r.get("n1")) or 0) for r in linhas or [] if r.get("k1") == tipo]
    return base._bloco_motivos(titulo, ajuda, itens, texto_vazio=vazio)


def _serie(diario: list[dict], marcas: list[str], janela: Janela, claims_ok: bool) -> list[PontoDiaMl]:
    """Um ponto por dia x marca. Dia sem pedido na view = None (nunca 0)."""
    por = {(r.get("marca"), base._dia(r.get("dia"))): r for r in diario}
    pontos: list[PontoDiaMl] = []
    for m in marcas:
        for i in range(janela.dias):
            d = janela.inicio + timedelta(days=i)
            r = por.get((m, d))
            ped = base._int(r.get("pedidos")) if r else None
            p: dict[str, Any] = {"dia": d, "marca": m, "pedidos": ped}
            if ped is not None:
                p["cancelamentos"] = base._int(r.get("pedidos_cancelados"))
                p["reembolsos"] = base._int(r.get("reembolsos"))
                if claims_ok:
                    for campo in ("reclamacoes", "mediacoes"):
                        p[campo] = base._int(r.get(campo)) or 0
                    p["devolucoes"] = base._int(r.get("devolucoes"))
            pontos.append(PontoDiaMl(**p))
    return pontos
