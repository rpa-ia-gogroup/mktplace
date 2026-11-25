/**
 * Contrato MINIMO de `GET /api/v1/performance/full-slow-moving`
 * (`SlowMovingResponse` em apps/api/app/schemas/full_slow_moving.py).
 *
 * So' o que a tool le. `serie` e `receita_15d` (venda diaria por canal de cada
 * SKU, a parte pesada do payload) NAO sao declarados: o Zod os descarta.
 * Contrato quebrado vira INVALID_UPSTREAM_RESPONSE (`parseUpstream`).
 */
import { z } from "zod";

const optNum = z.number().finite().nullish();
const optStr = z.string().nullish();
const porMarca = z.record(z.string(), z.number().finite());

export const slowMovingContract = z.object({
  /** O backend sempre manda "ok"; outro valor e' tratado como indisponivel. */
  status: z.string(),
  fonte: optStr,
  /** Dia da fotografia do Supply (`YYYY-MM-DD`); null = nao lido. */
  atualizado_em: optStr,
  meta_dias: z.number().finite(),
  skus: z.array(
    z.object({
      marca: z.string().min(1),
      sku: z.string().min(1),
      descricao: z.string(),
      categoria: optStr,
      curva: optStr,
      status: optStr,
      estoque: optNum,
      custo_unitario: optNum,
      valor_parado: z.number().finite(),
      venda_dia: z.number().finite(),
      /** null = sem venda (nao e' zero dias). */
      cobertura_dias: optNum,
    }),
  ),
  /** Capital de TODO o estoque do Marketplace por marca; vazio = nao lido. */
  capital_marketplace: porMarca.nullish(),
  /** Capital no Full do Mercado Livre por marca; vazio = nao lido. */
  capital_full: porMarca.nullish(),
  /** Parte do capital do Full que e' SKU em slow moving; vazio = nao lido. */
  parado_full: porMarca.nullish(),
});

export type SlowMovingUpstream = z.output<typeof slowMovingContract>;
