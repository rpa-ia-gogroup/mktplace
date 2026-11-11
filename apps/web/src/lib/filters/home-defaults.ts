/**
 * Filtros padrao da Gerencial (home, `app/page.tsx`): periodo e comparacao.
 *
 * Os canais nao entram aqui: desde o T-0089 todas as telas abrem com os tres
 * canais (`DEFAULT_MARKETPLACE_SELECTION`), entao o "GMV do periodo" da home
 * ja' e' o total dos marketplaces, igual a soma de Canais e Marca 360 no mesmo
 * periodo. Vale so' para URL vazia; link com `channels=` explicito continua
 * mandando.
 */
import type { DefaultFiltersOptions } from "./url-state.ts";

export const HOME_FILTER_DEFAULTS = {
  // Abre no mes corrente (GERENCIAL-METAS-1): e' nele que a meta ainda pode
  // ser decidida. O mes fechado continua a um clique no seletor de periodo.
  defaultPreset: "mes_atual",
  defaultCompare: true,
} as const satisfies DefaultFiltersOptions;
