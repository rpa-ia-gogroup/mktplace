/**
 * T-0089 — filtros padrao da Gerencial (home, `app/page.tsx`).
 *
 * A home abre com os TRES canais: o "GMV do periodo" e' o total dos
 * marketplaces, igual a soma que Canais e Marca 360 mostram no mesmo periodo.
 * Antes ela herdava o Consolidado (ML + Shopee) das outras telas e o TikTok
 * sumia do GMV sem aviso (achado A1-03 do QA).
 *
 * So' a home muda: as demais telas seguem no Consolidado
 * (`DEFAULT_MARKETPLACE_SELECTION`). Vale so' para URL vazia; link com
 * `channels=` explicito continua mandando.
 */
import { ALL_MARKETPLACE_SELECTION } from "../marketplace-filter.ts";
import type { DefaultFiltersOptions } from "./url-state.ts";

export const HOME_FILTER_DEFAULTS = {
  // Abre no mes corrente (GERENCIAL-METAS-1): e' nele que a meta ainda pode
  // ser decidida. O mes fechado continua a um clique no seletor de periodo.
  defaultPreset: "mes_atual",
  defaultCompare: true,
  defaultChannels: ALL_MARKETPLACE_SELECTION,
} as const satisfies DefaultFiltersOptions;
