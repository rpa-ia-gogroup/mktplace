// T-0074 — rótulo "em maturação" do GMV TikTok (docs/tiktok_gmv_maturacao.md).
//
// O GMV TikTok de um dia ainda pode CAIR até ~D+30: pedidos pagos são
// cancelados depois. A API marca cada dia com `tiktok_em_maturacao` (janela de
// 35 dias). Este helper só decide o RÓTULO — nenhum número muda.
//
// A regra vem da API, não daqui: sem o campo (API anterior à T-0074) o rótulo
// não aparece, em vez de recalcular a janela no navegador.

/** Texto do "ⓘ" ao lado do rótulo. */
export const TIKTOK_MATURACAO_DICA =
  "Pedidos do TikTok ainda podem ser cancelados até ~30 dias depois da compra; " +
  "o GMV desses dias pode cair. A Torre considera o dia fechado após 35 dias.";

/** Linha mínima que o helper lê (subconjunto de `/performance/daily`). */
export interface LinhaMaturacao {
  date: string; // "2026-10-05"
  tiktok_em_maturacao?: boolean | null;
}

export interface RotuloMaturacao {
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
 * nenhum dia em maturação, TikTok fora do escopo (campo `null`) ou API antiga
 * (campo ausente).
 */
export function tiktokMaturacaoRotulo(linhas: readonly LinhaMaturacao[]): RotuloMaturacao | null {
  const emMaturacao = linhas
    .filter((l) => l.tiktok_em_maturacao === true)
    .map((l) => l.date)
    .sort();
  if (emMaturacao.length === 0) return null;
  const desde = emMaturacao[0];
  return {
    desde,
    dias: emMaturacao.length,
    texto: `TikTok em maturação desde ${ddmm(desde)}`,
  };
}
