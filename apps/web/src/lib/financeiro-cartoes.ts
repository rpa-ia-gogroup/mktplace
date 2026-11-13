/**
 * Financeiro — o valor EXATO do topo do detalhe de um cartao de GMV por canal.
 * Logica PURA (testada). O cartao mostra o curto ("R$ 3,92 mi"); o detalhe, o exato
 * em pt-BR ("R$ 3.920.000"). Sem GMV no periodo: `null` (nunca "R$ 0").
 */
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function gmvExato(gmv: number | null): string | null {
  return gmv == null ? null : BRL0.format(gmv);
}

/**
 * A linha de tendencia do cartao so' aparece quando a soma da serie confere
 * com o numero do cartao no mesmo recorte (0,5% de folga para arredondamento):
 * `/trend` e `/financeiro` sao consultas diferentes, e uma linha de outra
 * linhagem sob o numero seria tendencia inventada. Nao confere = sem linha.
 */
export function serieQueConfere(pontos: number[], total: number | null): number[] | null {
  if (total == null || total <= 0 || pontos.length < 4) return null;
  const soma = pontos.reduce((s, v) => s + v, 0);
  return Math.abs(soma - total) / total <= 0.005 ? pontos : null;
}
