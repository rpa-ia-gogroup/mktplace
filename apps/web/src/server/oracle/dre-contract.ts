/**
 * torre_dre — DRE gerencial mensal (MCP-COVERAGE-2 Fase 4; ativada na T-0080 P2,
 * 11/11/2026, por decisao do Mario: a DRE sai pelo MCP, inclusive CMV e margem).
 *
 * Le `GET /api/v1/dre?ref_month=YYYY-MM` (opcionalmente `channels`/`brands`,
 * CSV) e devolve o total, por canal, por marca e as celulas canal x marca.
 *
 * REGRAS (nenhum valor ausente vira zero):
 * - cada linha da DRE sai como `{ valor, pct_receita, status, status_fonte,
 *   motivo, origem, entra_na_margem, cobertura_rotulo, valor_medido }`.
 *   T-0092: o status ESPELHA a `origem` que a API calcula (T-0090) — o
 *   conector nao recalcula regra: `realizado` -> CALCULADO; `parcial` ou
 *   `extrapolado` -> PARCIAL, COM o valor da API; `nao_aplicavel` ->
 *   NAO_APLICAVEL; `indisponivel` -> NAO_CALCULAVEL com `valor=null`. Origem
 *   com valor mas sem numero na fonte continua nula (ausencia nao vira 0).
 *   Resposta anterior a T-0090 (sem `origem`): so' `disponivel` tem valor;
 *   o resto sai NAO_CALCULAVEL nulo, como antes;
 * - insumo publicado ha mais de 54 h (ou lote nao `ok`) torna CMV, taxas e
 *   frete que dependem dele NAO_CALCULAVEL — mesmo que a fonte diga outra coisa;
 * - margem conhecida: a da API (`margem_contribuicao_conhecida`), com
 *   `componentes_usados`, `componentes_parciais` e `aviso`. Sai NAO_CALCULAVEL
 *   se a API nao a calculou ou se algum custo que a API pos nela nao foi
 *   exposto pelo conector (ex.: lote vencido); PARCIAL se a API declarou
 *   parciais, se a receita e' parcial ou se o CMV nao entrou na conta;
 * - custos conhecidos = soma dos custos que a API pos na margem, so' quando
 *   todos tem valor exposto;
 * - cenario_premissas sai com as linhas ESTIMADAS, compactas (linha -> valor):
 *   `linhas_premissa` e `linhas_extrapoladas` — estimativa, nunca medida;
 * - `cobertura_rotulo`/`valor_medido` so' saem quando a API os da (teto);
 * - impostos nao publicados e premissas nao publicadas viram limitacao
 *   DERIVADA dos campos da API (status por celula, `fontes.premissas_dre`),
 *   nunca de data fixa no codigo.
 *
 * TAMANHO: o payload bruto de um mes passa de 256 KB (outubro/2026: 417 KB) por
 * causa de `celulas_base` (repete o grao canal x marca) e das linhas do
 * cenario de premissas. O adapter aceita ate 1 MiB SO' para este endpoint
 * (`ENDPOINT_MAX_BYTES`); o que a tool devolve e' uma projecao compacta e
 * medida contra `DRE_MAX_RESPONSE_BYTES`. Se ainda assim passar, celulas
 * canal x marca saem do fim da lista e a resposta DIZ quais (limitacao +
 * `meta.truncated` + `data.corte`).
 */
import { z } from "zod";

import { buildEnvelope, type Envelope } from "./envelope.ts";
import { toolError } from "./errors.ts";
import type { Limitation } from "./limitations.ts";
import { BRANDS, CHANNELS, isoMonth, noDuplicates } from "./schemas.ts";
import { ageHours, envelopeSchema, limitationSchema, ok, safeText, type OracleTool } from "./tool-kit.ts";
import { numOrNull } from "./torre-client.ts";
import { parseUpstream } from "./upstream.ts";

export const DRE_TOOL_NAME = "torre_dre";
/** Path da API (allowlisted em `ENDPOINTS.dre`). */
export const DRE_ENDPOINT_PATH = "/api/v1/dre";
/** Idade maxima do lote de insumos (mesmo valor do backend). */
// Igual a `INSUMO_IDADE_MAXIMA` da API (54 h desde DRE-TTL-54). Ha' teste de
// paridade em `apps/api/tests/test_dre_mvp.py`.
export const DRE_MAX_SNAPSHOT_HOURS = 54;
/**
 * Teto do que a tool devolve (bloco de texto + structuredContent, serializados).
 * Abaixo de 256 KB para sobrar espaco ao envelope JSON-RPC.
 */
export const DRE_MAX_RESPONSE_BYTES = 240 * 1024;
/** Teto de texto livre da fonte por item e de itens por lista. */
const DRE_TEXT_MAX = 300;
const DRE_LIST_MAX = 30;

export const dreInput = z
  .object({
    ref_month: isoMonth,
    canais: noDuplicates(z.array(z.enum(CHANNELS)).min(1).max(3), "canais").optional(),
    marcas: noDuplicates(z.array(z.enum(BRANDS)).min(1).max(5), "marcas").optional(),
  })
  .strict();
export type DreInput = z.infer<typeof dreInput>;

// ---------------------------------------------------------------------------
// Upstream (subconjunto consumido de `DREResponse`)
// ---------------------------------------------------------------------------

const STATUS_FONTE = [
  "disponivel", "parcial", "indisponivel", "snapshot_ausente", "snapshot_vencido",
  "nao_reconciliado", "nao_confirmado", "provisorio", "sinal_inesperado", "nao_aplicavel",
] as const;

const optStr = z.string().nullish();

