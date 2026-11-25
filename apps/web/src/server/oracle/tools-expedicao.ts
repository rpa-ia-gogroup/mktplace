/**
 * torre_expedicao_operacional — MCP-COVERAGE-2.
 *
 * Backlog, vencidos, em risco, travados e evolucao da Expedicao, por canal.
 *
 * O QUE ESTA TOOL NUNCA DEVOLVE: fila por pedido. `include_queue=false` e' fixo
 * aqui E travado no adapter (`torre-client.ts`). Nenhum `order_ref`, cliente,
 * endereco ou pedido individual: so' agregados por canal, conta/loja e data.
 *
 * TRES REGRAS DE LEITURA, todas derivadas do payload:
 * 1. O resumo de `/expedicao` IGNORA `brands` (o backend so' filtra a fila).
 *    Por isso o filtro de marca e' aplicado AQUI, somando as contas do mesmo
 *    lote — exatamente a definicao de `totals` do backend. Marca sem conta no
 *    canal vira `marcas_sem_conta`, nunca backlog zero.
 * 2. Prazo nao publicado nao e' "zero vencidos": quando todo o backlog esta em
 *    `deadline_unavailable` (o Mercado Livre sem SLA na fotografia), vencidos/em risco/no prazo
 *    saem nulos.
 * 3. A LDR do TikTok traz `deadline_is_reconstructed`: enquanto for `true`, e'
 *    medicao INTERNA, nao a oficial de penalizacao da plataforma.
 * 4. LDR de ML/Shopee (`ldr` de cada canal): ML e' sempre calculo Torre; Shopee
 *    traz `official=false` + `disclaimer`. A falha da LDR NAO derruba a fila (sai
 *    indisponivel com motivo). O ML nao devolve total: a taxa do canal e' a soma
 *    de atrasados/base das marcas (`taxa_origem`), nunca media de taxas.
 * "Vencem hoje" por etapa NAO existe na API allowlisted: `em_risco_24h` e
 * `ldr.vencem_hoje_ou_amanha` (Shopee) sao os proxies; nada e' inventado.
 */
import { z } from "zod";

import { buildEnvelope } from "./envelope.ts";
import {
  EXP_BRAND_FILTER_LOCAL, EXP_DEADLINE_NOT_PUBLISHED, EXP_MANUAL_SNAPSHOT,
  EXP_NO_ORDER_LEVEL, EXP_TIKTOK_OFFICIAL, EXP_TIKTOK_RECONSTRUCTED, type Limitation,
} from "./limitations.ts";
import { BRANDS, noDuplicates } from "./schemas.ts";
import {
  ageHours, envelopeSchema, limitationSchema, ok, safeText, safeTexts, type OracleTool, type ToolDeps,
} from "./tool-kit.ts";
import { numOrNull } from "./torre-client.ts";
import { parseUpstream } from "./upstream.ts";
import {
  expedicaoContract, expedicaoMlLdrContract, expedicaoShopeeLdrContract, expedicaoTiktokContract,
  expedicaoTrendContract,
} from "./upstream-operacional.ts";

export const EXP_CANAIS = ["shopee", "ml", "tiktok"] as const;
type ExpCanal = (typeof EXP_CANAIS)[number];

/**
 * Janela de tendencia. O backend aceita ate 336 h, mas cada ponto (conta x
 * hora) pesa ~450 B: com refresh horario, 336 h x 4 contas passaria do teto de
 * 256 KB do adapter e a tool falharia. 96 h x 4 contas fica em ~173 KB.
 */
export const EXP_TREND_MAX_HOURS = 96;
/** Janela da LDR. 90 dias = teto do backend. */
export const EXP_TIKTOK_MAX_DAYS = 90;
/** Janela da LDR de ML/Shopee (teto do ML: 30; a Shopee aceitaria 35). */
export const EXP_LDR_MAX_DAYS = 30;

const EXP_LDR_INTERNA: Limitation = {
  topic: "ldr_ml_shopee_interna",
  scope: "Expedicao — LDR Mercado Livre/Shopee",
  description:
    "A LDR de ML e Shopee desta resposta e' calculo INTERNO da Torre (coleta x prazo), nao a taxa oficial de penalizacao/reputacao da plataforma: pode divergir do painel delas. Sem taxa (null) = sem base ou cobertura insuficiente, nunca 0%.",
};

const EXP_VENCEM_HOJE: Limitation = {
  topic: "expedicao_vencem_hoje",
  scope: "Expedicao — vencem hoje",
  description:
    "'Vencem hoje' por etapa e 'coleta perdida' do TikTok nao sao servidos por este conector. O proxy e' em_risco_24h (fila) e, na Shopee, ldr.vencem_hoje_ou_amanha. Nao estime vencimentos do dia a partir de outros numeros.",
};

