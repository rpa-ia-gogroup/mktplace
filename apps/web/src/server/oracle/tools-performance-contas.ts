/**
 * torre_performance_contas — Performance OFICIAL das contas nos marketplaces.
 *
 * E' a nota/saude que a PLATAFORMA mede (reputacao do Mercado Livre, Saude da
 * Conta da Shopee), lida das fotografias diarias. NAO e' a LDR interna da
 * expedicao (`torre_expedicao_operacional`).
 *
 * Regras de leitura, todas derivadas do payload:
 * 1. Ausencia nunca vira nota 0: canal sem fonte, conta sem fotografia e marca
 *    que nao existe no canal saem como estado/motivo explicitos.
 * 2. TikTok Shop BR nao tem nota oficial da loja (SPS so' existe para os EUA):
 *    a API devolve indicadores de ATENDIMENTO, e a tool os rotula assim.
 * 3. Nenhum numero e' calculado aqui: nivel, indicadores, metas e situacao
 *    ("ok"/"fora") vem da API.
 *
 * Marcas aceitas: o backend valida `brands` contra `BRANDS_IN_SCOPE`, a mesma
 * lista de `BRANDS` (schemas.ts). Quais delas existem em cada canal vem da
 * `cobertura.fora` da propria resposta.
 */
import { z } from "zod";

import { buildEnvelope } from "./envelope.ts";
import { OracleToolError, toolError } from "./errors.ts";
import type { Limitation } from "./limitations.ts";
import { BRANDS, noDuplicates } from "./schemas.ts";
import {
  ageHours, envelopeSchema, limitationSchema, ok, safeText, type OracleTool, type ToolDeps,
} from "./tool-kit.ts";
import { numOrNull } from "./torre-client.ts";
import { parseUpstream } from "./upstream.ts";
import { performanceContasContract } from "./upstream-performance-contas.ts";

export const PERF_CANAIS = ["ml", "shopee", "tiktok"] as const;
type PerfCanal = (typeof PERF_CANAIS)[number];

const API_CANAL: Record<PerfCanal, string> = { ml: "mercadolivre", shopee: "shopee", tiktok: "tiktokshop" };
const NOME: Record<PerfCanal, string> = { ml: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };

/** Fotografia diaria: mais de 48 h = pelo menos um dia sem captura (mesmo limite do backend). */
export const PERF_FOTO_VELHA_HORAS = 48;
/** Teto de indicadores por conta (a API publica ~10-15; o teto protege o payload). */
const MAX_INDICADORES = 40;

export const performanceContasInput = z
  .object({
    canais: noDuplicates(z.array(z.enum(PERF_CANAIS)).min(1).max(3), "canais").optional(),
    marcas: noDuplicates(z.array(z.enum(BRANDS)).min(1).max(5), "marcas").optional(),
  })
  .strict();

export const PERF_OFICIAL_NAO_E_LDR: Limitation = {
  topic: "performance_oficial_vs_ldr_interna",
  scope: "Performance das contas",
  description:
    "Esta e' a medicao OFICIAL da plataforma (reputacao/Saude da Conta). A LDR interna da expedicao e' outra metrica, de torre_expedicao_operacional: nao misture as duas.",
};

export const PERF_TIKTOK_SEM_NOTA: Limitation = {
  topic: "tiktok_sem_nota_oficial",
  scope: "Performance das contas — TikTok Shop",
  description:
    "O TikTok Shop Brasil nao publica nota oficial da loja (SPS so' existe para os EUA). Os indicadores devolvidos sao de ATENDIMENTO (resposta, tempo, satisfacao) e nao tem meta oficial: nao e' nota nem reputacao.",
};

const tomSchema = z.enum(["bom", "atencao", "critico", "neutro"]);

