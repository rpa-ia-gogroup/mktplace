// T-0077 — rótulo "em maturação" do GMV Mercado Livre (docs/ml_gmv_maturacao.md).
//
// O GMV ML de um dia ainda pode CAIR até ~D+35: pedidos pagos são cancelados
// (ou reembolsados em parte) depois. A API marca cada dia com `ml_em_maturacao`
// (janela de 35 dias). Este helper só decide o RÓTULO — nenhum número muda.
// Mesmo desenho do `tiktok-maturacao.ts` (T-0074).
//
// A regra vem da API, não daqui: sem o campo (API anterior à T-0077) o rótulo
// não aparece, em vez de recalcular a janela no navegador.

/** Texto do "ⓘ" ao lado do rótulo. */
export const ML_MATURACAO_DICA =
  "Pedidos do Mercado Livre ainda podem ser cancelados ou reembolsados até ~35 dias " +
  "depois da compra; o GMV desses dias pode cair. A Torre considera o dia fechado após 35 dias.";

/** Linha mínima que o helper lê (subconjunto de `/performance/daily`). */
export interface LinhaMaturacaoMl {
  date: string; // "2026-10-05"
  ml_em_maturacao?: boolean | null;
}

export interface RotuloMaturacaoMl {
  /** Primeiro dia do intervalo em maturação ("YYYY-MM-DD"). */
  desde: string;
  /** Quantos dias do intervalo estão em maturação. */
  dias: number;
  /** Texto curto do rótulo. */
  texto: string;
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Rótulo para o intervalo exibido, ou `null` quando não há o que rotular:
 * nenhum dia em maturação, ML fora do escopo (campo `null`) ou API antiga
 * (campo ausente).
 */
export function mlMaturacaoRotulo(linhas: readonly LinhaMaturacaoMl[]): RotuloMaturacaoMl | null {
  const emMaturacao = linhas
    .filter((l) => l.ml_em_maturacao === true)
    .map((l) => l.date)
    .sort();
  if (emMaturacao.length === 0) return null;
  const desde = emMaturacao[0];
  return {
    desde,
    dias: emMaturacao.length,
    texto: `Mercado Livre em maturação desde ${ddmm(desde)}`,
  };
}