export const expedicaoInput = z
  .object({
    canais: noDuplicates(z.array(z.enum(EXP_CANAIS)).min(1).max(3), "canais").optional(),
    marcas: noDuplicates(z.array(z.enum(BRANDS)).min(1).max(5), "marcas").optional(),
    tendencia_horas: z.number().int().min(1).max(EXP_TREND_MAX_HOURS).default(72),
    tiktok_evento: z.enum(["coleta", "despacho"]).default("coleta"),
    tiktok_dias: z.number().int().min(1).max(EXP_TIKTOK_MAX_DAYS).default(7),
    ldr_dias: z.number().int().min(1).max(EXP_LDR_MAX_DAYS).default(7),
  })
  .strict();

const API_CHANNEL: Record<"shopee" | "ml", string> = { shopee: "shopee", ml: "mercadolivre" };

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

const contagens = {
  backlog: z.number(),
  /** null = canal nao publica prazo para este backlog (nao e' zero). */
  vencidos: z.number().nullable(),
  em_risco_24h: z.number().nullable(),
  no_prazo: z.number().nullable(),
  sem_prazo_publicado: z.number(),
  acima_48h: z.number(),
  travados: z.number(),
  lentos: z.number(),
  zumbis: z.number(),
};

const prazoEstado = z.enum(["medido", "parcial", "nao_publicado_pelo_canal", "sem_backlog"]);

const ldrBlock = z.object({
  disponibilidade: z.enum(["available", "unavailable"]),
  motivo_indisponivel: z.string().nullable(),
  /** interna_nao_oficial = calculo Torre; NAO e' a taxa de penalizacao da plataforma. */
  medicao: z.enum(["interna_nao_oficial", "oficial_marketplace"]),
  aviso_medicao: z.string().nullable(),
  janela: z
    .object({ inicio: z.string(), fim: z.string(), dias_pedidos: z.number(), dias_fechados: z.number() })
    .nullable(),
  /** null = sem base (ou cobertura insuficiente). Nunca 0% fabricado. */
  taxa: z.number().nullable(),
  /** api = taxa entregue pela API; soma_das_marcas = atrasados/base somados das marcas (ML). */
  taxa_origem: z.enum(["api", "soma_das_marcas"]).nullable(),
  taxa_oculta_motivo: z.string().nullable(),
  base: z.number().nullable(),
  atrasados: z.number().nullable(),
  /** Shopee: passaram do prazo e nao foram coletados. null = o canal nao entrega. */
  pendentes_vencidos: z.number().nullable(),
  /** Shopee: vencem hoje ou amanha e ainda podem ser coletados (proxy de 'vencem hoje'). */
  vencem_hoje_ou_amanha: z.number().nullable(),
  cobertura: z.string().nullable(),
  fonte_vencida: z.boolean().nullable(),
  idade_horas: z.number().nullable(),
  por_marca: z.array(
    z.object({ brand: z.string(), base: z.number(), atrasados: z.number(), taxa: z.number().nullable(), cobertura: z.string().nullable() }),
  ),
  /** Marcas pedidas sem linha de LDR no canal. Ausencia, nao LDR zero. */
  marcas_sem_base: z.array(z.string()),
  por_vencimento: z.array(
    z.object({ data_vencimento: z.string(), base: z.number(), atrasados: z.number(), taxa: z.number().nullable(), maduro: z.boolean() }),
  ),
  alertas: z.array(z.object({ severidade: z.string(), codigo: z.string(), mensagem: z.string() })),
});

type LdrBlock = z.infer<typeof ldrBlock>;

const filaBlock = z.object({
  canal: z.enum(["shopee", "ml"]),
  disponibilidade: z.enum(["available", "unavailable"]),
  motivo_indisponivel: z.string().nullable(),
  fotografia: z
    .object({
      effective_at: z.string(),
      snapshot_hour: z.string(),
      idade_horas: z.number().nullable(),
      load_mode: z.string(),
      source_health: z.string(),
      run_status: z.string().nullable(),
    })
    .nullable(),
  prazo: prazoEstado.nullable(),
  totais: z.object(contagens).nullable(),
  por_conta: z.array(
    z.object({ shop_account: z.string(), brand: z.string(), prazo: prazoEstado, ...contagens }),
  ),
  frescor_por_marca: z.array(
    z.object({ brand: z.string(), freshness: z.string(), source_age_hours: z.number().nullable() }),
  ),
  contas_faltando: z.array(z.string()),
  contas_inesperadas: z.array(z.string()),
  marcas_nao_cobertas_pela_fonte: z.array(z.string()),
  /** Marcas pedidas que nao tem conta neste canal. Nao e' backlog zero. */
  marcas_sem_conta: z.array(z.string()),
  tendencia: z.object({
    disponibilidade: z.enum(["available", "unavailable"]),
    janela_horas: z.number().nullable(),
    truncada: z.boolean(),
    motivo_indisponivel: z.string().nullable(),
    pontos: z.array(
      z.object({
        snapshot_hour: z.string(),
        contas_observadas: z.number(),
        /** false = nem todas as contas do escopo apareceram nesta hora. */
        completo: z.boolean(),
        backlog: z.number(),
        vencidos: z.number().nullable(),
        acima_48h: z.number(),
        travados: z.number(),
      }),
    ),
  }),
  notas_da_fonte: z.array(z.string()),
  /** LDR de despacho/coleta no prazo (ML: calculo Torre; Shopee: official=false). */
  ldr: ldrBlock,
});