const contaSchema = z.object({
  marca: z.string(),
  /** Dia da fotografia (YYYY-MM-DD). */
  dia: z.string(),
  capturado_em: z.string(),
  idade_horas: z.number().nullable(),
  fotografia_velha: z.boolean(),
  /** Nivel oficial na plataforma (ex.: MercadoLider Platinum, Verde). null = a plataforma nao informou. */
  nivel: z.string().nullable(),
  tom: tomSchema,
  termometro: z.number().nullable(),
  termometro_max: z.number().nullable(),
  resumo: z.string().nullable(),
  destaques: z.array(z.object({ rotulo: z.string(), valor: z.string(), tom: tomSchema.nullable() })),
  indicadores: z.array(
    z.object({
      codigo: z.string(),
      rotulo: z.string(),
      grupo: z.string().nullable(),
      /** null = a plataforma nao devolveu o valor (nunca 0). */
      valor: z.number().nullable(),
      unidade: z.enum(["pct", "contagem", "dias", "horas", "segundos", "nota"]),
      quantidade: z.number().nullable(),
      periodo_anterior: z.number().nullable(),
      /** Meta/limiar OFICIAL; null = a plataforma nao publica meta para este indicador. */
      meta: z.number().nullable(),
      comparador: z.string().nullable(),
      rotulo_meta: z.string().nullable(),
      situacao: z.enum(["ok", "fora", "sem_meta"]),
    }),
  ),
  indicadores_truncados: z.boolean(),
  avisos: z.array(z.string()),
});

const canalSchema = z.object({
  canal: z.enum(PERF_CANAIS),
  estado: z.enum(["disponivel", "sem_fonte", "indisponivel"]),
  motivo: z.string().nullable(),
  fonte: z.string().nullable(),
  /** nota_oficial = reputacao/saude da plataforma; atendimento_sem_nota_oficial = so' indicadores de atendimento (TikTok). */
  medicao: z.enum(["nota_oficial", "atendimento_sem_nota_oficial"]),
  contas: z.array(contaSchema),
  /** Marca do canal sem fotografia ainda: sem nota, nao e' nota 0. */
  sem_fotografia: z.array(z.object({ marca: z.string(), motivo: z.string().nullable() })),
  /** Marca pedida que nao existe neste canal. Nao e' nota 0. */
  marcas_fora_do_canal: z.array(z.object({ marca: z.string(), motivo: z.string().nullable() })),
});

const performanceContasOutput = envelopeSchema(
  z.object({
    ml: canalSchema.nullable(),
    shopee: canalSchema.nullable(),
    tiktok: canalSchema.nullable(),
    limitations: z.array(limitationSchema),
  }),
);

type CanalBlock = z.infer<typeof canalSchema>;

const ESTADO: Record<"dado" | "sem_fonte" | "erro", CanalBlock["estado"]> = {
  dado: "disponivel", sem_fonte: "sem_fonte", erro: "indisponivel",
};

