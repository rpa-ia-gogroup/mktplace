/**
 * Contratos MINIMOS para a tool `torre_metas`.
 *
 * - `GET /api/v1/metas/{mes}` (schemas/metas.py): so' as celulas COM meta. Celula
 *   ausente = sem meta, nunca zero.
 * - `GET /api/v1/performance/brands`: o `brandsContract` de `upstream.ts` nao le
 *   o GMV por canal de cada marca (so' `total_gmv`), que e' o que a meta compara.
 *   Aqui o contrato le `tiktok_gmv`/`ml_gmv`/`shopee_gmv` (`BrandPerformance`).
 *
 * Canal e marca sao enums FECHADOS: mudam a leitura (qual coluna de GMV compara).
 */
import { z } from "zod";

import { BRANDS, CHANNELS } from "./schemas.ts";

const optNum = z.number().finite().nullish();

export const metasContract = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  celulas: z.array(
    z.object({
      brand: z.enum(BRANDS),
      channel: z.enum(CHANNELS),
      meta_gmv: z.number().finite().min(0),
    }),
  ),
  ultima_alteracao: z.string().nullish(),
});

export const brandsGmvContract = z.object({
  brands: z.array(
    z.object({
      brand: z.string().min(1),
      tiktok_gmv: optNum,
      ml_gmv: optNum,
      shopee_gmv: optNum,
    }),
  ),
  refreshed_at: z.string().nullish(),
});