const tiktokBlock = z.object({
  canal: z.literal("tiktok"),
  disponibilidade: z.enum(["available", "unavailable"]),
  motivo_indisponivel: z.string().nullable(),
  evento: z.string(),
  /** interna_reconstruida = prazo reconstruido pela Torre; NAO e' a oficial. */
  medicao: z.enum(["interna_reconstruida", "oficial_marketplace"]),
  sla_dias_uteis: z.number().nullable(),
  meta_tiktok_ldr: z.number().nullable(),
  limiar_critico_interno: z.number().nullable(),
  fotografia: z
    .object({
      effective_at: z.string(),
      source_watermark_at: z.string().nullable(),
      today_brt: z.string(),
      idade_horas: z.number().nullable(),
    })
    .nullable(),
  ldr: z
    .object({
      janela_inicio: z.string(),
      janela_fim: z.string(),
      dias: z.number(),
      /** null = sem base no periodo. Nunca 0% fabricado. */
      taxa: z.number().nullable(),
      base: z.number(),
      atrasados: z.number(),
      pendentes_vencidos: z.number(),
      pendentes_no_prazo: z.number(),
      pendentes_em_risco: z.number(),
      dias_maduros: z.number(),
      dias_parciais: z.number(),
      acima_da_meta: z.boolean(),
      critico_interno: z.boolean(),
      incidente_inicio: z.string().nullable(),
      incidente_fim: z.string().nullable(),
    })
    .nullable(),
  ldr_por_vencimento: z.array(
    z.object({
      data_vencimento: z.string(),
      base: z.number(),
      atrasados: z.number(),
      pendentes_vencidos: z.number(),
      taxa: z.number().nullable(),
      maduro: z.boolean(),
      acima_da_meta: z.boolean(),
      critico_interno: z.boolean(),
    }),
  ),
  por_loja: z.array(
    z.object({
      brand: z.string(),
      loja: z.string().nullable(),
      base: z.number(),
      atrasados: z.number(),
      taxa: z.number().nullable(),
      acima_da_meta: z.boolean(),
    }),
  ),
  alertas: z.array(z.object({ severidade: z.string(), codigo: z.string(), mensagem: z.string() })),
});

const expedicaoOutput = envelopeSchema(
  z.object({
    shopee: filaBlock.nullable(),
    ml: filaBlock.nullable(),
    tiktok: tiktokBlock.nullable(),
    limitations: z.array(limitationSchema),
  }),
);

type FilaBlock = z.infer<typeof filaBlock>;
type TiktokBlock = z.infer<typeof tiktokBlock>;
type Medidas = {
  backlog_count: number; overdue_count: number; due_within_24h_count: number;
  on_time_count: number; deadline_unavailable_count: number; over_48h_count: number;
  slow_count: number; zombie_count: number; stalled_count: number;
};

const MEDIDAS: (keyof Medidas)[] = [
  "backlog_count", "overdue_count", "due_within_24h_count", "on_time_count",
  "deadline_unavailable_count", "over_48h_count", "slow_count", "zombie_count", "stalled_count",
];

function somar(rows: Medidas[]): Medidas {
  const out = Object.fromEntries(MEDIDAS.map((m) => [m, 0])) as Medidas;
  for (const r of rows) for (const m of MEDIDAS) out[m] += r[m];
  return out;
}

/** Regra 2: prazo nao publicado nunca vira "zero vencidos". */
function estadoPrazo(m: Medidas): z.infer<typeof prazoEstado> {
  if (m.backlog_count === 0) return "sem_backlog";
  if (m.deadline_unavailable_count >= m.backlog_count) return "nao_publicado_pelo_canal";
  if (m.deadline_unavailable_count > 0) return "parcial";
  return "medido";
}

function contar(m: Medidas) {
  const semPrazo = estadoPrazo(m) === "nao_publicado_pelo_canal";
  return {
    backlog: m.backlog_count,
    vencidos: semPrazo ? null : m.overdue_count,
    em_risco_24h: semPrazo ? null : m.due_within_24h_count,
    no_prazo: semPrazo ? null : m.on_time_count,
    sem_prazo_publicado: m.deadline_unavailable_count,
    acima_48h: m.over_48h_count,
    travados: m.stalled_count,
    lentos: m.slow_count,
    zumbis: m.zombie_count,
  };
}

