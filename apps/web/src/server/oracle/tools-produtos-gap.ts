/**
 * torre_produtos_gap — quais SKUs de uma marca explicam a diferenca contra ontem
 * (ou a semana passada), no MESMO corte de hora de cada canal.
 *
 * FONTE: venda por hora POR SKU (pedidos e itens do Data Mart), cada canal na sua
 * ultima hora fechada — o mesmo corte do `torre_hoje`. Nao ha' escalonamento por curva.
 * TODA a conta (soma por SKU, diferenca, %, preco medio) e' feita na API; aqui so'
 * se valida o contrato, se limpa o texto e se declara o que falta.
 * Ausencia nunca vira zero: canal sem dado fica FORA dos totais e e' dito em `canais`;
 * campo nulo e' "sem leitura" (SKU fora da fotografia de estoque, sem base de preco).
 */
import { z } from "zod";

import { buildEnvelope, fmtMoney } from "./envelope.ts";
import type { Limitation } from "./limitations.ts";
import { BRANDS } from "./schemas.ts";
import { envelopeSchema, limitationSchema, ok, safeText, safeTexts, type OracleTool } from "./tool-kit.ts";
import { parseUpstream } from "./upstream.ts";
import { GAP_CANAIS, GAP_COMPARAR, produtosGapContract, type GapSku } from "./upstream-produtos-gap.ts";

export const GAP_MAX_LIMIT = 50;

export const produtosGapInput = z
  .object({
    marca: z.enum(BRANDS),
    canal: z.enum(GAP_CANAIS).optional(),
    comparar: z.enum(GAP_COMPARAR).default("ontem"),
    limite: z.number().int().min(1).max(GAP_MAX_LIMIT).default(10),
  })
  .strict();

export const GAP_MESMO_CORTE: Limitation = {
  topic: "produtos_gap_mesmo_corte",
  scope: "Produtos — hoje x comparado",
  description:
    "Hoje e o dia comparado somam ate' a MESMA hora, e cada canal usa a sua ultima hora fechada (um canal atrasado nao segura os outros). Hoje esta parcial por definicao: compare so' com o mesmo corte.",
};

export const GAP_SKU_SOMADO: Limitation = {
  topic: "produtos_gap_sku_entre_canais",
  scope: "Produtos — SKU",
  description:
    "O SKU e' o codigo do vendedor em cada canal (o anuncio quando nao ha codigo). Os numeros do SKU somam os canais pedidos; 'por_canal' mostra a parte de cada um. Receita do ML = preco do item; Shopee = valor do item; TikTok = preco de venda por peca — a base pode diferir um pouco do GMV por pedido do torre_hoje.",
};

const canalEnum = z.enum(GAP_CANAIS);

const porCanalOut = z.object({
  canal: canalEnum,
  receita_hoje: z.number(),
  pecas_hoje: z.number(),
  receita_comparado: z.number(),
  pecas_comparado: z.number(),
  diferenca_rs: z.number(),
});

const skuOut = z.object({
  sku: z.string(),
  produto: z.string().nullable(),
  receita_hoje: z.number(),
  pecas_hoje: z.number(),
  receita_comparado: z.number(),
  pecas_comparado: z.number(),
  diferenca_rs: z.number(),
  /** null = sem receita no dia comparado (nao ha' base para %). */
  diferenca_pct: z.number().nullable(),
  /** null = sem peca vendida naquela janela. */
  preco_medio_hoje: z.number().nullable(),
  preco_medio_comparado: z.number().nullable(),
  variacao_preco_pct: z.number().nullable(),
  por_canal: z.array(porCanalOut),
  /** So' ML e Shopee. Estoque do vendedor = estoque proprio da loja, fora do Full; nao somar ao Full. */
  estoque: z.array(
    z.object({
      canal: canalEnum,
      estado: z.enum(["medido", "sem_dado"]),
      full_vendavel: z.number().nullable(),
      estoque_vendedor_fora_do_full: z.number().nullable(),
      classificacao: z.string().nullable(),
    }),
  ),
});

const gapOutput = envelopeSchema(
  z.object({
    disponivel: z.boolean(),
    marca: z.string(),
    dia: z.string(),
    dia_comparado: z.string(),
    comparar: z.enum(GAP_COMPARAR),
    /** Qual fonte foi usada, em texto. */
    fonte: z.string(),
    canais: z.array(
      z.object({
        canal: canalEnum,
        estado: z.enum(["medido", "sem_dado"]),
        /** Hora cheia ate' onde (exclusive) se soma. null = canal sem dado. */
        corte_hora: z.number().nullable(),
        motivo: z.string().nullable(),
      }),
    ),
    total: z
      .object({
        receita_hoje: z.number(),
        receita_comparado: z.number(),
        diferenca_rs: z.number(),
        diferenca_pct: z.number().nullable(),
      })
      .nullable(),
    skus_considerados: z.number().nullable(),
    /** Ordenado pelo maior gap negativo em R$. */
    maiores_quedas: z.array(skuOut),
    /** Top 5 que mais subiram. */
    maiores_altas: z.array(skuOut),
    limitations: z.array(limitationSchema),
  }),
);