/** Dominio FECHADO da classificacao da celula (T-0090 incluiu PREVIA). */
export const DRE_CLASSIFICACOES = ["COMPLETA", "PARCIAL", "PREVIA", "NAO_CALCULAVEL"] as const;

/** T-0090 — `OrigemComponente` da API (dominio fechado). */
export const DRE_ORIGENS = ["realizado", "parcial", "extrapolado", "indisponivel", "nao_aplicavel"] as const;
type Origem = (typeof DRE_ORIGENS)[number];
/** T-0090 — `OrigemLinha` do cenario estimado (dominio fechado). */
export const DRE_ORIGENS_CENARIO = [
  "realizado", "parcial", "premissa", "extrapolado", "decomposicao", "indisponivel", "calculado", "misto",
] as const;

const componente = z.object({
  valor: z.number().finite().nullish(),
  pct_receita: z.number().finite().nullish(),
  status: z.enum(STATUS_FONTE),
  motivo: optStr,
  somavel: z.boolean(),
  publicado_em: optStr,
  // T-0090, opcionais (ausentes em API anterior).
  origem: z.enum(DRE_ORIGENS).nullish(),
  entra_na_margem: z.boolean().nullish(),
  cobertura_rotulo: optStr,
  valor_medido: z.number().finite().nullish(),
});

const NOMES = ["receita", "devolucoes", "taxas", "afiliados", "ads", "frete", "cmv", "impostos"] as const;
type Nome = (typeof NOMES)[number];

const cenarioPremissas = z.object({
  competencia_premissas: z.string(),
  natureza: z.string(),
  rotulo: z.string(),
  estado: z.enum(["calculavel", "parcial", "nao_calculavel"]),
  previa: z.boolean(),
  competencia_madura: z.boolean(),
  motivos: z.array(z.string()),
  avisos: z.array(z.string()),
  margem_contribuicao_estimada: z.number().finite().nullish(),
  margem_contribuicao_estimada_pct: z.number().finite().nullish(),
  /** Linhas do cenario; ausente em fixture reduzida/API antiga. */
  linhas: z
    .array(
      z.object({
        linha: z.string(),
        tipo: z.enum(["item", "subtotal", "informativo"]),
        valor: z.number().finite().nullish(),
        pct_receita: z.number().finite().nullish(),
        origem: z.enum(DRE_ORIGENS_CENARIO),
        somavel: z.boolean(),
      }),
    )
    .nullish(),
  /** T-0090 — celulas do recorte sem premissa publicada (fora do cenario). */
  celulas_sem_premissa: z.number().int().nonnegative().nullish(),
});

const celula = z.object({
  mes: optStr,
  canal: optStr,
  marca: optStr,
  // T-0090: PREVIA = mes imaturo (M+2) com valores; NAO_CALCULAVEL so' sem receita.
  classificacao: z.enum(DRE_CLASSIFICACOES),
  /** T-0090 — data em que a previa fecha; ausente em API anterior. */
  fecha_em: optStr,
  /** T-0090 — `true` quando PREVIA; ausente em API anterior. */
  previa: z.boolean().nullish(),
  motivos_classificacao: z.array(z.string()),
  avisos_qualidade: z.array(z.string()),
  componentes: z.object(Object.fromEntries(NOMES.map((n) => [n, componente])) as Record<Nome, typeof componente>),
  margem_contribuicao_conhecida: z.object({
    valor: z.number().finite().nullish(),
    pct_receita: z.number().finite().nullish(),
    rotulo: z.string(),
    componentes_usados: z.array(z.string()),
    /** T-0090 — custos que entraram com origem parcial/extrapolado. */
    componentes_parciais: z.array(z.string()).nullish(),
    faltam: z.array(z.string()),
    /** T-0090 — presente quando ha parciais (margem tende a estar acima da real). */
    aviso: optStr,
  }),
  data_maxima: z.object({
    receita_ultimo_dia: optStr,
    mart_carregado_em: optStr,
    cmv_ultima_emissao: optStr,
    repasse_tiktok_atualizado_em: optStr,
    insumo_publicado_em: optStr,
  }),
  /** `null`/ausente = competencia sem premissa publicada (contrato da API). */
  cenario_premissas: cenarioPremissas.nullish(),
});
type CelulaIn = z.infer<typeof celula>;

export const dreUpstreamContract = z.object({
  periodo: z.object({ meses: z.array(z.string()), origem: optStr }),
  filtros: z.record(z.string(), z.array(z.string())).nullish(),
  fontes: z.object({
    insumos_dre: z.object({
      estado: z.enum(["ok", "tabela_ausente", "nao_publicado", "vencido", "parcialmente_vencido"]),
      publicado_em: optStr,
      publicado_em_mais_recente: optStr,
      motivo: optStr,
    }),
    premissas_dre: z
      .object({
        estado: z.enum(["ok", "parcial", "tabela_ausente", "nao_publicado", "lote_invalido", "nao_consultado"]),
        competencias_publicadas: z.array(z.string()),
        rotulo: optStr,
        data_fonte: optStr,
        carregado_em: optStr,
        motivo: optStr,
      })
      .nullish(),
  }),
  total: celula.nullish(),
  por_canal: z.array(celula),
  por_marca: z.array(celula),
  por_canal_marca: z.array(celula),
});

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

/** T-0092: PARCIAL = valor da API com origem parcial/extrapolado (cobertura incompleta). */
export const DRE_STATUS = ["CALCULADO", "PARCIAL", "NAO_CALCULAVEL", "NAO_APLICAVEL"] as const;
type DreStatus = (typeof DRE_STATUS)[number];

const NIVEIS = ["total", "canal", "marca", "canal_marca"] as const;
type Nivel = (typeof NIVEIS)[number];

