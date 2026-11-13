import type { CoverageLevel } from "./api-client";
import { fmtPctSimples } from "./formatters.ts";

/** Denominador 0/ausente vira "N/A" — nunca "0%" (mesma regra do backend,
 * ver app/services/regioes_service.py::_pct). */
export function fmtPctOrNA(pct: number | null): string {
  if (pct == null) return "N/A";
  return fmtPctSimples(pct);
}

export function coverageLabel(level: CoverageLevel): string {
  switch (level) {
    case "ok": return "Cobertura OK";
    case "partial": return "Cobertura parcial";
    case "low": return "Cobertura baixa";
    case "not_applicable": return "N/A";
  }
}

export function coverageBadgeClass(level: CoverageLevel): string {
  switch (level) {
    case "ok": return "bg-ok-soft text-ok-ink border-ok/30";
    case "partial": return "bg-warn-soft text-warn-ink border-warn/30";
    case "low": return "bg-crit-soft text-crit-ink border-crit/30";
    case "not_applicable": return "bg-raised text-ink-faint border-line";
  }
}

/**
 * TikTok nunca tem linha em marts.fact_marketplace_region_daily (nenhuma
 * fonte mapeada expoe UF do pedido) — se o canal foi pedido mas nao tem
 * cobertura regional, o aviso precisa deixar claro que os numeros exibidos
 * NAO incluem TikTok, para nunca ser lido como "TikTok vendeu R$0" (ver
 * docs/regional_design_draft.md).
 */
export function semCoberturaAviso(channelsSemCobertura: string[]): string | null {
  if (channelsSemCobertura.length === 0) return null;
  const nomes: Record<string, string> = { tiktok: "TikTok Shop", ml: "Mercado Livre", shopee: "Shopee" };
  const labels = channelsSemCobertura.map((c) => nomes[c] ?? c);
  return (
    `${labels.join(", ")} não tem cobertura regional (nenhuma fonte mapeada expõe UF do pedido) — ` +
    `não incluído nos números abaixo. Isso NÃO significa venda zero, apenas ausência de dado regional.`
  );
}

/** Participação (%) de um valor sobre o total do escopo filtrado — null
 * quando o total e' 0 (nunca divide por zero, nunca mostra 0% enganoso). */
export function fmtShareOfTotalPct(value: number, total: number | null): number | null {
  // T-0111: total nulo = escopo sem linha na fonte; sem base, sem participacao.
  if (total == null || total <= 0) return null;
  return Math.round((value / total) * 1000) / 10;
}
