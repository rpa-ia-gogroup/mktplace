/**
 * A linha de tendencia de um cartao so' aparece quando a soma da serie confere
 * com o numero do cartao no mesmo recorte (0,5% de folga para arredondamento):
 * `/trend` e a fonte da aba sao consultas diferentes, e uma linha de outra
 * linhagem sob o numero seria tendencia inventada. Nao confere = sem linha.
 */
export function serieQueConfere(pontos: number[], total: number | null): number[] | null {
  if (total == null || total <= 0 || pontos.length < 4) return null;
  const soma = pontos.reduce((s, v) => s + v, 0);
  return Math.abs(soma - total) / total <= 0.005 ? pontos : null;
}