const linha = z.object({
  valor: z.number().nullable(),
  pct_receita: z.number().nullable(),
  status: z.enum(DRE_STATUS),
  status_fonte: z.string(),
  motivo: z.string().nullable(),
  /** T-0090 — origem que a API deu ao numero; `null` = API nao informou (ou linha derivada). */
  origem: z.enum(DRE_ORIGENS).nullable(),
  /** T-0090 — a API pos este custo na margem conhecida. */
  entra_na_margem: z.boolean(),
  /**
   * T-0090 — rotulo curto da cobertura (ex.: "escrow em 93,0% dos pedidos").
   * AUSENTE quando a API nao da rotulo (economia de bytes no teto).
   */
  cobertura_rotulo: z.string().optional(),
  /**
   * T-0090, CMV: custo medido cru (com origem `extrapolado`, `valor` e' o
   * estendido). AUSENTE quando a API nao da (ou o valor nao e' exposto).
   */
  valor_medido: z.number().optional(),
});

const celulaOut = z.object({
  nivel: z.enum(NIVEIS),
  mes: z.string(),
  canal: z.string().nullable(),
  marca: z.string().nullable(),
  classificacao_fonte: z.string(),
  /** T-0090 — com classificacao PREVIA, a data em que a previa fecha; senao `null`. */
  fecha_em: z.string().nullable(),
  motivos_classificacao: z.array(z.string()),
  avisos_qualidade: z.array(z.string()),
  receita: linha,
  cmv: linha,
  ads: linha,
  afiliados: linha,
  taxas: linha,
  frete: linha,
  devolucoes: linha,
  impostos: linha,
  custos_conhecidos: linha,
  /** Margem de contribuicao CONHECIDA — nao e' lucro nem margem liquida. */
  resultado: linha,
  margem_pct: z.number().nullable(),
  componentes_faltando: z.array(z.string()),
  /**
   * T-0090 — qual margem e' o DESTAQUE, mesma regra da tela (`margemPrincipal`
   * em `src/lib/dre.ts`): `estimada` na PREVIA com cenario e margem estimada
   * numerica (cenario_premissas.margem_estimada); senao `conhecida` (resultado).
   */
  margem_principal: z.enum(["conhecida", "estimada"]),
  /** T-0090 — composicao da margem conhecida como a API a montou. */
  margem_conhecida: z.object({
    componentes_usados: z.array(z.string()),
    /** Custos que entraram com origem parcial/extrapolado. */
    componentes_parciais: z.array(z.string()),
    /** Aviso da API (margem tende a estar acima da real com parciais). */
    aviso: z.string().nullable(),
  }),
  frescor: z.object({
    receita_ultimo_dia: z.string().nullable(),
    mart_carregado_em: z.string().nullable(),
    cmv_ultima_emissao: z.string().nullable(),
    repasse_tiktok_atualizado_em: z.string().nullable(),
    insumo_publicado_em: z.string().nullable(),
  }),
  /** ESTIMATIVA com premissas de orcamento — nao e' realizado. `null` = sem premissa. */
  cenario_premissas: z
    .object({
      natureza: z.string(),
      rotulo: z.string(),
      competencia_premissas: z.string(),
      estado: z.string(),
      previa: z.boolean(),
      competencia_madura: z.boolean(),
      margem_estimada: z.number().nullable(),
      margem_estimada_pct: z.number().nullable(),
      motivos: z.array(z.string()),
      avisos: z.array(z.string()),
      /** T-0090 — celulas do recorte fora do cenario (sem premissa); `null` = nao informado. */
      celulas_sem_premissa: z.number().nullable(),
      /**
       * Linhas ESTIMADAS do cenario, compactas (linha -> valor): origem
       * `premissa` (taxa de orcamento, nao medida) e `extrapolado` (parcial
       * estendido ao todo). Valor nulo = ausente, nunca zero. `null` = a API
       * nao mandou linhas.
       */
      linhas_premissa: z.record(z.string(), z.number().nullable()).nullable(),
      linhas_extrapoladas: z.record(z.string(), z.number().nullable()).nullable(),
    })
    .nullable(),
});

const dreData = z.object({
  ref_month: z.string(),
  periodo_origem: z.string().nullable(),
  snapshot: z.object({
    estado: z.string(),
    /** O contrato da API nao expoe id de lote: o instante de publicacao o identifica. */
    lote_publicado_em: z.string().nullable(),
    lote_publicado_em_mais_recente: z.string().nullable(),
    idade_horas: z.number().nullable(),
    insumos_disponiveis: z.boolean(),
    motivo: z.string().nullable(),
  }),
  premissas: z.object({
    estado: z.string(),
    publicadas_para_o_mes: z.boolean(),
    competencias_publicadas: z.array(z.string()),
    rotulo: z.string().nullable(),
    data_fonte: z.string().nullable(),
    carregado_em: z.string().nullable(),
    motivo: z.string().nullable(),
  }),
  total: celulaOut.nullable(),
  por_canal: z.array(celulaOut),
  por_marca: z.array(celulaOut),
  /** Grao da API: mes x canal x marca. */
  celulas: z.array(celulaOut),
  /** Celulas que ficaram fora pelo teto de resposta; `null` = nada cortado. */
  corte: z
    .object({ celulas_omitidas: z.number(), omitidas: z.array(z.string()), como_obter: z.string() })
    .nullable(),
  limitations: z.array(limitationSchema),
});

export const dreOutput = envelopeSchema(dreData);
type DreData = z.infer<typeof dreData>;

type Linha = z.infer<typeof linha>;
type CelulaOut = z.infer<typeof celulaOut>;

/** Componentes cujo valor depende do lote de insumos publicado. */
const DEPENDEM_DO_LOTE: readonly Nome[] = ["cmv", "taxas", "frete"];

