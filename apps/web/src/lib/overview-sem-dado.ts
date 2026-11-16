/**
 * T-0111 — "sem dado != 0" nos totais de `/performance/overview`.
 *
 * Regra: sem linha na fonte, o total e' AUSENTE (null), nunca 0. Zero so' quando
 * a fonte tem linha com 0. Usado pela web (`fetchOverview`) e pelo MCP
 * (`torre_desempenho_marketplaces`), para que os dois leiam a resposta igual.
 *
 * Duas formas da API convivem:
 *   - nova: `gmv`/`orders`/`avg_ticket` (e o `previous`) vem `null` sem linha;
 *   - antiga: vem `0`, com `refreshed_at: null` (o `_max_refreshed_at` so' existe
 *     com linha no recorte). `gmv 0` + `orders 0` + `refreshed_at null` e' a
 *     assinatura da ausencia na resposta antiga.
 *
 * O periodo anterior nao tem `refreshed_at` proprio: na resposta antiga,
 * `gmv 0` + `orders 0` la' e' tratado como ausencia. Um anterior com linha e
 * GMV exatamente 0 nao tem variacao definida de qualquer jeito (divisao por 0).
 *
 * Logica PURA, sem import: testada no `node --test`.
 */

export const SEM_DADO_NO_RECORTE = "Sem dado no recorte";
export const SEM_DADO_NO_RECORTE_DICA =
  "Nenhuma linha na fonte para os canais, marcas e período filtrados: ausência de dado, não zero.";

export interface TotaisBrutos {
  gmv?: number | null;
  orders?: number | null;
  avg_ticket?: number | null;
}

export interface TotaisOverview {
  gmv: number | null;
  orders: number | null;
  avg_ticket: number | null;
  prev_gmv: number | null;
  prev_orders: number | null;
  prev_avg_ticket: number | null;
  gmv_mom_pct: number | null;
  /** O recorte atual nao tem linha na fonte. */
  sem_dado: boolean;
  /** O periodo anterior nao tem linha na fonte (ou nao foi pedido). */
  anterior_sem_dado: boolean;
}

const finito = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** O recorte atual nao tem linha: `gmv` nulo (API nova) ou 0/0 sem `refreshed_at` (API antiga). */
export function correnteSemLinha(cur: TotaisBrutos | null | undefined, refreshedAt: string | null | undefined): boolean {
  if (!cur) return true;
  const gmv = finito(cur.gmv);
  if (gmv == null) return true;
  return gmv === 0 && (finito(cur.orders) ?? 0) === 0 && !refreshedAt;
}

/** O periodo anterior nao tem linha: ausente, `gmv` nulo, ou 0/0 (resposta antiga). */
export function anteriorSemLinha(prev: TotaisBrutos | null | undefined): boolean {
  if (!prev) return true;
  const gmv = finito(prev.gmv);
  if (gmv == null) return true;
  return gmv === 0 && (finito(prev.orders) ?? 0) === 0;
}

/** Normaliza os totais do overview (nova ou antiga): ausencia vira `null`, inclusive a variacao. */
export function totaisDoOverview(
  cur: TotaisBrutos | null | undefined,
  prev: TotaisBrutos | null | undefined,
  momPct: number | null | undefined,
  refreshedAt: string | null | undefined,
): TotaisOverview {
  const semDado = correnteSemLinha(cur, refreshedAt);
  const anteriorSemDado = anteriorSemLinha(prev);
  return {
    gmv: semDado ? null : finito(cur?.gmv),
    orders: semDado ? null : finito(cur?.orders),
    avg_ticket: semDado ? null : finito(cur?.avg_ticket),
    prev_gmv: anteriorSemDado ? null : finito(prev?.gmv),
    prev_orders: anteriorSemDado ? null : finito(prev?.orders),
    prev_avg_ticket: anteriorSemDado ? null : finito(prev?.avg_ticket),
    // Sem um dos lados, nao ha variacao: a API antiga mandava -100% com o atual vazio.
    gmv_mom_pct: semDado || anteriorSemDado ? null : finito(momPct),
    sem_dado: semDado,
    anterior_sem_dado: anteriorSemDado,
  };
}