function ldrIndisponivel(motivo: string, medicao: LdrBlock["medicao"] = "interna_nao_oficial"): LdrBlock {
  return {
    disponibilidade: "unavailable", motivo_indisponivel: motivo, medicao, aviso_medicao: null, janela: null,
    taxa: null, taxa_origem: null, taxa_oculta_motivo: null, base: null, atrasados: null,
    pendentes_vencidos: null, vencem_hoje_ou_amanha: null, cobertura: null, fonte_vencida: null,
    idade_horas: null, por_marca: [], marcas_sem_base: [], por_vencimento: [], alertas: [],
  };
}

function porVencimento(daily: { due_date: string; base: number; late: number; rate?: number | null; is_mature: boolean }[]) {
  return daily.map((d) => ({
    data_vencimento: d.due_date, base: d.base, atrasados: d.late, taxa: numOrNull(d.rate), maduro: d.is_mature,
  }));
}

function ldrMl(p: z.infer<typeof expedicaoMlLdrContract>, marcas: readonly string[] | undefined): LdrBlock {
  const aviso = "Calculo interno da Torre (SLA de despacho do ML x coleta), nao a metrica oficial de reputacao do Mercado Livre.";
  if (p.availability === "unavailable") {
    return { ...ldrIndisponivel(safeText(p.unavailable_reason) ?? "sem_motivo_informado"), aviso_medicao: aviso };
  }
  const brands = p.brands ?? [];
  // O ML nao entrega total: soma de contagens das marcas (nunca media de taxas).
  const base = brands.reduce((a, b) => a + b.base, 0);
  const late = brands.reduce((a, b) => a + b.late, 0);
  return {
    ...ldrIndisponivel(""), disponibilidade: "available", motivo_indisponivel: null, aviso_medicao: aviso,
    janela: { inicio: p.from, fim: p.to, dias_pedidos: p.requested_days, dias_fechados: p.mature_days },
    taxa: base > 0 ? late / base : null, taxa_origem: base > 0 ? "soma_das_marcas" : null,
    base, atrasados: late,
    por_marca: brands.map((b) => ({ brand: b.brand, base: b.base, atrasados: b.late, taxa: numOrNull(b.rate), cobertura: null })),
    marcas_sem_base: (marcas ?? []).filter((m) => !brands.some((b) => b.brand === m)),
    por_vencimento: porVencimento(p.daily ?? []),
  };
}

function ldrShopee(p: z.infer<typeof expedicaoShopeeLdrContract>, marcas: readonly string[] | undefined): LdrBlock {
  const medicao = p.official ? "oficial_marketplace" : "interna_nao_oficial";
  const aviso = p.official ? null : (safeText(p.disclaimer) ?? "Indicador interno, nao a taxa oficial de penalizacao da Shopee.");
  const l = p.ldr;
  if (p.availability === "unavailable" || !l) {
    return { ...ldrIndisponivel(safeText(p.unavailable_reason) ?? "sem_motivo_informado", medicao), aviso_medicao: aviso };
  }
  const taxa = numOrNull(l.rate);
  return {
    ...ldrIndisponivel("", medicao), disponibilidade: "available", motivo_indisponivel: null, aviso_medicao: aviso,
    janela: { inicio: l.from, fim: l.to, dias_pedidos: l.days, dias_fechados: l.mature_due_days },
    taxa, taxa_origem: taxa === null ? null : "api", taxa_oculta_motivo: safeText(l.rate_hidden_reason),
    base: l.base, atrasados: l.late, pendentes_vencidos: l.pending_overdue, vencem_hoje_ou_amanha: l.pending_at_risk,
    cobertura: p.coverage?.state ?? null,
    fonte_vencida: p.snapshot?.stale ?? null,
    idade_horas: numOrNull(p.snapshot?.age_hours),
    por_marca: p.brands.map((b) => ({ brand: b.brand, base: b.base, atrasados: b.late, taxa: numOrNull(b.rate), cobertura: b.coverage_state })),
    marcas_sem_base: (marcas ?? []).filter((m) => !p.brands.some((b) => b.brand === m)),
    por_vencimento: porVencimento(l.daily),
    alertas: p.alerts.map((a) => ({ severidade: a.severity, codigo: safeText(a.code) ?? "", mensagem: safeText(a.message) ?? "" })),
  };
}

