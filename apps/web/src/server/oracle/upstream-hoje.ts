/**
 * Contrato MINIMO de `GET /api/v1/performance/hoje-por-hora` (VENDAS-POR-HORA-1).
 *
 * Mesma regra de `upstream.ts`: contrato quebrado vira INVALID_UPSTREAM_RESPONSE,
 * nunca "sucesso vazio". Enums que mudam a leitura (canal, base) sao FECHADOS.
 * Campos que o backend sempre serializa (corte_hora, por_canal, canais_fora) sao
 * obrigatorios: ausencia NAO pode virar "nenhum canal fora" nem "corte 0".
 */
import { z } from "zod";

const num = z.number().finite();
const canal = z.enum(["tiktok", "ml", "shopee"]);

export const blocoVendasContract = z.object({
  gmv: num,
  pedidos: z.number().int().nonnegative(),
  /** null = sem pedido no recorte. */
  ticket: num.nullish(),
});

const tendenciaContract = {
  hoje: num,
  ontem_mesma_hora: num,
  ontem_dia: num,
  /** null = sem venda ontem ate' o corte (sem base de ritmo). Nunca 0. */
  projecao: num.nullish(),
};

export const hojePorHoraContract = z.object({
  disponivel: z.boolean(),
  motivo: z.string().nullish(),
  dia: z.string().min(1),
  corte_hora: z.number().int().min(0).max(24).nullish(),
  canais: z.array(
    z.object({
      channel: canal,
      fonte_ate: z.string().nullish(),
      horas_fechadas_hoje: z.number().int().min(0).max(24),
      corte_hora: z.number().int().min(0).max(24),
    }),
  ),
  limitacoes: z.array(z.string()),
  hoje: blocoVendasContract.nullish(),
  ontem: blocoVendasContract.nullish(),
  semana_passada: blocoVendasContract.nullish(),
  por_canal: z.array(
    z.object({
      channel: canal,
      hoje: blocoVendasContract,
      ontem: blocoVendasContract,
      semana_passada: blocoVendasContract,
    }),
  ),
  por_marca: z.array(
    z.object({
      brand: z.string().min(1),
      ...tendenciaContract,
      por_canal: z.array(z.object({ channel: canal, ...tendenciaContract })),
      canais_fora: z.array(canal),
    }),
  ),
  base: z.enum(["pagos", "realizados"]),
  nao_pago_disponivel: z.object({ tiktok: z.boolean(), ml: z.boolean(), shopee: z.boolean() }).nullish(),
});

export type HojePorHora = z.output<typeof hojePorHoraContract>;
