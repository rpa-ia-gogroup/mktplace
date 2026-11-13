/**
 * T-0117 (C1-202) — frescor de Operacoes pela DATA do dado.
 *
 * `refreshed_at` e' a hora da carga ("Atualizado 10:17"): com a gold um dia
 * atras a tela parecia em dia. Aqui o texto sai de `dados_ate` (ultima data
 * com dado, por bloco) contra `esperado_ate` (D-1 operacional, decidido pela
 * API no fuso do negocio — a tela nao usa o proprio relogio).
 */

export interface EntradaFrescorDados {
  dados_ate?: { ml?: string | null; tiktok?: string | null } | null;
  esperado_ate?: string | null;
}

export interface FrescorDados {
  /** "Dados até 12/11" ou "Dados até 11/11 (TikTok) · 12/11 (ML)" (+ aviso). */
  texto: string;
  /** Algum bloco antes de `esperado_ate`, ou sem dado no escopo. */
  atrasado: boolean;
  /** Dica com o esperado. */
  detalhe: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' -> 'DD/MM'; outra coisa -> null. */
export function ddmm(iso: string | null | undefined): string | null {
  const m = typeof iso === "string" ? ISO.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}` : null;
}

/** `null` com API anterior (sem `dados_ate`): nada e' inventado. */
export function frescorDosDados(d: EntradaFrescorDados | null | undefined): FrescorDados | null {
  const blocos = d?.dados_ate;
  if (!blocos) return null;
  const esperado = typeof d?.esperado_ate === "string" && ISO.test(d.esperado_ate) ? d.esperado_ate : null;
  const ml = typeof blocos.ml === "string" && ISO.test(blocos.ml) ? blocos.ml : null;
  const tk = typeof blocos.tiktok === "string" && ISO.test(blocos.tiktok) ? blocos.tiktok : null;
  if (ml === null && tk === null) {
    return { texto: "Sem dado no período", atrasado: true, detalhe: "Nenhuma fonte desta tela tem linha no período." };
  }
  // ISO compara como texto.
  const atrasadoBloco = (x: string | null) => x === null || (esperado !== null && x < esperado);
  const atrasado = atrasadoBloco(ml) || atrasadoBloco(tk);
  const base =
    ml === tk
      ? `Dados até ${ddmm(ml)}`
      : `Dados até ${ddmm(tk) ?? "—"} (TikTok) · ${ddmm(ml) ?? "—"} (ML)`;
  const esperadoTxt = ddmm(esperado);
  return {
    texto: atrasado && esperadoTxt ? `${base} · atrasado (esperado ${esperadoTxt})` : base,
    atrasado,
    detalhe: esperadoTxt
      ? `Última data com dado por fonte; o esperado é até ontem (${esperadoTxt}).`
      : "Última data com dado por fonte.",
  };
}
