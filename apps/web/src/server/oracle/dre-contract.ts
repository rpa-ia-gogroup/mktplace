/**
 * torre_dre — DRE gerencial mensal (MCP-COVERAGE-2 Fase 4; ativada na T-0080 P2,
 * 11/11/2026, por decisao do Mario: a DRE sai pelo MCP, inclusive CMV e margem).
 *
 * Le `GET /api/v1/dre?ref_month=YYYY-MM` (opcionalmente `channels`/`brands`,
 * CSV) e devolve o total, por canal, por marca e as celulas canal x marca.
 *
 * REGRAS (nenhum valor ausente vira zero):
 * - cada linha da DRE sai como `{ valor, pct_receita, status, status_fonte,
 *   motivo }`, com status CALCULADO, NAO_CALCULAVEL ou NAO_APLICAVEL. So'
 *   `disponivel` na fonte vira CALCULADO; `nao_aplicavel` vira NAO_APLICAVEL;
 *   QUALQUER outro status (parcial, indisponivel, snapshot_*, provisorio,
 *   nao_reconciliado, nao_confirmado, sinal_inesperado) vira NAO_CALCULAVEL
 *   com `valor=null` e o status/motivo originais preservados;
 * - insumo publicado ha mais de 54 h (ou lote nao `ok`) torna CMV, taxas e
 *   frete que dependem dele NAO_CALCULAVEL — mesmo que a fonte diga outra coisa;
 * - margem (resultado e %) so' existe quando o CMV esta CALCULADO;
 * - custos conhecidos so' quando TODOS os custos usados na margem estao
 *   CALCULADOS;
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

const componente = z.object({
  valor: z.number().finite().nullish(),
  pct_receita: z.number().finite().nullish(),
  status: z.enum(STATUS_FONTE),
  motivo: optStr,
  somavel: z.boolean(),
  publicado_em: optStr,
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
});

const celula = z.object({
  mes: optStr,
  canal: optStr,
  marca: optStr,
  classificacao: z.enum(["COMPLETA", "PARCIAL", "NAO_CALCULAVEL"]),
  motivos_classificacao: z.array(z.string()),
  avisos_qualidade: z.array(z.string()),
  componentes: z.object(Object.fromEntries(NOMES.map((n) => [n, componente])) as Record<Nome, typeof componente>),
  margem_contribuicao_conhecida: z.object({
    valor: z.number().finite().nullish(),
    pct_receita: z.number().finite().nullish(),
    rotulo: z.string(),
    componentes_usados: z.array(z.string()),
    faltam: z.array(z.string()),
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

export const DRE_STATUS = ["CALCULADO", "NAO_CALCULAVEL", "NAO_APLICAVEL"] as const;
type DreStatus = (typeof DRE_STATUS)[number];

const NIVEIS = ["total", "canal", "marca", "canal_marca"] as const;
type Nivel = (typeof NIVEIS)[number];

const linha = z.object({
  valor: z.number().nullable(),
  pct_receita: z.number().nullable(),
  status: z.enum(DRE_STATUS),
  status_fonte: z.string(),
  motivo: z.string().nullable(),
});

const celulaOut = z.object({
  nivel: z.enum(NIVEIS),
  mes: z.string(),
  canal: z.string().nullable(),
  marca: z.string().nullable(),
  classificacao_fonte: z.string(),
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

function mapStatus(s: (typeof STATUS_FONTE)[number]): DreStatus {
  if (s === "disponivel") return "CALCULADO";
  if (s === "nao_aplicavel") return "NAO_APLICAVEL";
  return "NAO_CALCULAVEL";
}

function linhaDe(
  c: z.infer<typeof componente>,
  loteVencido: boolean,
  dependeDoLote: boolean,
): Linha {
  // Insumo vencido derruba o componente MESMO que a fonte ainda o diga
  // disponivel: o conector nao confia num lote fora da janela.
  if (dependeDoLote && c.publicado_em && loteVencido && c.status === "disponivel") {
    return {
      valor: null, pct_receita: null, status: "NAO_CALCULAVEL", status_fonte: "snapshot_vencido",
      motivo: `insumo publicado ha mais de ${DRE_MAX_SNAPSHOT_HOURS} h`,
    };
  }
  const status = mapStatus(c.status);
  const calc = status === "CALCULADO";
  return {
    valor: calc ? numOrNull(c.valor) : null,
    pct_receita: calc ? numOrNull(c.pct_receita) : null,
    status,
    status_fonte: c.status,
    motivo: safeText(c.motivo, DRE_TEXT_MAX),
  };
}

const naoCalc = (motivo: string, fonte = "derivado"): Linha => ({
  valor: null, pct_receita: null, status: "NAO_CALCULAVEL", status_fonte: fonte, motivo,
});

/** Lista de textos da fonte saneada; o que passa do teto e' DITO, nao sumido. */
function textos(v: readonly string[]): string[] {
  const limpos = v.map((x) => safeText(x, DRE_TEXT_MAX)).filter((x): x is string => x !== null);
  if (limpos.length <= DRE_LIST_MAX) return limpos;
  return [...limpos.slice(0, DRE_LIST_MAX), `(+${limpos.length - DRE_LIST_MAX} itens da fonte omitidos pelo conector)`];
}

