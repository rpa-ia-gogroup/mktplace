/**
 * torre_slow_moving — capital parado e itens parados no Marketplace.
 *
 * A REGRA de slow moving e' do Supply (Painel S&OE), nao da Torre: curva B/C,
 * descontinuado ou brinde com mais de `meta_dias` (120) de cobertura. A API so'
 * le o `slowmoving_marketplace_sn` e devolve UMA LINHA POR SKU.
 *
 * TRES REGRAS DE LEITURA:
 * 1. A API nao traz total de capital parado: ele e' a SOMA DAS LINHAS que a API
 *    devolve (`valor_parado`), igual a tela /full-slow-moving (`totais`/`porMarca`
 *    em `src/lib/full-slow-moving.ts`). Soma dentro de UM canal (Marketplace),
 *    nunca entre canais. Com `marcas`, soma so' as linhas das marcas pedidas.
 * 2. `capital_full`/`parado_full` e' o Full do Mercado Livre, outro recorte:
 *    sai separado e NUNCA e' somado ao Marketplace (nao se sabe a sobreposicao).
 * 3. `cobertura_dias` nulo = SKU sem venda nos ultimos 15 dias, nao cobertura 0.
 *
 * O backend manda a serie diaria de venda de cada SKU (~1 KB por SKU) e o
 * adapter corta em 256 KB: ver o relatorio sobre o teto (`ENDPOINT_MAX_BYTES`).
 */
import { z } from "zod";

import { buildEnvelope, fmtMoney, fmtNumber } from "./envelope.ts";
import type { Limitation } from "./limitations.ts";
import { BRANDS, noDuplicates } from "./schemas.ts";
import {
  envelopeSchema, limitationSchema, ok, safeText, type OracleTool,
} from "./tool-kit.ts";
import { parseUpstream } from "./upstream.ts";
import { slowMovingContract } from "./upstream-slow-moving.ts";

export const SLOW_MAX_LIMIT = 25;

export const slowMovingInput = z
  .object({
    marcas: noDuplicates(z.array(z.enum(BRANDS)).min(1).max(5), "marcas").optional(),
    limite: z.number().int().min(1).max(SLOW_MAX_LIMIT).default(10),
  })
  .strict();

// ---------------------------------------------------------------------------
// Limitacoes (locais: limitations.ts e' do dono)
// ---------------------------------------------------------------------------

export const SLOW_TOTAL_IS_SUM_OF_LINES: Limitation = {
  topic: "slow_moving_total_soma_das_linhas",
  scope: "Capital parado — Marketplace",
  description:
    "A API nao entrega um total de capital parado: o total e o por marca sao a soma das linhas por SKU que ela devolve, como na tela Slow Moving. Vale so' para o Marketplace e, com filtro de marca, so' para as marcas pedidas.",
};

export const SLOW_FULL_IS_SEPARATE: Limitation = {
  topic: "slow_moving_full_ml_separado",
  scope: "Capital parado — Full do Mercado Livre",
  description:
    "O capital do Full do Mercado Livre (full_ml) e outro recorte do estoque: NAO some com o capital parado do Marketplace, nem entre canais.",
};

export const SLOW_MOTIVO_DERIVADO: Limitation = {
  topic: "slow_moving_motivo_derivado",
  scope: "Itens parados — motivo",
  description:
    "A API nao diz qual criterio da regra do Supply pegou cada SKU. 'motivos' e derivado de curva e status (curva B/C, descontinuado, brinde) e pode vir vazio ou incompleto; a cobertura acima da meta vale para todos.",
};

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

const motivoEnum = z.enum(["curva_B", "curva_C", "descontinuado", "brinde"]);

const slowOutput = envelopeSchema(
  z.object({
    disponibilidade: z.enum(["available", "unavailable"]),
    motivo_indisponivel: z.string().nullable(),
    fonte: z.string().nullable(),
    /** Dia da fotografia do Supply (`YYYY-MM-DD`); null = nao informado. */
    fotografia_em: z.string().nullable(),
    regra: z.object({ cobertura_minima_dias: z.number().nullable(), descricao: z.string() }),
    marcas_filtradas: z.array(z.string()).nullable(),
    /** Capital parado no Marketplace (R$ a custo) = soma das linhas da API. null = sem leitura. */
    total: z.object({ itens: z.number(), capital_parado: z.number() }).nullable(),
    por_marca: z.array(
      z.object({
        marca: z.string(),
        itens: z.number().nullable(),
        capital_parado: z.number().nullable(),
        /** Capital de TODO o estoque do Marketplace da marca (API); null = nao lido. */
        capital_estoque_marketplace: z.number().nullable(),
      }),
    ),
    itens: z.array(
      z.object({
        sku: z.string(),
        produto: z.string().nullable(),
        marca: z.string(),
        categoria: z.string().nullable(),
        curva: z.string().nullable(),
        status: z.string().nullable(),
        motivos: z.array(motivoEnum),
        estoque_pecas: z.number().nullable(),
        /** null = sem venda nos ultimos 15 dias. */
        cobertura_dias: z.number().nullable(),
        sem_venda_15d: z.boolean(),
        venda_dia_15d: z.number(),
        custo_unitario: z.number().nullable(),
        capital_parado: z.number(),
      }),
    ),
    /** Full ML: recorte separado, nunca somado ao Marketplace. null = nao lido. */
    full_ml: z
      .object({
        por_marca: z.array(
          z.object({
            marca: z.string(),
            capital_no_full: z.number().nullable(),
            parado_no_full: z.number().nullable(),
          }),
        ),
      })
      .nullable(),
    limitations: z.array(limitationSchema),
  }),
);

