import type { Marketplace } from "../mock-data";

/** Estado completo dos filtros globais (canal, marca, periodo, comparacao). */
export interface GlobalFilters {
  channels: Marketplace[];
  /** Marcas selecionadas (brand_key). Vazio = todas (sem filtro). */
  brands: string[];
  /** YYYY-MM-DD, inclusive. */
  dateFrom: string;
  /** YYYY-MM-DD, inclusive. */
  dateTo: string;
  compare: boolean;
  /** Preset clicado (`?periodo=`). Vale so' enquanto o intervalo bater com ele;
   * sem ele, o preset aceso sai de `detectPreset`. Ausente = personalizado ou
   * URL antiga. */
  periodo?: DatePreset;
}

export type DatePreset =
  | "hoje"
  | "ontem"
  | "semana_atual"
  | "semana_passada"
  | "7d"
  | "30d"
  | "90d"
  | "mes_atual"
  | "mes_anterior"
  | "personalizado";
