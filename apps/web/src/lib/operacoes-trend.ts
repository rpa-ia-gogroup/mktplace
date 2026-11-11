/**
 * Operacoes — trend diario do TikTok (GMV por marca). Logica PURA (testada).
 *
 * C1-02 (QA 2026-11-11): o eixo ordenava o rotulo "dd/mm" com `localeCompare`,
 * entao "01/11" vinha antes de "28/10". Aqui a ordem e' a da data real (ISO
 * YYYY-MM-DD, que ordena como texto); o rotulo so' e' formatado no fim.
 */
import type { TkDailyRow } from "./api-client.ts";

/** "2026-11-01" -> "01/11"; fora do formato ISO devolve o valor como veio. */
export function formatDateLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

/** Pivot data -> { marca: gmv }, em ordem cronologica. */
export function buildChartData(rows: TkDailyRow[]): Record<string, number | string>[] {
  const byDate: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!byDate[r.ref_date]) byDate[r.ref_date] = {};
    byDate[r.ref_date][r.brand] = (byDate[r.ref_date][r.brand] ?? 0) + r.gmv;
  }
  return Object.keys(byDate)
    .sort()
    .map((iso) => ({ date: formatDateLabel(iso), ...byDate[iso] }));
}