async function fila(
  canal: "shopee" | "ml",
  marcas: readonly string[] | undefined,
  horas: number,
  ldrDias: number,
  deps: ToolDeps,
): Promise<FilaBlock> {
  const channel = API_CHANNEL[canal];
  // `brands` NAO vai ao resumo: o backend o ignora la' (regra 1). Na
  // tendencia ele filtra de verdade e reduz o payload — por isso vai.
  const brandsCsv = marcas && marcas.length > 0 ? [...marcas].sort().join(",") : undefined;
  // CSV nas duas: a Shopee le `brands` como string (lista repetida seria lida pela
  // metade) e o ML aceita CSV tambem.
  const ldrParams = { days: ldrDias, brands: brandsCsv };
  const [resumoRaw, trend, ldr] = await Promise.all([
    deps.client.get("expedicao", { channel, include_queue: "false" }),
    // Falha da TENDENCIA (ex.: payload acima do teto) nao derruba o resumo
    // nem os outros canais: a tendencia sai indisponivel, sem numero.
    deps.client
      .get("expedicaoTrend", { channel, window_hours: horas, brands: brandsCsv })
      .then((raw) => parseUpstream(expedicaoTrendContract, raw))
      .catch(() => null),
    // A LDR tambem nao derruba a fila: flag desligada (404), contrato quebrado ou
    // timeout viram bloco indisponivel com motivo, nunca LDR zero.
    (canal === "ml"
      ? deps.client.get("expedicaoMlLdr", ldrParams).then((raw) => ldrMl(parseUpstream(expedicaoMlLdrContract, raw), marcas))
      : deps.client.get("expedicaoShopeeLdr", ldrParams).then((raw) => ldrShopee(parseUpstream(expedicaoShopeeLdrContract, raw), marcas))
    ).catch(() => ldrIndisponivel("falha_ao_ler_ldr")),
  ]);
  const p = parseUpstream(expedicaoContract, resumoRaw);
  const t = trend ?? { availability: "unavailable" as const, unavailable_reason: "falha_ao_ler_tendencia", window_hours: 0, truncated: false, points: [] };

  const noEscopo = (brand: string) => !marcas || marcas.includes(brand);
  const contas = p.accounts.filter((a) => noEscopo(a.brand));
  const presentes = new Set(p.accounts.map((a) => a.brand));
  const naoCobertas = p.coverage?.brands_not_covered ?? [];
  const marcasSemConta = (marcas ?? []).filter((b) => !presentes.has(b));

  const disponivel = p.availability === "available";
  // Sem filtro: os totais do backend. Com filtro: soma das contas do escopo.
  // NENHUMA conta no escopo nao e' backlog zero: e' ausencia — totais nulos.
  const totaisBrutos: Medidas | null = !disponivel || contas.length === 0
    ? null
    : marcas
      ? somar(contas)
      : (p.totals ?? somar(contas));

  // Tendencia: somada por hora entre as contas do escopo, sem nunca somar
  // horas diferentes. Hora em que falta conta e' marcada como incompleta.
  const contasEsperadas = new Set(contas.map((c) => c.shop_account));
  const porHora = new Map<string, { contas: Set<string>; rows: Medidas[] }>();
  if (t.availability === "available") {
    for (const pt of t.points) {
      if (!noEscopo(pt.brand)) continue;
      const slot = porHora.get(pt.snapshot_hour) ?? { contas: new Set(), rows: [] };
      slot.contas.add(pt.shop_account);
      slot.rows.push(pt);
      porHora.set(pt.snapshot_hour, slot);
    }
  }
  const pontos = [...porHora.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([hora, slot]) => {
      const s = somar(slot.rows);
      const c = contar(s);
      return {
        snapshot_hour: hora,
        contas_observadas: slot.contas.size,
        completo: contasEsperadas.size > 0 && [...contasEsperadas].every((x) => slot.contas.has(x)),
        backlog: c.backlog,
        vencidos: c.vencidos,
        acima_48h: c.acima_48h,
        travados: c.travados,
      };
    });

  return {
    canal,
    disponibilidade: p.availability,
    motivo_indisponivel: safeText(p.unavailable_reason) ?? (disponivel && contas.length === 0 ? "sem_conta_no_escopo" : null),
    fotografia: p.snapshot
      ? {
          effective_at: p.snapshot.effective_at,
          snapshot_hour: p.snapshot.snapshot_hour,
          idade_horas:
            numOrNull(p.limitations?.snapshot_age_hours) ??
            ageHours(p.snapshot.effective_at, deps.now()),
          load_mode: p.snapshot.load_mode,
          source_health: p.snapshot.source_health,
          run_status: p.snapshot.run_status ?? null,
        }
      : null,
    prazo: totaisBrutos ? estadoPrazo(totaisBrutos) : null,
    totais: totaisBrutos ? contar(totaisBrutos) : null,
    por_conta: contas.map((a) => ({
      shop_account: a.shop_account,
      brand: a.brand,
      prazo: estadoPrazo(a),
      ...contar(a),
    })),
    frescor_por_marca: p.freshness
      .filter((f) => noEscopo(f.brand))
      .map((f) => ({
        brand: f.brand,
        freshness: f.freshness,
        source_age_hours: numOrNull(f.source_age_hours),
      })),
    contas_faltando: safeTexts(p.coverage?.missing_accounts),
    contas_inesperadas: safeTexts(p.coverage?.unexpected_accounts),
    marcas_nao_cobertas_pela_fonte: naoCobertas,
    marcas_sem_conta: marcasSemConta,
    tendencia: {
      disponibilidade: t.availability,
      janela_horas: t.availability === "available" ? t.window_hours : null,
      truncada: t.truncated ?? false,
      motivo_indisponivel: t.availability === "available" ? null : safeText(t.unavailable_reason),
      pontos,
    },
    notas_da_fonte: safeTexts(p.limitations?.notes),
    ldr,
  };
}