function skuDe(s: GapSku): z.infer<typeof skuOut> {
  return {
    sku: s.sku,
    produto: safeText(s.nome, 120),
    receita_hoje: s.receita_hoje,
    pecas_hoje: s.pecas_hoje,
    receita_comparado: s.receita_comparado,
    pecas_comparado: s.pecas_comparado,
    diferenca_rs: s.diferenca_rs,
    diferenca_pct: s.diferenca_pct ?? null,
    preco_medio_hoje: s.preco_medio_hoje ?? null,
    preco_medio_comparado: s.preco_medio_comparado ?? null,
    variacao_preco_pct: s.variacao_preco_pct ?? null,
    por_canal: s.por_canal,
    estoque: s.estoque.map((e) => ({
      canal: e.canal,
      estado: e.estado,
      full_vendavel: e.full_vendavel ?? null,
      estoque_vendedor_fora_do_full: e.estoque_vendedor_fora_do_full ?? null,
      classificacao: safeText(e.classificacao, 40),
    })),
  };
}

export const produtosGapTool: OracleTool = {
  name: "torre_produtos_gap",
  config: {
    title: "Produtos: quais SKUs explicam a queda ou a alta do dia",
    description: [
      "Use para 'por que a marca X esta mais baixa que ontem', 'quais SKUs cairam', 'o que puxou a queda' e 'quais produtos subiram' (hoje ate' agora contra ontem ou a semana passada).",
      "Entrada: marca (obrigatoria), canal opcional (ml, shopee ou tiktok; padrao todos), comparar ('ontem' ou 'semana_passada'; padrao ontem), limite (1-50, padrao 10).",
      "Por SKU: receita e pecas de hoje ate' o corte e do dia comparado NO MESMO CORTE de hora (cada canal na sua ultima hora fechada), diferenca em R$ e %, preco medio hoje x comparado. maiores_quedas vem ordenado pelo maior gap negativo em R$; maiores_altas traz os 5 que mais subiram.",
      "Quando ha' dado: estoque Full do ML/Shopee e classificacao (ruptura etc.) do SKU; na Shopee, estoque_vendedor_fora_do_full e' estoque proprio da loja, fora do Full — nao somar ao Full. Estoque nulo ou sem_dado = sem leitura, nao zero.",
      "Fonte: venda por hora por SKU (Data Mart); tudo e' calculado na API. Canal sem dado fica fora dos totais e e' dito em 'canais'. diferenca_pct nula = sem base no dia comparado.",
      "NAO use para o total da marca por hora (use torre_hoje) nem para meta (torre_metas).",
    ].join(" "),
    inputSchema: produtosGapInput,
    outputSchema: gapOutput,
  },
  async run(args, deps) {
    const input = produtosGapInput.parse(args);
    const p = parseUpstream(
      produtosGapContract,
      await deps.client.get("produtosGap", {
        brand: input.marca,
        canal: input.canal,
        comparar: input.comparar,
        limite: input.limite,
      }),
    );
    const semDado = p.canais.filter((c) => c.estado === "sem_dado");
    const warnings = [
      "Hoje esta parcial ate' o corte de cada canal; o dia comparado soma ate' o mesmo corte.",
      ...semDado.map((c) => `${c.canal}: sem dado (${safeText(c.motivo, 200) ?? "sem motivo"}) — fora dos totais, nao e' venda zero.`),
      ...safeTexts(p.limitacoes, 300),
    ];
    const quedas = p.maiores_quedas.map(skuDe);
    const altas = p.maiores_altas.map(skuDe);
    const comCanais = p.canais.filter((c) => c.estado === "medido").map((c) => c.canal).join(", ");
    const env = buildEnvelope({
      period: { start: p.dia, end: p.dia, inclusive: true },
      filtersApplied: { marca: input.marca, canal: input.canal ?? null, comparar: input.comparar, limite: input.limite },
      metricDefinition:
        "Receita e pecas por SKU de hoje ate' o corte de hora de cada canal, contra o dia comparado ate' a mesma hora; diferenca = hoje - comparado (R$ e %); preco medio = receita / pecas. Calculado na API a partir de pedidos e itens com hora.",
      refreshedAt: null,
      coverage: `${input.marca}; canais ${comCanais || "nenhum com dado"}; ate ${input.limite} quedas e 5 altas`,
      limit: input.limite,
      returnedCount: quedas.length + altas.length,
      warnings,
      data: {
        disponivel: p.disponivel,
        marca: p.marca,
        dia: p.dia,
        dia_comparado: p.dia_comparado,
        comparar: p.comparar,
        fonte: safeText(p.fonte, 300) ?? "",
        canais: p.canais.map((c) => ({
          canal: c.canal, estado: c.estado, corte_hora: c.corte_hora ?? null, motivo: safeText(c.motivo, 200),
        })),
        total: p.total ? { ...p.total, diferenca_pct: p.total.diferenca_pct ?? null } : null,
        skus_considerados: p.skus_considerados ?? null,
        maiores_quedas: quedas,
        maiores_altas: altas,
        limitations: [GAP_MESMO_CORTE, GAP_SKU_SOMADO],
      },
    });
    const head = p.total
      ? `${input.marca}: ${fmtMoney(p.total.diferenca_rs)} contra ${p.comparar === "ontem" ? "ontem" : "a semana passada"} no mesmo corte; ${quedas.length} SKU(s) em queda listados${quedas[0] ? `, maior gap: ${quedas[0].sku} (${fmtMoney(quedas[0].diferenca_rs)})` : ""}.`
      : `${input.marca}: sem dado para comparar nos canais pedidos — nao trate como zero.`;
    return ok(head, env);
  },
};