/**
 * Status da linha a partir da `origem` da API (T-0090). Sem `origem` (API
 * anterior), o mapeamento antigo e conservador: so' `disponivel` tem numero.
 */
function mapStatus(s: (typeof STATUS_FONTE)[number], origem: Origem | null): DreStatus {
  if (origem === null) {
    if (s === "disponivel") return "CALCULADO";
    if (s === "nao_aplicavel") return "NAO_APLICAVEL";
    return "NAO_CALCULAVEL";
  }
  if (origem === "realizado") return "CALCULADO";
  if (origem === "parcial" || origem === "extrapolado") return "PARCIAL";
  if (origem === "nao_aplicavel") return "NAO_APLICAVEL";
  return "NAO_CALCULAVEL";
}

const COM_VALOR: readonly DreStatus[] = ["CALCULADO", "PARCIAL"];

function linhaDe(
  c: z.infer<typeof componente>,
  loteVencido: boolean,
  dependeDoLote: boolean,
): Linha {
  const origem = c.origem ?? null;
  let status = mapStatus(c.status, origem);
  const valor = numOrNull(c.valor);
  // Origem com numero mas a fonte sem valor: ausencia continua ausencia.
  if (COM_VALOR.includes(status) && valor === null) status = "NAO_CALCULAVEL";
  const exposto = COM_VALOR.includes(status);
  // Campos opcionais so' entram quando a API os da (teto de bytes).
  const rotulo = safeText(c.cobertura_rotulo, DRE_TEXT_MAX);
  const medido = numOrNull(c.valor_medido);
  const comum = {
    origem,
    entra_na_margem: c.entra_na_margem === true,
    ...(rotulo !== null ? { cobertura_rotulo: rotulo } : {}),
  };
  // Insumo vencido derruba o componente MESMO que a fonte ainda lhe de valor
  // (realizado ou parcial): o conector nao confia num lote fora da janela.
  if (dependeDoLote && c.publicado_em && loteVencido && exposto) {
    return {
      valor: null, pct_receita: null, status: "NAO_CALCULAVEL", status_fonte: "snapshot_vencido",
      motivo: `insumo publicado ha mais de ${DRE_MAX_SNAPSHOT_HOURS} h`, ...comum,
    };
  }
  return {
    valor: exposto ? valor : null,
    pct_receita: exposto ? numOrNull(c.pct_receita) : null,
    status,
    status_fonte: c.status,
    motivo: safeText(c.motivo, DRE_TEXT_MAX),
    ...comum,
    ...(exposto && medido !== null ? { valor_medido: medido } : {}),
  };
}

const derivada = (l: Omit<Linha, "origem" | "entra_na_margem" | "cobertura_rotulo" | "valor_medido">): Linha => ({
  ...l, origem: null, entra_na_margem: false,
});

const naoCalc = (motivo: string, fonte = "derivado"): Linha =>
  derivada({ valor: null, pct_receita: null, status: "NAO_CALCULAVEL", status_fonte: fonte, motivo });

/** Lista de textos da fonte saneada; o que passa do teto e' DITO, nao sumido. */
function textos(v: readonly string[]): string[] {
  const limpos = v.map((x) => safeText(x, DRE_TEXT_MAX)).filter((x): x is string => x !== null);
  if (limpos.length <= DRE_LIST_MAX) return limpos;
  return [...limpos.slice(0, DRE_LIST_MAX), `(+${limpos.length - DRE_LIST_MAX} itens da fonte omitidos pelo conector)`];
}

type LinhasCenarioIn = NonNullable<z.infer<typeof cenarioPremissas>["linhas"]>;

/** Mapa linha -> valor das linhas do cenario com esta origem; `null` sem linhas na API. */
function linhasDaOrigem(linhas: LinhasCenarioIn | null | undefined, origem: "premissa" | "extrapolado") {
  if (!linhas) return null;
  const out: Record<string, number | null> = {};
  for (const x of linhas) {
    // Estimativa da fonte como veio: ausente continua `null`, nunca 0.
    if (x.origem === origem) out[safeText(x.linha, 60) ?? "?"] = numOrNull(x.valor);
  }
  return out;
}

