/**
 * Metas — cartoes de totais no padrao da Gerencial. Logica PURA (testada): saem
 * dos `totais()` do MESMO rascunho que a grade usa, entao o cartao nunca
 * contradiz o rodape. Ausencia nunca vira zero: sem nenhuma meta, "—" e
 * "Sem meta definida" (campo vazio = sem meta, diferente de zero).
 */
import { fmtCompacto, type Totais } from "./metas.ts";
import { fmtPctSimples } from "./formatters.ts";

export type ChaveMeta = "global" | "tiktok" | "ml" | "shopee";

export interface CartaoMeta {
  chave: ChaveMeta;
  valor: string;
  /** `null` = sem meta (tom ausente). */
  ausente: boolean;
  /** "% da meta global" do canal; so' com base > 0. */
  comparacao: string | null;
}

export const SEM_META = "Sem meta definida";

export function cartoesMetas(t: Totais): CartaoMeta[] {
  const base = t.global != null && t.global > 0 ? t.global : null;
  const canal = (chave: Exclude<ChaveMeta, "global">): CartaoMeta => {
    const v = t.porCanal[chave];
    return {
      chave,
      valor: fmtCompacto(v),
      ausente: v == null,
      // Sem nenhuma meta no mes, o aviso fica so' no cartao global (a Note da pagina ja' diz o resto).
      comparacao: v == null ? (t.global == null ? null : SEM_META) : base != null ? `${fmtPctSimples((v / base) * 100)} da meta global` : null,
    };
  };
  return [
    { chave: "global", valor: fmtCompacto(t.global), ausente: t.global == null, comparacao: t.global == null ? SEM_META : null },
    canal("tiktok"),
    canal("ml"),
    canal("shopee"),
  ];
}
