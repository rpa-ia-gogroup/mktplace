// T-0115b — COS (custo sobre GMV) do TikTok na Marca 360 com o repasse em
// maturação. A regra vem da API (`tiktok_repasse_status`, mesma da T-0115 no
// Financeiro): com o repasse abaixo de 30% do GMV o `cos_pct` chega null.
// Este helper só decide o TEXTO do cartão — nenhum número é recalculado aqui.

export type TiktokRepasseStatus = "maduro" | "maturando" | "sem_dado";

/** Texto do "ⓘ" ao lado do selo. */
export const COS_MATURANDO_DICA =
  "O repasse do TikTok chega semanas depois do pedido. Com o repasse abaixo de 30% do GMV " +
  "da competência, a taxa ainda não é real: o COS fica sem valor (nunca 0,0%) até consolidar.";

export interface CosCartao {
  /** Valor do cartão: o % formatado, "—" (maturando) ou "Sem dado". */
  valor: string;
  /** Selo ao lado do valor; só existe com o repasse maturando. */
  selo: "maturando" | null;
}

export function cosCartao(
  cosPct: number | null | undefined,
  status: TiktokRepasseStatus | null | undefined,
  formatar: (v: number) => string,
): CosCartao {
  if (cosPct != null) return { valor: formatar(cosPct), selo: null };
  if (status === "maturando") return { valor: "—", selo: "maturando" };
  return { valor: "Sem dado", selo: null };
}