function projetarCelula(c: CelulaIn, nivel: Nivel, mes: string, loteVencido: boolean): CelulaOut {
  const l = Object.fromEntries(
    NOMES.map((n) => [n, linhaDe(c.componentes[n], loteVencido, DEPENDEM_DO_LOTE.includes(n))]),
  ) as Record<Nome, Linha>;

  const m = c.margem_contribuicao_conhecida;
  const custosUsados = m.componentes_usados.filter((n): n is Nome => (NOMES as readonly string[]).includes(n) && n !== "receita");
  const todosCustosCalc = custosUsados.length > 0 && custosUsados.every((n) => l[n].status !== "NAO_CALCULAVEL");
  const custos: Linha = todosCustosCalc
    ? {
        valor: custosUsados.reduce((acc, n) => acc + (l[n].valor ?? 0), 0),
        pct_receita: null,
        status: "CALCULADO",
        status_fonte: "derivado",
        motivo: `soma de ${custosUsados.join(", ")}`,
      }
    : naoCalc("ha custo usado na margem sem calculo");

  const cmvOk = l.cmv.status === "CALCULADO";
  const resultado: Linha = cmvOk && l.receita.status === "CALCULADO" && todosCustosCalc
    ? { valor: numOrNull(m.valor), pct_receita: numOrNull(m.pct_receita), status: "CALCULADO", status_fonte: "derivado", motivo: m.rotulo }
    : naoCalc(cmvOk ? "componente da margem sem calculo" : "CMV nao calculado: margem nao existe");

  const cp = c.cenario_premissas;
  const dm = c.data_maxima;
  return {
    nivel,
    mes: c.mes ?? mes,
    canal: c.canal ?? null,
    marca: c.marca ?? null,
    classificacao_fonte: c.classificacao,
    motivos_classificacao: textos(c.motivos_classificacao),
    avisos_qualidade: textos(c.avisos_qualidade),
    receita: l.receita, cmv: l.cmv, ads: l.ads, afiliados: l.afiliados, taxas: l.taxas,
    frete: l.frete, devolucoes: l.devolucoes, impostos: l.impostos,
    custos_conhecidos: custos,
    resultado,
    margem_pct: resultado.status === "CALCULADO" ? numOrNull(m.pct_receita) : null,
    componentes_faltando: m.faltam,
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
      description: `Lote de insumos da DRE ${lote.estado}${idade !== null ? ` (${idade} h)` : ""}: CMV, taxas e frete que dependem dele saem NAO_CALCULAVEL, e sem CMV nao ha margem.`,
      motivo: "INSUMOS_INDISPONIVEIS",
    });
  }

  const ocultos = [...(p.total ? [p.total] : []), ...p.por_canal, ...p.por_marca, ...grao]
    .flatMap((c) => NOMES.filter((n) => {
      const k = c.componentes[n];
      return k.status !== "disponivel" && k.valor !== null && k.valor !== undefined;
    }));
  if (ocultos.length > 0) {
    fixas.push({
      topic: "dre_valor_nao_confirmado",
      scope: `DRE ${mes} — componentes nao disponiveis`,
      description:
        `${ocultos.length} componente(s) (${[...new Set(ocultos)].join(", ")}) tem valor na fonte com status diferente de disponivel ` +
        "(ex.: cmv nao_reconciliado ou parcial). O conector devolve valor nulo com status_fonte e motivo: numero nao confirmado nao e' exposto, nem como zero.",
      motivo: "VALOR_NAO_CONFIRMADO",
    });
  }

  fixas.push({
    topic: "dre_campos_omitidos",
    scope: "DRE — detalhe",
    description:
      "Para caber no teto de resposta, esta tool nao devolve celulas_base (repete o grao canal x marca, ja em celulas), " +
      "as linhas detalhadas do cenario de premissas (so' estado, margem estimada e motivos) nem partes/fonte/cobertura dos componentes. " +
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
        "Resultado = margem de contribuicao CONHECIDA (receita menos custos conhecidos). Nao e' lucro nem margem liquida. Margem so' com CMV calculado. cenario_premissas e' ESTIMATIVA com premissas de orcamento, nao realizado.",
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
  const cls = d.total ? d.total.classificacao_fonte : "sem total";
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
      "Cada linha traz valor, status (CALCULADO, NAO_CALCULAVEL, NAO_APLICAVEL), status_fonte (o status real da API: parcial, nao_reconciliado, indisponivel...) e motivo. Valor nulo = nao calculado, nunca zero.",
      "Resultado = margem de contribuicao CONHECIDA, so' com CMV calculado; nao e' lucro. cenario_premissas e' ESTIMATIVA com premissas de orcamento, nao realizado.",
      "Mes imaturo (regra M+2) aparece em motivos_classificacao; impostos e premissas nao publicados, insumos vencidos e qualquer corte por tamanho aparecem em limitations.",
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
