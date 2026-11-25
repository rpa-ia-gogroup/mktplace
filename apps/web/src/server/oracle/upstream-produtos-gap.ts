/**
 * Contrato MINIMO de `GET /api/v1/performance/produtos-gap`
 * (`produtos_gap_service.get_produtos_gap` em apps/api). So' o que a tool le.
 * Os numeros ja' vem calculados pela API; o adapter nao soma nem divide nada.
 */
import { z } from "zod";

const optNum = z.number().finite().nullish();
const optStr = z.string().nullish();
const num = z.number().finite();

export const GAP_CANAIS = ["ml", "shopee", "tiktok"] as const;
export const GAP_COMPARAR = ["ontem", "semana_passada"] as const;

const porCanal = z.object({
  canal: z.enum(GAP_CANAIS),
  receita_hoje: num,
  pecas_hoje: num,
  receita_comparado: num,
  pecas_comparado: num,
  diferenca_rs: num,
});

const estoque = z.object({
  canal: z.enum(GAP_CANAIS),
  estado: z.enum(["medido", "sem_dado"]),
  full_vendavel: optNum,
  estoque_vendedor_fora_do_full: optNum,
  classificacao: optStr,
});

const skuContract = z.object({
  sku: z.string(),
  nome: optStr,
  receita_hoje: num,
  pecas_hoje: num,
  receita_comparado: num,
  pecas_comparado: num,
  diferenca_rs: num,
  diferenca_pct: optNum,
  preco_medio_hoje: optNum,
  preco_medio_comparado: optNum,
  variacao_preco_pct: optNum,
  por_canal: z.array(porCanal),
  estoque: z.array(estoque),
});

export type GapSku = z.infer<typeof skuContract>;

export const produtosGapContract = z.object({
  disponivel: z.boolean(),
  marca: z.string(),
  dia: z.string(),
  dia_comparado: z.string(),
  comparar: z.enum(GAP_COMPARAR),
  fonte: z.string(),
  metodo: z.enum(["mesmo_corte_de_hora"]),
  canais: z.array(
    z.object({
      canal: z.enum(GAP_CANAIS),
      estado: z.enum(["medido", "sem_dado"]),
      corte_hora: optNum,
      motivo: optStr,
    }),
  ),
  total: z
    .object({ receita_hoje: num, receita_comparado: num, diferenca_rs: num, diferenca_pct: optNum })
    .nullish(),
  skus_considerados: optNum,
  maiores_quedas: z.array(skuContract),
  maiores_altas: z.array(skuContract),
  limitacoes: z.array(z.string()),
});
