/**
 * UX-TORRE-2 — resumo legivel da selecao de filtros globais.
 *
 * Aparece no botao "Filtros" do mobile, onde os controles ficam recolhidos:
 * quem rola a tela precisa saber o ESCOPO do que esta lendo sem abrir nada.
 * O resumo e' derivado da mesma `GlobalFilters` que vai para a API — nunca de
 * um estado paralelo — e por isso nao pode divergir do que foi pedido.
 *
 * Funcao pura: testavel com node:test, sem React.
 */
import { ALL_MARKETPLACES, isAllSelected, isConsolidadoSelected } from "../marketplace-filter.ts";
import type { Marketplace } from "../mock-data.ts";
import { FILTER_BRAND_KEYS, brandLabel } from "./brands.ts";
import { fmtPeriodo } from "./format.ts";
import type { GlobalFilters } from "./types.ts";

const CANAL: Record<Marketplace, string> = {
  tiktok: "TikTok Shop",
  ml: "Mercado Livre",
  shopee: "Shopee",
};

export interface OpcoesResumo {
  /** Tela cuja fonte nao calcula delta: `compare` na URL nao vira afirmacao. */
  semComparacao?: boolean;
}

export function resumoCanais(channels: readonly Marketplace[]): string {
  if (isAllSelected(channels)) return "Todos os canais";
  if (isConsolidadoSelected(channels)) return "Consolidado (ML + Shopee)";
  return ALL_MARKETPLACES.filter((c) => channels.includes(c)).map((c) => CANAL[c]).join(" + ");
}

export function resumoMarcas(brands: readonly string[]): string {
  // Vazio e' "todas" (sem filtro), nunca "nenhuma". Selecionar as cinco
  // explicitamente tambem e' "todas" para quem le.
  if (brands.length === 0 || FILTER_BRAND_KEYS.every((b) => brands.includes(b))) return "Todas as marcas";
  return [...brands].sort().map(brandLabel).join(", ");
}

/**
 * FILTROS-PADRAO — quais filtros sairam do padrao da aba (o que `computeDefaultFilters`
 * daria para URL vazia). Comparacao fica de fora: e' leitura, nao escopo.
 */
export function filtrosForaDoPadrao(filters: GlobalFilters, padrao: GlobalFilters): ("canal" | "marca" | "periodo")[] {
  const mesmo = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const fora: ("canal" | "marca" | "periodo")[] = [];
  if (!mesmo(filters.channels, padrao.channels)) fora.push("canal");
  if (!mesmo(filters.brands, padrao.brands)) fora.push("marca");
  if (filters.dateFrom !== padrao.dateFrom || filters.dateTo !== padrao.dateTo) fora.push("periodo");
  return fora;
}

export function resumoDosFiltros(filters: GlobalFilters, opcoes: OpcoesResumo = {}): string {
  const partes = [
    resumoCanais(filters.channels),
    resumoMarcas(filters.brands),
    fmtPeriodo(filters.dateFrom, filters.dateTo),
  ];
  if (filters.compare && !opcoes.semComparacao) partes.push("vs. período anterior");
  return partes.join(" · ");
}