async function canalBloco(canal: PerfCanal, marcas: readonly string[] | undefined, deps: ToolDeps): Promise<CanalBlock> {
  const medicao = canal === "tiktok" ? "atendimento_sem_nota_oficial" : "nota_oficial";
  let raw: unknown;
  try {
    raw = await deps.client.get("performanceOficial", {
      canal: API_CANAL[canal],
      brands: marcas && marcas.length > 0 ? [...marcas].sort() : undefined,
    });
  } catch (err) {
    // Um canal fora do ar (ou rota desligada no backend) nao derruba os outros.
    if (err instanceof OracleToolError && (err.category === "SOURCE_UNAVAILABLE" || err.category === "SOURCE_TIMEOUT")) {
      return {
        canal, estado: "indisponivel", motivo: "fonte_indisponivel_nesta_consulta", fonte: null, medicao,
        contas: [], sem_fotografia: [], marcas_fora_do_canal: [],
      };
    }
    throw err;
  }
  const p = parseUpstream(performanceContasContract, raw);
  // O canal devolvido tem de ser o pedido: troca silenciosa de canal seria numero de outra conta.
  if (p.canal !== API_CANAL[canal]) throw toolError("INVALID_UPSTREAM_RESPONSE");

  const mapMotivo = (x: { marca: string; motivo: string }) => ({ marca: x.marca, motivo: safeText(x.motivo) });
  return {
    canal,
    estado: ESTADO[p.estado],
    motivo: safeText(p.motivo),
    fonte: safeText(p.fonte),
    medicao,
    contas: (p.contas ?? []).map((c) => {
      const idade = ageHours(c.capturado_em, deps.now());
      const indicadores = (c.metricas ?? []).slice(0, MAX_INDICADORES);
      return {
        marca: c.marca,
        dia: c.dia,
        capturado_em: c.capturado_em,
        idade_horas: idade,
        fotografia_velha: idade !== null && idade > PERF_FOTO_VELHA_HORAS,
        nivel: safeText(c.nivel),
        tom: c.tom,
        termometro: numOrNull(c.termometro),
        termometro_max: numOrNull(c.termometro_max),
        resumo: safeText(c.resumo),
        destaques: (c.destaques ?? []).slice(0, 10).map((d) => ({
          rotulo: safeText(d.rotulo) ?? "", valor: safeText(d.valor) ?? "", tom: d.tom ?? null,
        })),
        indicadores: indicadores.map((m) => ({
          codigo: m.codigo,
          rotulo: safeText(m.rotulo) ?? m.codigo,
          grupo: safeText(m.grupo),
          valor: numOrNull(m.valor),
          unidade: m.unidade,
          quantidade: numOrNull(m.quantidade),
          periodo_anterior: numOrNull(m.anterior),
          meta: numOrNull(m.meta),
          comparador: safeText(m.comparador, 4),
          rotulo_meta: safeText(m.rotulo_meta),
          situacao: m.situacao,
        })),
        indicadores_truncados: (c.metricas ?? []).length > MAX_INDICADORES,
        avisos: (c.avisos ?? []).slice(0, 10).map((a) => safeText(a)).filter((a): a is string => a !== null),
      };
    }),
    sem_fotografia: (p.sem_foto ?? []).map(mapMotivo),
    marcas_fora_do_canal: p.cobertura.fora.map(mapMotivo),
  };
}

