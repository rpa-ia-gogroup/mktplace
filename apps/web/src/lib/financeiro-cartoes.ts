/**
 * Financeiro — o valor EXATO do topo do detalhe de um cartao de GMV por canal.
 * Logica PURA (testada). O cartao mostra o curto ("R$ 3,92 mi"); o detalhe, o exato
 * em pt-BR ("R$ 3.920.000"). Sem GMV no periodo: `null` (nunca "R$ 0").
 */
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function gmvExato(gmv: number | null): string | null {
  return gmv == null ? null : BRL0.format(gmv);
}