function projetarCelula(c: CelulaIn, nivel: Nivel, mes: string, loteVencido: boolean): CelulaOut {
  const l = Object.fromEntries(
    NOMES.map((n) => [n, linhaDe(c.componentes[n], loteVencido, DEPENDEM_DO_LOTE.includes(n))]),
  ) as Record<Nome, Linha>;

  const m = c.margem_contribuicao_conhecida;
  const custosUsados = m.componentes_usados.filter((n): n is Nome => (NOMES as readonly string[]).includes(n) && n !== "receita");
  // Custo que a API pos na margem e que o conector NAO expoe (lote vencido,
  // resposta antiga sem `origem`): a margem da API nao pode sair como numero.
  const naoExpostos = custosUsados.filter((n) => !COM_VALOR.includes(l[n].status));
  const algumParcial = custosUsados.some((n) => l[n].status === "PARCIAL");
  const custos: Linha = custosUsados.length > 0 && naoExpostos.length === 0
    ? derivada({
        valor: custosUsados.reduce((acc, n) => acc + (l[n].valor ?? 0), 0),
        pct_receita: null,
        status: algumParcial ? "PARCIAL" : "CALCULADO",
        status_fonte: "derivado",
        motivo: `soma de ${custosUsados.join(", ")}`,
      })
    : naoCalc(custosUsados.length === 0 ? "nenhum custo na margem da fonte" : "ha custo usado na margem sem valor exposto");

  const parciaisApi = (m.componentes_parciais ?? []).filter((n) => typeof n === "string");
  const margemValor = numOrNull(m.valor);
  const semCmv = !custosUsados.includes("cmv");
  let resultado: Linha;
  if (margemValor === null || !COM_VALOR.includes(l.receita.status)) {
    resultado = naoCalc(margemValor === null ? "a fonte nao calculou a margem conhecida (sem receita)" : "receita sem valor exposto: margem nao existe");
  } else if (naoExpostos.length > 0) {
    resultado = naoCalc(`custo usado na margem pela fonte sem valor exposto (${naoExpostos.join(", ")}): margem nao exposta`);
  } else {
    const porque: string[] = [];
    if (parciaisApi.length > 0) porque.push(`custos parciais na conta (${parciaisApi.join(", ")})`);
    if (l.receita.status === "PARCIAL") porque.push("receita parcial");
    if (semCmv) porque.push("sem CMV na conta: margem muito acima da real");
    resultado = derivada({
      valor: margemValor,
      pct_receita: numOrNull(m.pct_receita),
      status: porque.length > 0 || algumParcial ? "PARCIAL" : "CALCULADO",
      status_fonte: "derivado",
      motivo: safeText(porque.length > 0 ? `${m.rotulo}; ${porque.join("; ")}` : m.rotulo, DRE_TEXT_MAX),
    });
  }

  const cp = c.cenario_premissas;
  const dm = c.data_maxima;
  return {
    nivel,
    mes: c.mes ?? mes,
    canal: c.canal ?? null,
    marca: c.marca ?? null,
    classificacao_fonte: c.classificacao,
    fecha_em: safeText(c.fecha_em, 10),
    motivos_classificacao: textos(c.motivos_classificacao),
    avisos_qualidade: textos(c.avisos_qualidade),
    receita: l.receita, cmv: l.cmv, ads: l.ads, afiliados: l.afiliados, taxas: l.taxas,
    frete: l.frete, devolucoes: l.devolucoes, impostos: l.impostos,
    custos_conhecidos: custos,
    resultado,
    margem_pct: COM_VALOR.includes(resultado.status) ? numOrNull(m.pct_receita) : null,
    componentes_faltando: m.faltam,
    // Mesma regra de `margemPrincipal` (src/lib/dre.ts): previa = classificacao
    // PREVIA ou `previa` da API; estimada so' com numero finito no cenario.
    margem_principal:
      (c.classificacao === "PREVIA" || c.previa === true) && cp && numOrNull(cp.margem_contribuicao_estimada) !== null
        ? "estimada"
        : "conhecida",
    margem_conhecida: {
      componentes_usados: m.componentes_usados,
      componentes_parciais: parciaisApi,
      aviso: safeText(m.aviso, DRE_TEXT_MAX * 2),
    },
    frescor: {
      receita_ultimo_dia: dm.receita_ultimo_dia ?? null,
      mart_carregado_em: dm.mart_carregado_em ?? null,
      cmv_ultima_emissao: dm.cmv_ultima_emissao ?? null,
      repasse_tiktok_atualizado_em: dm.repasse_tiktok_atualizado_em ?? null,
      insumo_publicado_em: dm.insumo_publicado_em ?? null,
    },
    cenario_premissas: cp
      ? {
          natureza: cp.natureza,
          rotulo: cp.rotulo,
          competencia_premissas: cp.competencia_premissas,
          estado: cp.estado,
          previa: cp.previa,
          competencia_madura: cp.competencia_madura,
          // Estimativa da fonte, como veio: `null` continua `null`, nunca 0.
          margem_estimada: numOrNull(cp.margem_contribuicao_estimada),
          margem_estimada_pct: numOrNull(cp.margem_contribuicao_estimada_pct),
          motivos: textos(cp.motivos),
          avisos: textos(cp.avisos),
          celulas_sem_premissa: cp.celulas_sem_premissa ?? null,
          // So' as linhas ESTIMADAS: as realizadas repetem as linhas da DRE e os
          // subtotais ja' estao em margem_estimada (cabe no teto de resposta).
          linhas_premissa: linhasDaOrigem(cp.linhas, "premissa"),
          linhas_extrapoladas: linhasDaOrigem(cp.linhas, "extrapolado"),
        }
      : null,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

const rotuloCelula = (c: CelulaOut) =>
  c.nivel === "total" ? "total" : `${c.nivel}:${c.canal ?? "*"}x${c.marca ?? "*"}`;

const utf8 = new TextEncoder();

/** Bytes do que o cliente recebe: bloco de texto (com o JSON) + structuredContent. */
export function dreResultBytes(env: Envelope<unknown>): number {
  return utf8.encode(JSON.stringify(ok(dreHeadline(env), env))).byteLength;
}

/**
 * Projecao pura do payload da DRE. Contrato quebrado, periodo diferente do
 * pedido ou filtro nao aplicado pela fonte vira INVALID_UPSTREAM_RESPONSE.
 * `maxBytes` limita a resposta inteira; o corte, se houver, e' declarado.
 */
export function projectDre(
  raw: unknown,
  input: DreInput,
  now: Date,
  maxBytes: number = Number.POSITIVE_INFINITY,
): Envelope<DreData> {
  const p = parseUpstream(dreUpstreamContract, raw);
  const mes = input.ref_month;

  // A API cai no periodo padrao se o parametro nao chegar: mes diferente do
  // pedido nunca pode sair rotulado como o mes pedido.
  if (!sameSet(p.periodo.meses, [mes])) throw toolError("INVALID_UPSTREAM_RESPONSE");
  // Filtro pedido e nao ecoado pela fonte = filtro possivelmente ignorado.
  if (input.canais && !sameSet(p.filtros?.canais ?? [], input.canais)) throw toolError("INVALID_UPSTREAM_RESPONSE");
  if (input.marcas && !sameSet(p.filtros?.marcas ?? [], input.marcas)) throw toolError("INVALID_UPSTREAM_RESPONSE");

  const lote = p.fontes.insumos_dre;
  const idade = ageHours(lote.publicado_em ?? null, now);
  const loteVencido = lote.estado !== "ok" || idade === null || idade > DRE_MAX_SNAPSHOT_HOURS;

  const canalOk = (c: CelulaIn) => !input.canais || input.canais.includes(c.canal as never);
  const marcaOk = (c: CelulaIn) => !input.marcas || input.marcas.includes(c.marca as never);
  const grao = p.por_canal_marca.filter((c) => canalOk(c) && marcaOk(c));

  // Ordem de prioridade: o corte por tamanho remove do FIM (canal x marca).
  const todas: CelulaOut[] = [
    ...(p.total ? [projetarCelula(p.total, "total", mes, loteVencido)] : []),
    ...p.por_canal.filter(canalOk).map((c) => projetarCelula(c, "canal", mes, loteVencido)),
    ...p.por_marca.filter(marcaOk).map((c) => projetarCelula(c, "marca", mes, loteVencido)),
    ...grao.map((c) => projetarCelula(c, "canal_marca", mes, loteVencido)),
  ];

  // ---- limitacoes derivadas da resposta (independem do corte) ----
  const fixas: Limitation[] = [];

  const baseImposto = grao.length > 0 ? grao : p.total ? [p.total] : [];
  const comImposto = baseImposto.filter((c) => c.componentes.impostos.status === "disponivel").length;
  if (baseImposto.length > 0 && comImposto < baseImposto.length) {
    const motivos = [...new Set(baseImposto
      .filter((c) => c.componentes.impostos.status !== "disponivel")
      .map((c) => safeText(c.componentes.impostos.motivo, DRE_TEXT_MAX) ?? c.componentes.impostos.status))].slice(0, 3);
    fixas.push({
      topic: "dre_impostos_nao_publicados",
      scope: `DRE ${mes} — impostos`,
      description: (comImposto === 0
        ? `O mes ${mes} nao tem impostos publicados em nenhuma das ${baseImposto.length} celula(s): impostos saem NAO_CALCULAVEL com valor nulo (nunca 0) e ficam fora da margem conhecida.`
        : `Impostos publicados em ${comImposto} de ${baseImposto.length} celula(s) de ${mes}; nas demais saem NAO_CALCULAVEL com valor nulo (nunca 0).`)
        + ` Motivo da fonte: ${motivos.join(" | ")}`,
      motivo: comImposto === 0 ? "IMPOSTOS_NAO_PUBLICADOS" : "IMPOSTOS_PARCIAIS",
    });
  }

  const pr = p.fontes.premissas_dre ?? null;
  const premissasDoMes = !!pr && pr.estado === "ok" && pr.competencias_publicadas.includes(mes);
  if (!premissasDoMes) {
    fixas.push({
      topic: "dre_premissas_nao_publicadas",
      scope: `DRE ${mes} — cenario com premissas`,
      description:
        `Premissas da DRE nao estao publicadas integralmente para ${mes} (estado ${pr?.estado ?? "nao_informado_pela_fonte"}; ` +
        `competencias publicadas: ${pr?.competencias_publicadas.join(", ") || "nenhuma"}${pr?.motivo ? `; motivo: ${safeText(pr.motivo, DRE_TEXT_MAX)}` : ""}). ` +
        "O cenario estimado com premissas fica ausente ou parcial: ausencia nao e' margem estimada zero.",
      motivo: "PREMISSAS_NAO_PUBLICADAS",
    });
  }

  if (loteVencido) {
    fixas.push({
      topic: "dre_insumos_indisponiveis",
      scope: `DRE ${mes} — CMV, taxas e frete`,
      description: `Lote de insumos da DRE ${lote.estado}${idade !== null ? ` (${idade} h)` : ""}: CMV, taxas e frete que dependem dele saem NAO_CALCULAVEL (mesmo parciais), e a margem que os usa nao e' exposta.`,
      motivo: "INSUMOS_INDISPONIVEIS",
    });
  }

  // T-0092 — PREVIA, parciais e cenario estimado: o que o numero E' vem
  // declarado, derivado do que a API marcou (nunca de data fixa).
  const previas = todas.filter((c) => c.classificacao_fonte === "PREVIA");
  if (previas.length > 0) {
    const fechas = [...new Set(previas.map((c) => c.fecha_em).filter((f): f is string => !!f))].sort();
    fixas.push({
      topic: "dre_previa",
      scope: `DRE ${mes} — classificacao PREVIA`,
      description:
        `${previas.length} recorte(s) de ${mes} sao PREVIA: mes imaturo (regra M+2) com numeros provisorios` +
        `${fechas.length ? `, que fecham em ${fechas.join(", ")}` : ""}. Previa e' ESTIMATIVA do mes em andamento: ` +
        "os valores mudam ate' o fechamento e nao devem ser tratados como DRE fechada.",
      motivo: "DRE_PREVIA",
    });
  }

  const linhasDe = (c: CelulaOut) => NOMES.map((n) => [n, c[n]] as const);
  const parciais = todas.flatMap((c) => linhasDe(c).filter(([, x]) => x.status === "PARCIAL").map(([n]) => n));
  const extrapolados = todas.flatMap((c) => linhasDe(c).filter(([, x]) => x.status === "PARCIAL" && x.origem === "extrapolado").map(([n]) => n));
  const margensParciais = todas.filter((c) => c.resultado.status === "PARCIAL").length;
  if (parciais.length > 0 || margensParciais > 0) {
    fixas.push({
      topic: "dre_componentes_parciais",
      scope: `DRE ${mes} — componentes e margem parciais`,
      description:
        `${parciais.length} linha(s) (${[...new Set(parciais)].join(", ") || "nenhuma"}) sairam PARCIAL: valor medido com COBERTURA INCOMPLETA ` +
        "(veja cobertura_rotulo e status_fonte), nao valor fechado." +
        (extrapolados.length ? ` ${extrapolados.length} delas (${[...new Set(extrapolados)].join(", ")}) sao EXTRAPOLADAS: o medido (valor_medido) estendido a' receita inteira pela razao coberta — estimativa, nao medida.` : "") +
        ` ${margensParciais} margem(ns) conhecida(s) PARCIAL: entram so' os custos com entra_na_margem; custo nao medido nao entra, ` +
        "entao a margem tende a estar ACIMA da real (veja margem_conhecida.aviso e componentes_faltando).",
      motivo: "COMPONENTES_PARCIAIS",
    });
  }

  const comCenario = todas.filter((c) => c.cenario_premissas !== null);
  if (comCenario.length > 0) {
    fixas.push({
      topic: "dre_cenario_estimado",
      scope: `DRE ${mes} — cenario_premissas`,
      description:
        `cenario_premissas (${comCenario.length} recorte(s)) e' ESTIMATIVA com premissas de orcamento, nao realizado: linhas_premissa ` +
        "sao taxa de orcamento aplicada a' receita (premissas nao foram medidas); linhas_extrapoladas = realizado parcial estendido ao todo. " +
        "Nao some o cenario ao realizado nem o cite como fato medido.",
      motivo: "CENARIO_ESTIMADO",
    });
  }

  // Valor que a fonte tem e o conector NAO expoe (origem indisponivel com
  // numero, resposta antiga sem `origem`, lote vencido): dito, nunca zero.
  const brutas: Array<[CelulaIn, Nivel]> = [
    ...(p.total ? [[p.total, "total"] as [CelulaIn, Nivel]] : []),
    ...p.por_canal.filter(canalOk).map((c) => [c, "canal"] as [CelulaIn, Nivel]),
    ...p.por_marca.filter(marcaOk).map((c) => [c, "marca"] as [CelulaIn, Nivel]),
    ...grao.map((c) => [c, "canal_marca"] as [CelulaIn, Nivel]),
  ];
  const ocultos = brutas.flatMap(([c], i) => NOMES.filter((n) => {
    const k = c.componentes[n];
    return k.valor !== null && k.valor !== undefined && todas[i][n].valor === null;
  }));
  if (ocultos.length > 0) {
    fixas.push({
      topic: "dre_valor_nao_confirmado",
      scope: `DRE ${mes} — componentes sem valor exposto`,
      description:
        `${ocultos.length} componente(s) (${[...new Set(ocultos)].join(", ")}) tem valor na fonte que o conector nao expoe ` +
        "(origem indisponivel na API, resposta sem origem com status diferente de disponivel, ou lote vencido). " +
        "Saem com valor nulo, status_fonte e motivo: numero nao confirmado nao e' exposto, nem como zero.",
      motivo: "VALOR_NAO_CONFIRMADO",
    });
  }

  fixas.push({
    topic: "dre_campos_omitidos",
    scope: "DRE — detalhe",
    description:
      "Para caber no teto de resposta, esta tool nao devolve celulas_base (repete o grao canal x marca, ja em celulas), " +
      "as linhas do cenario de premissas com origem realizada/parcial/calculada (repetem a DRE ou viram margem_estimada) nem rotulo, motivo e " +
      "percentual das linhas estimadas (saem so' linha -> valor em linhas_premissa e linhas_extrapoladas), " +
      "nem partes/fonte/cobertura numerica dos componentes. cobertura_rotulo e valor_medido so' aparecem quando a API os da. " +
      "O detalhe esta na tela DRE da Torre.",
    motivo: "CAMPOS_OMITIDOS",
  });

  const warnings: string[] = [];
  if (loteVencido) {
    warnings.push(`Insumos da DRE indisponiveis (lote ${lote.estado}${idade !== null ? `, ${idade} h` : ""}): CMV, taxas e frete dependentes do lote nao sao calculados.`);
  }

  const montar = (k: number): Envelope<DreData> => {
    const kept = todas.slice(0, k);
    const cortadas = todas.slice(k);
    const limitations = [...fixas];
    let corte: DreData["corte"] = null;
    const extra: string[] = [];
    if (cortadas.length > 0) {
      const omitidas = cortadas.map(rotuloCelula);
      const comoObter = "repita a chamada filtrando por canais e/ou marcas para receber as celulas omitidas";
      corte = { celulas_omitidas: cortadas.length, omitidas, como_obter: comoObter };
      limitations.push({
        topic: "dre_corte_por_tamanho",
        scope: `DRE ${mes} — resposta`,
        description: `A resposta passaria do teto de ${Math.round(DRE_MAX_RESPONSE_BYTES / 1024)} KB: ${cortadas.length} celula(s) ficaram fora (${omitidas.join(", ")}). Nada foi somado nem zerado; ${comoObter}.`,
        motivo: "RESPONSE_SIZE_CAP",
      });
      extra.push(`Resposta cortada pelo teto de tamanho: ${cortadas.length} celula(s) omitida(s) — veja data.corte.`);
    }
    const data: DreData = {
      ref_month: mes,
      periodo_origem: p.periodo.origem ?? null,
      snapshot: {
        estado: lote.estado,
        lote_publicado_em: lote.publicado_em ?? null,
        lote_publicado_em_mais_recente: lote.publicado_em_mais_recente ?? null,
        idade_horas: idade,
        insumos_disponiveis: !loteVencido,
        motivo: safeText(lote.motivo, DRE_TEXT_MAX),
      },
      premissas: {
        estado: pr?.estado ?? "nao_informado_pela_fonte",
        publicadas_para_o_mes: premissasDoMes,
        competencias_publicadas: pr?.competencias_publicadas ?? [],
        rotulo: pr?.rotulo ?? null,
        data_fonte: pr?.data_fonte ?? null,
        carregado_em: pr?.carregado_em ?? null,
        motivo: safeText(pr?.motivo, DRE_TEXT_MAX),
      },
      total: kept.find((c) => c.nivel === "total") ?? null,
      por_canal: kept.filter((c) => c.nivel === "canal"),
      por_marca: kept.filter((c) => c.nivel === "marca"),
      celulas: kept.filter((c) => c.nivel === "canal_marca"),
      corte,
      limitations,
    };
    return buildEnvelope({
      period: { start: `${mes}-01`, end: ultimoDia(mes), inclusive: true },
      filtersApplied: {
        ref_month: mes,
        canais: p.filtros?.canais ?? input.canais ?? null,
        marcas: p.filtros?.marcas ?? input.marcas ?? null,
      },
      metricDefinition:
        "Resultado = margem de contribuicao CONHECIDA da API (receita menos os custos com entra_na_margem). Nao e' lucro nem margem liquida. " +
        "Status PARCIAL = custo ou margem com cobertura incompleta (parcial ou extrapolado); a margem tende a ficar acima da real. " +
        "Classificacao PREVIA = mes imaturo (M+2), numeros provisorios ate' fecha_em. cenario_premissas e' ESTIMATIVA com premissas de orcamento, nao realizado.",
      refreshedAt: lote.publicado_em ?? null,
      coverage: "total, por canal, por marca e celulas mes x canal x marca da DRE gerencial",
      returnedCount: kept.length,
      totalCount: todas.length,
      warnings: [...warnings, ...extra],
      data,
    });
  };

  let k = todas.length;
  let env = montar(k);
  while (k > 1 && dreResultBytes(env) > maxBytes) {
    k -= 1;
    env = montar(k);
  }
  // So' o total e ainda acima do teto: falha fechada, nunca resposta muda.
  if (dreResultBytes(env) > maxBytes) throw toolError("INVALID_UPSTREAM_RESPONSE");
  return env;
}

function ultimoDia(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(d).padStart(2, "0")}`;
}

export function dreHeadline(env: Envelope<unknown>): string {
  const d = env.data as DreData;
  const cls = d.total
    ? `${d.total.classificacao_fonte}${d.total.fecha_em ? ` (fecha em ${d.total.fecha_em})` : ""}`
    : "sem total";
  const corte = d.corte ? ` (${d.corte.celulas_omitidas} omitida(s) pelo teto de tamanho)` : "";
  return (
    `DRE ${d.ref_month}: total ${cls}; ${d.celulas.length} celula(s) canal x marca${corte}; ` +
    `insumos ${d.snapshot.estado}${d.snapshot.insumos_disponiveis ? "" : " (indisponiveis)"}; premissas ${d.premissas.estado}. ` +
    "Valor nulo = nao calculado, nunca zero."
  );
}

export const dreTool: OracleTool = {
  name: DRE_TOOL_NAME,
  config: {
    title: "DRE gerencial mensal (margem de contribuicao conhecida)",
    description: [
      "Use para 'DRE de outubro', 'margem de contribuicao por canal ou marca', 'CMV, taxas, frete, ads, afiliados, impostos do mes'.",
      "Um mes por chamada (ref_month YYYY-MM), com filtro opcional de canais e marcas. Devolve o total, por canal, por marca e as celulas canal x marca da DRE gerencial da Torre.",
      "Cada linha traz valor, status (CALCULADO, PARCIAL, NAO_CALCULAVEL, NAO_APLICAVEL), status_fonte (o status real da API: parcial, nao_reconciliado, indisponivel...), motivo, origem (realizado, parcial, extrapolado...), entra_na_margem e cobertura_rotulo. PARCIAL = valor com cobertura incompleta (extrapolado: valor_medido e' o medido cru). Valor nulo = nao calculado, nunca zero.",
      "Resultado = margem de contribuicao CONHECIDA da API, com margem_conhecida (componentes_usados, componentes_parciais, aviso); com parciais ou sem CMV ela sai PARCIAL e tende a ficar acima da real; nao e' lucro. cenario_premissas (com linhas_premissa e linhas_extrapoladas) e' ESTIMATIVA com premissas de orcamento, nao realizado: origem premissa nao foi medida.",
      "Mes imaturo (regra M+2) sai com classificacao_fonte PREVIA e fecha_em (data em que fecha): numeros provisorios. PREVIA, parciais, cenario estimado, impostos e premissas nao publicados, insumos vencidos e qualquer corte por tamanho aparecem em limitations.",
    ].join(" "),
    inputSchema: dreInput,
    outputSchema: dreOutput,
  },
  async run(args, deps) {
    const input = dreInput.parse(args);
    const raw = await deps.client.get("dre", {
      ref_month: input.ref_month,
      // A rota le CSV (`Optional[str]`): lista vai pronta, na ordem canonica.
      channels: input.canais ? CHANNELS.filter((c) => input.canais!.includes(c)).join(",") : undefined,
      brands: input.marcas ? [...input.marcas].sort().join(",") : undefined,
    });
    const env = projectDre(raw, input, deps.now(), DRE_MAX_RESPONSE_BYTES);
    return ok(dreHeadline(env), env);
  },
};
