/**
 * T-0097 — rótulo de frescor de Operações e Marca 360.
 *
 * `refreshed_at` vem da API como o instante da última carga das fontes da tela
 * (o mais antigo entre elas). Ausente, nulo ou ilegível vira "frescor
 * indisponível": a tela nunca inventa um horário nem usa a última data da
 * série, que no dia corrente é parcial.
 */
import { fmtRefreshedAt } from "./filters/format.ts";

export const FRESCOR_INDISPONIVEL = "frescor indisponível";

/** Payload com o campo aditivo `refreshed_at` (os tipos do api-client não o têm). */
export type ComFrescor<T> = T & { refreshed_at?: string | null };

export function rotuloFrescor(refreshedAt: string | null | undefined): string {
  if (!refreshedAt || Number.isNaN(Date.parse(refreshedAt))) return FRESCOR_INDISPONIVEL;
  const quando = fmtRefreshedAt(refreshedAt);
  return quando ? `Atualizado em ${quando}` : FRESCOR_INDISPONIVEL;
}