async function tiktok(
  marcas: readonly string[] | undefined,
  evento: "coleta" | "despacho",
  dias: number,
  deps: ToolDeps,
): Promise<TiktokBlock> {
  const p = parseUpstream(
    expedicaoTiktokContract,
    await deps.client.get("expedicaoTiktok", {
      event: evento,
      days: dias,
      brands: marcas && marcas.length > 0 ? [...marcas].sort().join(",") : undefined,
    }),
  );
  const l = p.ldr ?? null;
  return {
    canal: "tiktok",
    disponibilidade: p.availability,
    motivo_indisponivel: safeText(p.unavailable_reason),
    evento: p.event ?? evento,
    medicao: p.deadline_is_reconstructed ? "interna_reconstruida" : "oficial_marketplace",
    sla_dias_uteis: numOrNull(p.sla_business_days[p.event ?? evento]),
    meta_tiktok_ldr: numOrNull(p.targets.tiktok_ldr),
    limiar_critico_interno: numOrNull(p.targets.internal_critical),
    fotografia: p.snapshot
      ? {
          effective_at: p.snapshot.effective_at,
          source_watermark_at: p.snapshot.source_watermark_at ?? null,
          today_brt: p.snapshot.today_brt,
          idade_horas: ageHours(p.snapshot.effective_at, deps.now()),
        }
      : null,
    ldr: l
      ? {
          janela_inicio: l.from,
          janela_fim: l.to,
          dias: l.days,
          taxa: numOrNull(l.rate),
          base: l.base,
          atrasados: l.late,
          pendentes_vencidos: l.pending_overdue,
          pendentes_no_prazo: l.pending_on_time,
          pendentes_em_risco: l.pending_at_risk,
          dias_maduros: l.mature_due_days,
          dias_parciais: l.partial_due_days,
          acima_da_meta: l.above_target,
          critico_interno: l.internal_critical,
          incidente_inicio: l.incident_start ?? null,
          incidente_fim: l.incident_end ?? null,
        }
      : null,
    ldr_por_vencimento: (l?.daily ?? []).map((d) => ({
      data_vencimento: d.due_date,
      base: d.base,
      atrasados: d.late,
      pendentes_vencidos: d.pending_overdue,
      taxa: numOrNull(d.rate),
      maduro: d.is_mature,
      acima_da_meta: d.above_target,
      critico_interno: d.is_critical,
    })),
    por_loja: p.brands.map((b) => ({
      brand: b.brand,
      loja: safeText(b.shop_name),
      base: b.base,
      atrasados: b.late,
      taxa: numOrNull(b.rate),
      acima_da_meta: b.above_target,
    })),
    alertas: p.alerts.map((a) => ({ severidade: a.severity, codigo: safeText(a.code) ?? "", mensagem: safeText(a.message) ?? "" })),
  };
}

function pct(v: number | null): string {
  return v === null ? "sem base" : `${(v * 100).toFixed(2).replace(".", ",")}%`;
}

