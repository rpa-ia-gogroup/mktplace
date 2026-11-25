/**
 * torre_metas — resultado do MES contra a meta e META DO DIA, como o Gerencial.
 *
 * A API NAO tem rota que entregue realizado x meta x ritmo. Esta tool junta:
 *  - `GET /metas/{mes}`: as metas (so' celulas marca x canal COM meta);
 *  - `GET /performance/brands`: o GMV de cada marca por canal (mes e dia);
 *  - `GET /performance/trend` (grao dia): o ultimo dia com venda.
 * e entrega a conta para as MESMAS funcoes puras do Gerencial
 * (`lib/gerencial/meta-progress.ts`, `lib/metas-curva.ts`): porcentagem, ritmo,
 * projecao, falta, meta do dia e status NAO sao calculados aqui.
 *
 * REGRAS (as do Gerencial):
 *  - realizado comparavel = so' as celulas marca x canal COM meta (TikTok sem
 *    meta nao entra);
 *  - o mes corrente vai ate' ONTEM (a fato diaria so' publica dias fechados);
 *  - meta do dia de HOJE e' parcial: celula sem venda fica fora (`sem_dado`);
 *  - sem meta no escopo = ausencia dita, nunca 0% nem meta 0.
 */
import { z } from "zod";

import { diasNoMes, celulasDoEscopo, GMV_DO_CANAL, mesDaMeta, metaDoEscopo, progressoMeta, realizadoDoEscopo, ultimoDiaComDado, type CelulaMetaGmv, type GmvPorCanal, type ProgressoMeta } from "../../lib/gerencial/meta-progress.ts";
import { parseMes } from "../../lib/metas.ts";
import { escopoTemCurva, eventoDoDia, fracaoDoEscopo, metaDiaNormalDoEscopo, progressoDoDia, resumoSemDado, type ProgressoDia } from "../../lib/metas-curva.ts";
import type { Marketplace } from "../../lib/mock-data.ts";
import { buildEnvelope, fmtMoney } from "./envelope.ts";
import { toolError } from "./errors.ts";
import type { Limitation } from "./limitations.ts";
import { BRANDS, CHANNELS, isoDate, isoMonth, noDuplicates, todayInAppTimezone } from "./schemas.ts";
import { envelopeSchema, limitationSchema, ok, type OracleTool } from "./tool-kit.ts";
import { numOrNull } from "./torre-client.ts";
import { parseUpstream, trendContract } from "./upstream.ts";
import { brandsGmvContract, metasContract } from "./upstream-metas.ts";