export const performanceContasTool: OracleTool = {
  name: "torre_performance_contas",
  config: {
    title: "Performance oficial das contas nos marketplaces",
    description: [
      "Use para 'qual a nota/reputacao da conta no Mercado Livre', 'como esta a Saude da Conta na Shopee', 'a marca perdeu o MercadoLider', 'qual indicador esta fora da meta da plataforma'.",
      "E' a medicao OFICIAL da plataforma (nivel/termometro, indicadores e meta oficiais por marca/conta), lida da fotografia diaria. NAO use para LDR/atrasos de despacho: isso e' a LDR interna da expedicao, em torre_expedicao_operacional.",
      "Cada canal traz estado: 'disponivel', 'sem_fonte' (captura ainda nao existe) ou 'indisponivel' — com motivo. Sem fonte ou sem fotografia NAO e' nota zero: diga que nao ha dado.",
      "Confira idade_horas/fotografia_velha: fotografia com mais de 48 h esta defasada e deve ser dita como tal.",
      "TikTok Shop Brasil NAO tem nota oficial (medicao='atendimento_sem_nota_oficial'): os indicadores sao de atendimento, sem meta oficial; nunca apresente como nota ou reputacao.",
      "Marca pedida que nao existe no canal aparece em marcas_fora_do_canal; marca sem captura, em sem_fotografia.",
      "meta=null significa que a plataforma nao publica meta para o indicador; situacao 'fora' vem da API (fora da meta oficial).",
    ].join(" "),
    inputSchema: performanceContasInput,
    outputSchema: performanceContasOutput,
  },
  async run(args, deps) {
    const input = performanceContasInput.parse(args);
    const canais: readonly PerfCanal[] = input.canais ?? PERF_CANAIS;

    const settled = await Promise.allSettled(canais.map((c) => canalBloco(c, input.marcas, deps)));
    // Erro de CONTRATO (ou de config) nunca e' mascarado: derruba a tool.
    for (const s of settled) if (s.status === "rejected") throw s.reason;
    const blocos = settled.map((s) => (s as PromiseFulfilledResult<CanalBlock>).value);
    // Todos fora do ar = a tool nao tem o que dizer: erro, nao envelope "vazio".
    if (blocos.every((b) => b.estado === "indisponivel" && b.fonte === null)) {
      throw toolError("SOURCE_UNAVAILABLE");
    }
    const por = (c: PerfCanal) => blocos.find((b) => b.canal === c) ?? null;

    const warnings: string[] = [];
    for (const b of blocos) {
      const nome = NOME[b.canal];
      if (b.estado !== "disponivel") {
        warnings.push(`${nome}: ${b.estado === "sem_fonte" ? "sem fonte" : "indisponivel"} (${b.motivo ?? "sem motivo informado"}) — nenhuma nota, nao trate como nota zero.`);
      }
      const velhas = b.contas.filter((c) => c.fotografia_velha);
      if (velhas.length > 0) {
        warnings.push(`${nome}: fotografia defasada (mais de ${PERF_FOTO_VELHA_HORAS} h) para ${velhas.map((c) => `${c.marca} (${c.idade_horas} h)`).join(", ")}.`);
      }
      if (b.sem_fotografia.length > 0) {
        warnings.push(`${nome}: sem fotografia para ${b.sem_fotografia.map((x) => x.marca).join(", ")} — sem nota, nao e' nota zero.`);
      }
      if (b.marcas_fora_do_canal.length > 0) {
        warnings.push(`${nome}: marca inexistente no canal: ${b.marcas_fora_do_canal.map((x) => x.marca).join(", ")} — ausencia, nao nota zero.`);
      }
      if (b.contas.some((c) => c.indicadores_truncados)) {
        warnings.push(`${nome}: lista de indicadores cortada em ${MAX_INDICADORES} por conta.`);
      }
    }

    const limitations: Limitation[] = [PERF_OFICIAL_NAO_E_LDR];
    if (blocos.some((b) => b.canal === "tiktok" && b.contas.length > 0)) limitations.push(PERF_TIKTOK_SEM_NOTA);

    const todas = blocos.flatMap((b) => b.contas);
    const maisAntiga = todas.map((c) => c.capturado_em).sort()[0] ?? null;

    const env = buildEnvelope({
      period: null,
      filtersApplied: { canais: [...canais], marcas: input.marcas ?? null },
      metricDefinition:
        "Nota/saude OFICIAL de cada conta na plataforma (nivel, termometro, indicadores e metas como a plataforma os publica), da fotografia diaria mais recente. Nenhum valor e' calculado pela Torre.",
      refreshedAt: maisAntiga,
      coverage: "uma linha por marca/conta e canal; so' o que a plataforma publicou — o que falta vem dito, nunca como zero",
      returnedCount: todas.length,
      warnings,
      data: { ml: por("ml"), shopee: por("shopee"), tiktok: por("tiktok"), limitations },
    });

    const partes = blocos.map((b) => {
      const nome = NOME[b.canal];
      if (b.contas.length === 0) return `${nome}: sem dado (${b.estado === "disponivel" ? "nenhuma conta com fotografia" : b.estado})`;
      const fora = b.contas.reduce((n, c) => n + c.indicadores.filter((i) => i.situacao === "fora").length, 0);
      const niveis = b.contas.map((c) => `${c.marca} ${c.nivel ?? "sem nivel"}`).join(", ");
      return `${nome}: ${niveis}${b.medicao === "nota_oficial" ? ` (${fora} indicador(es) fora da meta)` : " (atendimento, sem nota oficial)"}`;
    });
    return ok(`Performance oficial das contas. ${partes.join(". ")}.`, env);
  },
};