type Motivo = z.infer<typeof motivoEnum>;
type Marca = (typeof BRANDS)[number];

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const r2 = (v: number) => Math.round(v * 100) / 100;

function motivosDe(
  curva: string | null | undefined,
  status: string | null | undefined,
  categoria: string | null | undefined,
): Motivo[] {
  const out: Motivo[] = [];
  const c = (curva ?? "").trim().toUpperCase();
  if (c === "B") out.push("curva_B");
  if (c === "C") out.push("curva_C");
  const st = semAcento(`${status ?? ""} ${categoria ?? ""}`);
  if (st.includes("descontinu")) out.push("descontinuado");
  if (st.includes("brinde")) out.push("brinde");
  return out;
}

export const slowMovingTool: OracleTool = {
  name: "torre_slow_moving",
  config: {
    title: "Capital parado e itens parados (slow moving)",
    description: [
      "Use para 'quanto capital esta parado', 'quais itens estao parados', 'qual marca tem mais slow moving' e 'quantos SKUs em slow moving'.",
      "Slow moving no Marketplace pela regra do Supply (Painel S&OE): SKU de curva B/C, descontinuado ou brinde com mais de 120 dias de cobertura. Capital em R$ a custo, nao a preco de venda.",
      "Devolve capital parado total e por marca, quantidade de itens e os TOP N itens por capital parado (limite 1-25, padrao 10): sku, produto, marca, curva, estoque, cobertura em dias, motivos.",
      "O total e a soma das linhas por SKU da API (ela nao traz total pronto); com 'marcas' soma so' essas marcas. NAO some com 'full_ml', que e o Full do Mercado Livre, outro recorte, nem entre canais.",
      "cobertura_dias nulo = SKU sem venda nos ultimos 15 dias, nao zero dias. 'motivos' e derivado de curva/status e pode vir vazio. 'itens' e so' o topo: total.itens e o numero real.",
      "Base indisponivel = nenhum numero, nao trate como capital zero. NAO use para estoque do Full por curva, ruptura ou venda perdida.",
    ].join(" "),
    inputSchema: slowMovingInput,
    outputSchema: slowOutput,
  },
  async run(args, deps) {
    const input = slowMovingInput.parse(args);
    const p = parseUpstream(slowMovingContract, await deps.client.get("fullSlowMoving"));

    const marcas: Marca[] | null = input.marcas ? [...input.marcas] : null;
    const noEscopo = (m: string) => !marcas || marcas.includes(m.toLowerCase() as Marca);
    const fotografia = safeText(p.atualizado_em, 10);
    const disponivel = p.status === "ok";
    const warnings: string[] = [];
    const limitations: Limitation[] = [SLOW_TOTAL_IS_SUM_OF_LINES, SLOW_MOTIVO_DERIVADO];

    const regra = {
      cobertura_minima_dias: disponivel ? p.meta_dias : null,
      descricao: "Curva B/C, descontinuado ou brinde com cobertura no Marketplace acima da meta (Supply, Painel S&OE).",
    };

    if (!disponivel) {
      const st = safeText(p.status, 40) ?? "sem_status";
      warnings.push(`Slow moving indisponivel (status '${st}') — nenhum numero, nao trate como capital zero.`);
      const env = buildEnvelope({
        period: null,
        filtersApplied: { marcas, limite: input.limite },
        metricDefinition: "Capital parado (R$ a custo) no Marketplace, regra do Supply.",
        refreshedAt: fotografia,
        coverage: "indisponivel",
        limit: input.limite,
        returnedCount: 0,
        warnings,
        data: {
          disponibilidade: "unavailable" as const,
          motivo_indisponivel: st,
          fonte: safeText(p.fonte),
          fotografia_em: fotografia,
          regra,
          marcas_filtradas: marcas,
          total: null,
          por_marca: [],
          itens: [],
          full_ml: null,
          limitations,
        },
      });
      return ok("Slow moving indisponivel — nenhum numero, nao trate como capital zero.", env);
    }

    const linhas = p.skus.filter((s) => noEscopo(s.marca));
    // Lista vazia SEM fotografia: a base pode simplesmente nao ter sido lida.
    const semLeitura = p.skus.length === 0 && !fotografia;
    if (semLeitura) {
      warnings.push(
        "A API devolveu lista vazia e sem data de fotografia do Supply: nao afirme que nao ha capital parado — a base pode nao ter sido lida.",
      );
    } else if (linhas.length === 0) {
      warnings.push(
        marcas
          ? `Nenhum SKU em slow moving para ${marcas.join(", ")} na fotografia do Supply.`
          : "Nenhum SKU em slow moving na fotografia do Supply.",
      );
    }

    // Soma das linhas da API (regra 1), por marca e total.
    const acc = new Map<string, { itens: number; capital: number }>();
    for (const s of linhas) {
      const m = s.marca.toLowerCase();
      const a = acc.get(m) ?? { itens: 0, capital: 0 };
      a.itens += 1;
      a.capital += s.valor_parado;
      acc.set(m, a);
    }
    const capMkt = p.capital_marketplace ?? {};
    // Marca pedida sem linha: zero REAL so' se a base foi lida; senao null.
    const nomes = new Set<string>([...acc.keys(), ...(marcas ?? [])]);
    const porMarca = [...nomes]
      .map((marca) => {
        const a = acc.get(marca);
        return {
          marca,
          itens: a ? a.itens : semLeitura ? null : 0,
          capital_parado: a ? r2(a.capital) : semLeitura ? null : 0,
          capital_estoque_marketplace: marca in capMkt ? capMkt[marca]! : null,
        };
      })
      .sort((x, y) => (y.capital_parado ?? -1) - (x.capital_parado ?? -1) || x.marca.localeCompare(y.marca));

    const total = semLeitura
      ? null
      : { itens: linhas.length, capital_parado: r2(linhas.reduce((t, s) => t + s.valor_parado, 0)) };

    const topo = [...linhas].sort((a, b) => b.valor_parado - a.valor_parado).slice(0, input.limite);
    const itens = topo.map((s) => ({
      sku: s.sku,
      produto: safeText(s.descricao, 120),
      marca: s.marca.toLowerCase(),
      categoria: safeText(s.categoria, 60),
      curva: safeText(s.curva, 10),
      status: safeText(s.status, 40),
      motivos: motivosDe(s.curva, s.status, s.categoria),
      estoque_pecas: s.estoque ?? null,
      cobertura_dias: s.cobertura_dias ?? null,
      sem_venda_15d: s.venda_dia <= 0,
      venda_dia_15d: s.venda_dia,
      custo_unitario: s.custo_unitario ?? null,
      capital_parado: r2(s.valor_parado),
    }));
    if (itens.some((i) => i.estoque_pecas === null)) {
      warnings.push("Alguns itens vem sem estoque em pecas (sem custo e sem venda para estimar): campo nulo, nao zero.");
    }

    // Full ML: recorte separado (regra 2). Dicionario vazio = nao lido.
    const capFull = p.capital_full ?? {};
    const parFull = p.parado_full ?? {};
    const fullNomes = [...new Set([...Object.keys(capFull), ...Object.keys(parFull)])].filter(noEscopo).sort();
    const fullMl =
      fullNomes.length === 0
        ? null
        : {
            por_marca: fullNomes.map((marca) => ({
              marca,
              capital_no_full: marca in capFull ? capFull[marca]! : null,
              parado_no_full: marca in parFull ? parFull[marca]! : null,
            })),
          };
    if (fullMl) limitations.push(SLOW_FULL_IS_SEPARATE);
    else warnings.push("Capital do Full do Mercado Livre nao lido pela API nesta consulta (full_ml nulo) — nao trate como zero.");

    const env = buildEnvelope({
      period: null,
      filtersApplied: { marcas, limite: input.limite },
      metricDefinition:
        "Capital parado = R$ a custo (custo unitario x pecas) dos SKUs em slow moving no Marketplace pela regra do Supply; total e por marca = soma das linhas por SKU da API. Itens ordenados por capital parado, maior primeiro. refreshed_at = dia da fotografia do Supply (so' a data).",
      refreshedAt: fotografia,
      coverage: `Marketplace (Supply Intelligence), regra de ${p.meta_dias} dias de cobertura; Full ML separado`,
      limit: input.limite,
      returnedCount: itens.length,
      totalCount: semLeitura ? null : linhas.length,
      warnings,
      data: {
        disponibilidade: "available" as const,
        motivo_indisponivel: null,
        fonte: safeText(p.fonte),
        fotografia_em: fotografia,
        regra,
        marcas_filtradas: marcas,
        total,
        por_marca: porMarca,
        itens,
        full_ml: fullMl,
        limitations,
      },
    });

    const lider = porMarca.find((m) => m.capital_parado !== null && m.capital_parado > 0);
    const head = total
      ? `Slow moving (Marketplace): ${fmtMoney(total.capital_parado)} parados em ${fmtNumber(total.itens)} itens${lider && !marcas ? `; maior marca: ${lider.marca} (${fmtMoney(lider.capital_parado)})` : ""}. Total = soma das linhas da API.`
      : "Slow moving: sem leitura da base — nenhum numero, nao trate como capital zero.";
    return ok(head, env);
  },
};