export const metasInput = z
  .object({
    /** AAAA-MM. Default: mes corrente (Brasilia), ou o mes de `dia`. */
    mes: isoMonth.optional(),
    marcas: noDuplicates(z.array(z.enum(BRANDS)).min(1).max(5), "marcas").optional(),
    canais: noDuplicates(z.array(z.enum(CHANNELS)).min(1).max(3), "canais").optional(),
    /** AAAA-MM-DD para a meta do dia. Default: ontem (fechado) e hoje (em andamento) no mes corrente. */
    dia: isoDate.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Limitacoes (definidas aqui; limitations.ts e' compartilhado)
// ---------------------------------------------------------------------------

const METAS_MESMA_REGRA: Limitation = {
  topic: "metas_mesma_regra_gerencial",
  scope: "Metas — Gerencial",
  description:
    "Porcentagem, ritmo, projecao, falta e meta do dia vem das MESMAS funcoes da tela Gerencial. O realizado conta SO' as combinacoes marca x canal que TEM meta (ex.: TikTok sem meta nao entra), entao nao bate com o GMV total de torre_desempenho_marketplaces. Celula sem meta e' ausencia, nunca meta zero.",
};

const METAS_SEM_CURVA: Limitation = {
  topic: "metas_sem_curva_diaria",
  scope: "Metas — meta do dia e ritmo",
  description:
    "Este mes nao tem curva diaria de pesos (so' nov/2026 tem, fixa no codigo) para algum canal do escopo: nele a meta do dia = meta do mes / dias do mes e o ritmo e' linear.",
};

const METAS_DIA_FECHADO: Limitation = {
  topic: "metas_dias_fechados",
  scope: "Metas — mes corrente",
  description:
    "A base diaria so' publica dias fechados (D-1): o resultado do mes corrente vai ate' ontem. A meta de HOJE e' parcial e so' compara as celulas que ja' tem venda.",
};

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

const statusMes = z.enum(["atingida", "no_caminho", "atencao", "abaixo", "nao_atingida"]);
const statusDia = z.enum(["em_andamento", "atingida", "nao_atingida"]);
const marca = z.enum(BRANDS);
const canal = z.enum(CHANNELS);

const progressoBloco = z.object({
  meta: z.number(),
  realizado: z.number(),
  /** realizado / meta, em %. */
  atingimento_pct: z.number(),
  /** O que o plano esperava ate' o ultimo dia com dado (curva ou linear). */
  plano_ate_data: z.number(),
  /** realizado / plano_ate_data, em % (100 = no plano). null = sem dia com dado. */
  ritmo_vs_plano_pct: z.number().nullable(),
  /** Fechamento projetado do mes. null = ainda sem dia com dado. */
  projecao: z.number().nullable(),
  projecao_pct_da_meta: z.number().nullable(),
  falta: z.number(),
  /** Venda por dia NORMAL dos dias restantes para bater a meta. */
  por_dia_necessario: z.number().nullable(),
  dias_no_mes: z.number(),
  dias_com_dado: z.number(),
  dias_restantes: z.number(),
  encerrado: z.boolean(),
  status: statusMes,
});

const celulaRef = z.object({ marca, canal });

const mesResultado = z.object({
  estado: z.enum(["calculado", "sem_meta_no_escopo", "mes_futuro", "sem_dia_fechado"]),
  periodo: z.object({ inicio: z.string(), fim: z.string() }).nullable(),
  ultimo_dia_com_dado: z.string().nullable(),
  total: progressoBloco.nullable(),
  por_marca: z.array(progressoBloco.extend({ marca, canais_com_meta: z.array(canal) })),
  por_canal: z.array(progressoBloco.extend({ canal })),
  /** Celulas COM meta sem GMV no periodo: contadas como zero, como no Gerencial. */
  sem_venda_no_periodo: z.array(celulaRef),
});

const diaMetrica = z.object({
  meta_do_dia: z.number(),
  /** Meta so' das celulas que ja' tem venda: a base da comparacao. */
  meta_com_dado: z.number(),
  realizado: z.number(),
  atingimento_pct: z.number().nullable(),
  falta: z.number(),
  status: statusDia,
});

const diaBloco = z.object({
  dia: z.string(),
  evento: z.string().nullable(),
  em_andamento: z.boolean(),
  disponibilidade: z.enum(["available", "unavailable"]),
  motivo_indisponivel: z.string().nullable(),
  resultado: diaMetrica
    .extend({
      por_marca: z.array(diaMetrica.omit({ meta_do_dia: true, falta: true }).extend({ marca, canais: z.array(canal) })),
      por_canal: z.array(diaMetrica.extend({ canal })),
      /** Celulas cujo GMV do dia ainda nao chegou: fora da conta. */
      sem_dado: z.array(celulaRef),
      resumo_sem_dado: z.array(z.string()),
    })
    .nullable(),
});

const metasOutput = envelopeSchema(
  z.object({
    mes: z.string(),
    hoje: z.string(),
    celulas_com_meta: z.array(celulaRef.extend({ meta_gmv: z.number() })),
    /** Marcas/canais do escopo sem NENHUMA meta no mes: ausencia, nao meta zero. */
    marcas_sem_meta: z.array(marca),
    canais_sem_meta: z.array(canal),
    metas_atualizadas_em: z.string().nullable(),
    resultado_do_mes: mesResultado,
    meta_do_dia: z.array(diaBloco),
    limitations: z.array(limitationSchema),
  }),
);

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const pct = (f: number): number => Math.round(f * 10_000) / 100;
const pctOrNull = (f: number | null): number | null => (f === null ? null : pct(f));
const diaAnterior = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
const unicos = <T>(xs: T[]): T[] => [...new Set(xs)];

function bloco(p: ProgressoMeta) {
  return {
    meta: p.meta,
    realizado: p.realizado,
    atingimento_pct: pct(p.atingimento),
    plano_ate_data: p.planoAteData,
    ritmo_vs_plano_pct: p.planoAteData > 0 ? pct(p.atingimentoDoPlano) : null,
    projecao: p.projecao,
    projecao_pct_da_meta: pctOrNull(p.projecaoSobreMeta),
    falta: p.falta,
    por_dia_necessario: p.porDiaNecessario,
    dias_no_mes: p.diasNoMes,
    dias_com_dado: p.diasComDado,
    dias_restantes: p.diasRestantes,
    encerrado: p.encerrado,
    status: p.status,
  };
}

function linhasDe(raw: unknown): { linhas: GmvPorCanal[]; refreshedAt: string | null } {
  const p = parseUpstream(brandsGmvContract, raw);
  return {
    linhas: p.brands.map((b) => ({
      brand: b.brand,
      tiktok_gmv: numOrNull(b.tiktok_gmv),
      ml_gmv: numOrNull(b.ml_gmv),
      shopee_gmv: numOrNull(b.shopee_gmv),
    })),
    refreshedAt: p.refreshed_at ?? null,
  };
}

const ref = (c: CelulaMetaGmv) => ({ marca: c.brand as (typeof BRANDS)[number], canal: c.channel as Marketplace });

function diaResultado(p: ProgressoDia, celulas: CelulaMetaGmv[], linhas: GmvPorCanal[], hoje: string) {
  const metrica = (x: ProgressoDia) => ({
    meta_do_dia: x.metaDoDia,
    meta_com_dado: x.metaComDado,
    realizado: x.realizado,
    atingimento_pct: pctOrNull(x.atingimento),
    falta: x.falta,
    status: x.status,
  });
  return {
    ...metrica(p),
    por_marca: Object.entries(p.porMarca).map(([m, v]) => ({
      marca: m as (typeof BRANDS)[number],
      meta_com_dado: v.meta,
      realizado: v.realizado,
      atingimento_pct: pct(v.atingimento),
      status: v.status,
      canais: v.canais,
    })),
    por_canal: unicos(celulas.map((c) => c.channel as Marketplace)).flatMap((c) => {
      const x = progressoDoDia({ celulas: celulas.filter((k) => k.channel === c), linhas, dia: p.dia, hoje });
      return x ? [{ canal: c, ...metrica(x) }] : [];
    }),
    sem_dado: p.semDado.map(ref),
    resumo_sem_dado: resumoSemDado(p.semDado, celulas),
  };
}

export const metasTool: OracleTool = {
  name: "torre_metas",
  config: {
    title: "Metas: resultado do mes e meta do dia",
    description: [
      "Use para 'como estamos contra a meta', 'quanto falta para bater a meta do mes', 'qual o ritmo/projecao do mes', 'a Kokeshi vai bater a meta', 'qual a meta de hoje/ontem e quanto ja' foi' — por marca e por canal (Mercado Livre, Shopee, TikTok).",
      "Devolve a MESMA conta do Gerencial: realizado, meta, % da meta, ritmo vs plano, projecao de fechamento, falta, venda por dia necessaria e status (atingida, no_caminho, atencao, abaixo, nao_atingida); e a meta do dia (meta, realizado, atingimento, evento da curva como 11/11 ou Black Friday).",
      "O realizado compara SO' marca x canal que TEM meta (ex.: TikTok sem meta nao entra): nao e' o GMV total de torre_desempenho_marketplaces. O mes corrente vai ate' ONTEM (so' dias fechados); a meta de HOJE e' parcial (celulas sem venda ficam em sem_dado).",
      "Sem meta cadastrada no escopo: resultado_do_mes.estado='sem_meta_no_escopo' e marcas_sem_meta/canais_sem_meta — isso e' ausencia de meta, NUNCA meta zero nem 0% atingido.",
      "NAO use para GMV/vendas sem meta (torre_desempenho_marketplaces), vendas por hora (hoje por hora) nem para editar metas (somente leitura).",
      "Entrada: mes (AAAA-MM, default mes corrente), marcas, canais, dia (AAAA-MM-DD para a meta do dia; default ontem e hoje no mes corrente).",
    ].join(" "),
    inputSchema: metasInput,
    outputSchema: metasOutput,
  },
  async run(args, deps) {
    const input = metasInput.parse(args);
    const hoje = todayInAppTimezone(deps.now());
    const mesAtual = hoje.slice(0, 7);
    const mes = input.mes ?? input.dia?.slice(0, 7) ?? mesAtual;
    if (parseMes(mes) === null) throw toolError("INVALID_INPUT", "mes fora da faixa 2024-01 a 2030-12");
    if (input.dia && (input.dia.slice(0, 7) !== mes || input.dia > hoje)) {
      throw toolError("INVALID_INPUT", "dia deve estar dentro do mes e nao pode ser futuro");
    }
    const canais: Marketplace[] = input.canais ?? [...CHANNELS];
    const marcas = input.marcas ?? [];

    const metasP = parseUpstream(metasContract, await deps.client.get("metas", { mes }));
    if (metasP.mes !== mes) throw toolError("INVALID_UPSTREAM_RESPONSE");
    // Meta zero nao e' meta (o Gerencial a ignora): so' celulas com valor > 0.
    const celulas: CelulaMetaGmv[] = metasP.celulas
      .filter((c) => c.meta_gmv > 0)
      .map((c) => ({ brand: c.brand, channel: c.channel, meta_gmv: c.meta_gmv }));
    const escopo = celulasDoEscopo(celulas, canais, marcas);

    // Janela comparavel (a regra `mesDaMeta` do Gerencial): mes fechado, ou corrente ate' ontem.
    const de = `${mes}-01`;
    const ate = mes > mesAtual ? null : mes === mesAtual ? diaAnterior(hoje) : `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
    const janela = ate !== null && ate >= de && mesDaMeta(de, ate, hoje) === mes ? { de, ate } : null;
    const dias = escopo.length === 0 ? [] : input.dia ? [input.dia] : mes === mesAtual ? [diaAnterior(hoje), hoje].filter((d) => d.slice(0, 7) === mes) : [];

    const scope = {
      channels: input.canais ? [...input.canais].sort().join(",") : "all",
      brands: marcas.length > 0 ? [...marcas].sort().join(",") : undefined,
    };
    const brandsDe = (from: string, to: string) => deps.client.get("brands", { ...scope, date_from: from, date_to: to });
    const buscas = escopo.length === 0
      ? []
      : await Promise.all([
          janela ? brandsDe(janela.de, janela.ate) : null,
          // Falha da serie diaria nao derruba o resultado: o ultimo dia com dado vira ontem.
          janela
            ? deps.client.get("trend", { ...scope, date_from: janela.de, date_to: janela.ate, granularity: "day" }).catch(() => null)
            : null,
          // Falha de um dia fica dita naquele dia, sem derrubar o mes.
          ...dias.map((d) => brandsDe(d, d).catch(() => null)),
        ]);

    const warnings: string[] = [];
    const stamps: string[] = [];

    // ---- resultado do mes ---------------------------------------------------
    let resultado: z.infer<typeof mesResultado> = {
      estado: escopo.length === 0 ? "sem_meta_no_escopo" : mes > mesAtual ? "mes_futuro" : "sem_dia_fechado",
      periodo: null, ultimo_dia_com_dado: null, total: null, por_marca: [], por_canal: [], sem_venda_no_periodo: [],
    };
    if (escopo.length > 0 && janela && buscas[0] != null) {
      const { linhas, refreshedAt } = linhasDe(buscas[0]);
      if (refreshedAt) stamps.push(refreshedAt);
      const serie = buscas[1] == null ? null : parseUpstream(trendContract, buscas[1]);
      const ultimoDia = serie
        ? ultimoDiaComDado(
            serie.data.filter((p) => ISO_DIA.test(p.date)).map((p) => ({ date: p.date, values: { gmv: numOrNull(p.gmv) } })),
            "day",
          )
        : null;
      if (serie === null) warnings.push("Serie diaria indisponivel: o ultimo dia com dado foi assumido como ontem (como o Gerencial faz sem a serie).");

      const progressoDe = (cells: CelulaMetaGmv[]) =>
        progressoMeta({
          meta: metaDoEscopo(cells, [...CHANNELS], []).total,
          realizado: realizadoDoEscopo(linhas, cells).total,
          mes, hoje, ultimoDia,
          fracaoAte: fracaoDoEscopo(cells, mes),
          metaDiaNormal: metaDiaNormalDoEscopo(cells, mes),
        });
      const total = progressoDe(escopo);
      const semVenda = escopo.filter((c) => (linhas.find((l) => l.brand === c.brand)?.[GMV_DO_CANAL[c.channel as Marketplace]] ?? null) === null);
      resultado = {
        estado: "calculado",
        periodo: { inicio: janela.de, fim: janela.ate },
        ultimo_dia_com_dado: ultimoDia,
        total: total && bloco(total),
        por_marca: unicos(escopo.map((c) => c.brand)).flatMap((m) => {
          const cells = escopo.filter((c) => c.brand === m);
          const p = progressoDe(cells);
          return p ? [{ marca: m as (typeof BRANDS)[number], canais_com_meta: cells.map((c) => c.channel as Marketplace), ...bloco(p) }] : [];
        }),
        por_canal: unicos(escopo.map((c) => c.channel as Marketplace)).flatMap((c) => {
          const p = progressoDe(escopo.filter((k) => k.channel === c));
          return p ? [{ canal: c, ...bloco(p) }] : [];
        }),
        sem_venda_no_periodo: semVenda.map(ref),
      };
      if (semVenda.length > 0) {
        warnings.push(`Sem GMV no periodo para ${semVenda.map((c) => `${c.brand}/${c.channel}`).join(", ")}: contado como zero, como no Gerencial — pode ser canal que ainda nao chegou.`);
      }
    }
    if (resultado.estado === "mes_futuro") warnings.push("Mes futuro: ha meta, mas ainda nao ha realizado.");
    if (resultado.estado === "sem_dia_fechado") warnings.push("Primeiro dia do mes: ainda nao ha nenhum dia fechado para comparar com a meta.");

    // ---- meta do dia --------------------------------------------------------
    const metaDoDia = dias.map((dia, i): z.infer<typeof diaBloco> => {
      const emAndamento = dia >= hoje;
      const base = { dia, evento: eventoDoDia(dia), em_andamento: emAndamento };
      const raw = buscas[2 + i];
      if (raw == null) {
        warnings.push(`Meta do dia ${dia}: GMV do dia indisponivel — sem numero, nao trate como zero.`);
        return { ...base, disponibilidade: "unavailable", motivo_indisponivel: "falha_ao_ler_gmv_do_dia", resultado: null };
      }
      const { linhas, refreshedAt } = linhasDe(raw);
      if (refreshedAt) stamps.push(refreshedAt);
      const p = progressoDoDia({ celulas: escopo, linhas, dia, hoje });
      if (emAndamento) warnings.push(`Meta de hoje (${dia}) em andamento: o dia nao fechou, so' entram as celulas que ja' tem venda (ver sem_dado).`);
      return {
        ...base, disponibilidade: "available", motivo_indisponivel: null,
        resultado: p && diaResultado(p, escopo, linhas, hoje),
      };
    });

    // ---- ausencias e limitacoes ---------------------------------------------
    const marcasPedidas = marcas.length > 0 ? marcas : [...BRANDS];
    const marcasSemMeta = marcasPedidas.filter((m) => !escopo.some((c) => c.brand === m));
    const canaisSemMeta = canais.filter((c) => !escopo.some((x) => x.channel === c));
    if (escopo.length === 0) {
      warnings.push("Nenhuma meta cadastrada neste escopo e mes: ausencia de meta, nao meta zero nem 0% atingido.");
    } else {
      if (canaisSemMeta.length > 0) warnings.push(`Canais sem meta neste mes (${canaisSemMeta.join(", ")}): o GMV deles NAO entra no realizado comparavel.`);
      if (marcasSemMeta.length > 0) warnings.push(`Marcas sem meta neste mes (${marcasSemMeta.join(", ")}): ausencia de meta, nao meta zero.`);
    }

    const limitations: Limitation[] = [METAS_MESMA_REGRA];
    if (escopo.length > 0 && !escopoTemCurva(escopo, mes)) limitations.push(METAS_SEM_CURVA);
    if (mes === mesAtual) limitations.push(METAS_DIA_FECHADO);

    const env = buildEnvelope({
      period: janela ? { start: janela.de, end: janela.ate, inclusive: true } : null,
      filtersApplied: { mes, marcas: input.marcas ?? null, canais, dia: input.dia ?? null, base: "pagos" },
      metricDefinition:
        "Mesma regra do Gerencial: % da meta = realizado / meta do mes; ritmo = realizado / o que o plano (curva do mes ou linear) esperava ate' o ultimo dia com dado; projecao = realizado / fracao esperada; meta do dia = meta do mes x peso do dia / soma dos pesos. Realizado = GMV (pagos) so' das celulas marca x canal COM meta.",
      refreshedAt: stamps.sort()[0] ?? null,
      coverage: `${escopo.length} celula(s) marca x canal com meta no escopo; realizado ate' ${janela?.ate ?? "—"}`,
      returnedCount: unicos(escopo.map((c) => c.brand)).length,
      warnings,
      data: {
        mes,
        hoje,
        celulas_com_meta: escopo.map((c) => ({ ...ref(c), meta_gmv: c.meta_gmv })),
        marcas_sem_meta: marcasSemMeta,
        canais_sem_meta: canaisSemMeta,
        metas_atualizadas_em: metasP.ultima_alteracao ?? null,
        resultado_do_mes: resultado,
        meta_do_dia: metaDoDia,
        limitations,
      },
    });

    const t = resultado.total;
    const partes: string[] = [];
    if (t) {
      partes.push(`${mes}: ${fmtMoney(t.realizado)} de ${fmtMoney(t.meta)} (${String(t.atingimento_pct).replace(".", ",")}% da meta), status ${t.status}, falta ${fmtMoney(t.falta)}`);
    } else {
      partes.push(`${mes}: ${resultado.estado === "sem_meta_no_escopo" ? "sem meta no escopo (ausencia, nao meta zero)" : resultado.estado}`);
    }
    for (const d of metaDoDia) {
      const r = d.resultado;
      partes.push(
        r
          ? `dia ${d.dia}${d.em_andamento ? " (em andamento)" : ""}: ${fmtMoney(r.realizado)} de ${fmtMoney(r.meta_com_dado)}${r.atingimento_pct === null ? "" : ` (${String(r.atingimento_pct).replace(".", ",")}%)`}`
          : `dia ${d.dia}: indisponivel`,
      );
    }
    return ok(`Metas. ${partes.join(". ")}.`, env);
  },
};