export const expedicaoTool: OracleTool = {
  name: "torre_expedicao_operacional",
  config: {
    title: "Expedicao operacional por canal",
    description: [
      "Use para 'quanto esta parado na expedicao', 'quantos pedidos vencidos ou em risco', 'o que esta travado', 'como evoluiu o backlog' e 'como esta a LDR do TikTok', 'LDR 7d do Mercado Livre ou da Shopee por marca' e 'o que vence hoje / esta em risco'.",
      "Cobre Shopee e Mercado Livre (fotografia atual por conta, com tendencia horaria, mais o bloco 'ldr': LDR de despacho/coleta no prazo dos ultimos ldr_dias, por marca e por vencimento) e TikTok Shop (LDR por vencimento na janela, por loja).",
      "LDR de Shopee e ML e' medicao INTERNA da Torre, NAO a taxa oficial de penalizacao/reputacao da plataforma (ldr.medicao e ldr.aviso_medicao) — diga isso ao usuario. ldr.taxa null = sem base ou cobertura insuficiente (nunca 0%); no ML a taxa do canal e' a soma de atrasados/base das marcas (ldr.taxa_origem). Se ldr vier indisponivel, a fila continua valendo.",
      "NAO ha 'vencem hoje' por etapa nem coleta perdida do TikTok aqui: use em_risco_24h (e ldr.vencem_hoje_ou_amanha na Shopee) como proxy e diga que e' proxy.",
      "Somente AGREGADOS por canal, conta/loja e data — nunca pedido individual, cliente ou endereco.",
      "Prazo nao publicado nao e' zero: quando o canal nao publica prazo (Mercado Livre sem o SLA de despacho na fotografia), vencidos/em_risco_24h/no_prazo vem nulos e prazo='nao_publicado_pelo_canal'.",
      "No TikTok, leia 'medicao': 'interna_reconstruida' significa prazo reconstruido pela Torre, NAO a medicao oficial de penalizacao da plataforma — diga isso ao usuario.",
      "Marca sem conta no canal aparece em marcas_sem_conta, nunca como backlog zero. A fotografia e' manual: confira fotografia.idade_horas.",
    ].join(" "),
    inputSchema: expedicaoInput,
    outputSchema: expedicaoOutput,
  },
  async run(args, deps) {
    const input = expedicaoInput.parse(args);
    const canais: readonly ExpCanal[] = input.canais ?? EXP_CANAIS;
    const pede = (c: ExpCanal) => canais.includes(c);

    const [shopee, ml, tk] = await Promise.all([
      pede("shopee") ? fila("shopee", input.marcas, input.tendencia_horas, input.ldr_dias, deps) : null,
      pede("ml") ? fila("ml", input.marcas, input.tendencia_horas, input.ldr_dias, deps) : null,
      pede("tiktok") ? tiktok(input.marcas, input.tiktok_evento, input.tiktok_dias, deps) : null,
    ]);

    // Limitacoes DERIVADAS do que voltou.
    const limitations: Limitation[] = [EXP_NO_ORDER_LEVEL];
    const filas = [shopee, ml].filter((b): b is FilaBlock => b !== null);
    if (filas.some((b) => b.fotografia?.load_mode === "manual_snapshot")) {
      limitations.push(EXP_MANUAL_SNAPSHOT);
    }
    if (filas.some((b) => b.prazo === "nao_publicado_pelo_canal" || b.prazo === "parcial")) {
      limitations.push(EXP_DEADLINE_NOT_PUBLISHED);
    }
    if (input.marcas && filas.length > 0) limitations.push(EXP_BRAND_FILTER_LOCAL);
    if (filas.some((b) => b.ldr.disponibilidade === "available" && b.ldr.medicao === "interna_nao_oficial")) {
      limitations.push(EXP_LDR_INTERNA);
    }
    if (filas.length > 0 || tk) limitations.push(EXP_VENCEM_HOJE);
    if (tk && tk.disponibilidade === "available") {
      limitations.push(tk.medicao === "interna_reconstruida" ? EXP_TIKTOK_RECONSTRUCTED : EXP_TIKTOK_OFFICIAL);
    }

    const warnings: string[] = [];
    for (const b of filas) {
      const nome = b.canal === "ml" ? "Mercado Livre" : "Shopee";
      if (b.disponibilidade === "unavailable") {
        warnings.push(`${nome}: expedicao indisponivel (${b.motivo_indisponivel ?? "sem motivo informado"}) — nenhum numero, nao trate como zero.`);
        continue;
      }
      if (b.fotografia && b.fotografia.source_health !== "healthy") {
        warnings.push(`${nome}: a fotografia servida e' a ANTERIOR (source_health=${b.fotografia.source_health}).`);
      }
      const velhas = b.frescor_por_marca.filter((f) => f.freshness !== "fresh");
      if (velhas.length > 0) {
        warnings.push(`${nome}: fonte nao fresca para ${velhas.map((f) => `${f.brand} (${f.freshness})`).join(", ")}.`);
      }
      const l = b.ldr;
      if (l.disponibilidade === "unavailable") {
        warnings.push(`${nome}: LDR ${input.ldr_dias}d indisponivel (${l.motivo_indisponivel ?? "sem motivo informado"}) — sem taxa, nao trate como LDR zero.`);
      } else {
        if (l.medicao === "interna_nao_oficial") {
          warnings.push(`${nome}: LDR e' medicao INTERNA da Torre, nao a taxa oficial de penalizacao da plataforma.`);
        }
        if (l.janela && l.janela.dias_fechados < l.janela.dias_pedidos && b.canal === "ml") {
          warnings.push(`${nome}: janela parcial da LDR (${l.janela.dias_fechados} de ${l.janela.dias_pedidos} dias fechados — a serie so' comeca em 03/11/2026).`);
        }
        if (l.taxa === null && l.base !== null && l.base > 0) {
          warnings.push(`${nome}: LDR com base ${l.base} mas taxa oculta (${l.taxa_oculta_motivo ?? "cobertura insuficiente"}) — nao calcule a taxa por fora.`);
        }
        if (l.fonte_vencida) warnings.push(`${nome}: fonte da LDR vencida — numeros nao sao atuais.`);
        if (l.marcas_sem_base.length > 0) {
          warnings.push(`${nome}: sem base de LDR para ${l.marcas_sem_base.join(", ")} — ausencia, nao LDR zero.`);
        }
      }
      if (b.tendencia.disponibilidade === "unavailable") {
        warnings.push(`${nome}: tendencia indisponivel — sem serie, nao trate como backlog estavel.`);
      }
      if (b.contas_faltando.length > 0) {
        warnings.push(`${nome}: contas esperadas ausentes da fotografia: ${b.contas_faltando.join(", ")}. O total esta INCOMPLETO.`);
      }
      if (b.marcas_sem_conta.length > 0) {
        warnings.push(`${nome}: sem conta para ${b.marcas_sem_conta.join(", ")} — ausencia, nao backlog zero.`);
      }
    }
    if (tk && tk.disponibilidade === "unavailable") {
      warnings.push(`TikTok Shop: serie indisponivel (${tk.motivo_indisponivel ?? "sem motivo informado"}) — nenhum numero, nao trate como LDR zero.`);
    }

    // Carimbo conservador: a fotografia MAIS ANTIGA entre os canais servidos.
    const stamps = [
      shopee?.fotografia?.effective_at, ml?.fotografia?.effective_at, tk?.fotografia?.effective_at,
    ].filter((s): s is string => typeof s === "string").sort();

    const env = buildEnvelope({
      // Resposta COMPOSTA: fotografia atual (Shopee/ML) + janela da LDR (TikTok).
      period: null,
      filtersApplied: {
        canais: [...canais],
        marcas: input.marcas ?? null,
        tendencia_horas: input.tendencia_horas,
        tiktok_evento: input.tiktok_evento,
        tiktok_dias: input.tiktok_dias,
        ldr_dias: input.ldr_dias,
        include_queue: false,
      },
      metricDefinition:
        "Shopee/ML: contagens da fotografia atual por conta (backlog, vencidos, em risco <24h, acima de 48h, travados = lentos UNIAO zumbis). TikTok: LDR = atrasados / base dos pedidos com vencimento na janela. ML/Shopee `ldr`: atrasados / base dos pedidos com prazo de despacho/coleta vencendo nos ultimos dias fechados (medicao interna; no ML a taxa do canal e' a soma de atrasados e base das marcas).",
      refreshedAt: stamps[0] ?? null,
      coverage: "agregados por canal e conta/loja; nenhuma linha por pedido",
      returnedCount: [shopee, ml, tk].filter((b) => b !== null).length,
      warnings,
      data: { shopee, ml, tiktok: tk, limitations },
    });

    const partes: string[] = [];
    for (const b of filas) {
      const nome = b.canal === "ml" ? "Mercado Livre" : "Shopee";
      if (!b.totais) {
        partes.push(b.disponibilidade === "available" ? `${nome}: sem conta no escopo (ausencia, nao backlog zero)` : `${nome}: indisponivel`);
        continue;
      }
      const venc = b.totais.vencidos === null ? "vencidos nao medidos (sem prazo publicado)" : `${b.totais.vencidos} vencidos`;
      partes.push(`${nome}: backlog ${b.totais.backlog}, ${venc}, ${b.totais.travados} travados`);
    }
    for (const b of filas) {
      const nome = b.canal === "ml" ? "Mercado Livre" : "Shopee";
      partes.push(
        b.ldr.disponibilidade === "available"
          ? `${nome} LDR ${input.ldr_dias}d: ${pct(b.ldr.taxa)} (base ${b.ldr.base}, ${b.ldr.atrasados} atrasados) — medicao INTERNA`
          : `${nome} LDR: indisponivel`,
      );
    }
    if (tk) {
      partes.push(
        tk.ldr
          ? `TikTok: LDR ${pct(tk.ldr.taxa)} (base ${tk.ldr.base}, ${tk.ldr.atrasados} atrasados) — ${tk.medicao === "interna_reconstruida" ? "medicao INTERNA, nao oficial" : "medicao oficial"}`
          : "TikTok: indisponivel",
      );
    }
    return ok(`Expedicao. ${partes.join(". ")}.`, env);
  },
};
