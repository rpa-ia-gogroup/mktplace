/**
 * CURVA-ABC nas abas Estoque Shopee e Estoque ML (PR4, spec do Prumo).
 *
 * A API (#302) anota cada item com `curva` (AA/A/B/C ou null) e `curva_motivo`
 * (kit, sem_ponte, marca_fora ou null) e a raiz com `curva_meta`. Aqui fica a
 * regra das duas abas: filtro, ordem por grupos (a mesma do /full, #301),
 * resumo de "exigem ação" e os avisos. "Sem curva" nunca vira C nem 0.
 */
import { grupoDe, type Curva, type GrupoCurva } from "./full-visao-geral.ts";

export type { Curva } from "./full-visao-geral.ts";
export type CurvaMotivo = "kit" | "sem_ponte" | "marca_fora";

export interface CurvaMeta {
  disponivel: boolean;
  motivo: string | null;
  lida_em: string | null;
  itens_com_curva: number;
  itens_total: number;
}

export interface ItemComCurva {
  curva?: Curva | null;
  curva_motivo?: CurvaMotivo | null;
}

/** Chips do filtro (vazio = todas). */
export type OpcaoCurva = "aa_a" | "b" | "c" | "sem";
export const OPCOES_CURVA: { valor: OpcaoCurva; texto: string }[] = [
  { valor: "aa_a", texto: "AA/A" },
  { valor: "b", texto: "B" },
  { valor: "c", texto: "C" },
  { valor: "sem", texto: "Sem curva" },
];

export function passaCurva(c: Curva | null | undefined, filtro: readonly OpcaoCurva[]): boolean {
  if (!filtro.length) return true;
  const op: OpcaoCurva = c == null ? "sem" : c === "AA" || c === "A" ? "aa_a" : c === "B" ? "b" : "c";
  return filtro.includes(op);
}

/** A coluna e o filtro so' existem com a curva lida. `null` = API sem a anotacao. */
export const curvaNaTela = (meta: CurvaMeta | null | undefined): meta is CurvaMeta => !!meta?.disponivel;

/** Linha de aviso quando a planilha nao foi lida (coluna e filtro somem). */
export function avisoCurvaIndisponivel(meta: CurvaMeta | null | undefined): string | null {
  if (!meta || meta.disponivel) return null;
  return `Curva indisponível agora: ${meta.motivo?.trim() || "a planilha de curva não foi lida"}.`;
}

/** ML: a curva cobre poucos inventarios; "sem curva" nao e' C. */
export function avisoCoberturaCurva(meta: CurvaMeta | null | undefined): string | null {
  if (!curvaNaTela(meta) || meta.itens_total <= 0) return null;
  const pct = Math.round((meta.itens_com_curva / meta.itens_total) * 100);
  return `A curva cobre ~${pct}% dos itens: “sem curva” não é C.`;
}

const MOTIVO: Record<CurvaMotivo, string> = {
  kit: "kit não tem curva própria",
  sem_ponte: "código sem ponte com a planilha de curva",
  marca_fora: "marca fora da planilha de curva",
};
/** Por que o item esta sem curva (title + sr-only do chip). */
export function motivoSemCurva(m: CurvaMotivo | null | undefined): string {
  return m ? MOTIVO[m] : "fora da planilha de curva";
}

const ORDEM: Record<GrupoCurva, number> = { AA: 0, A: 1, demais: 2 };
const dias = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Ordem padrao: grupos AA -> A -> demais (B, C e sem curva juntos). Dentro do
 * grupo, menos dias de cobertura primeiro; sem cobertura no fim do grupo.
 * Empate: a ordem que a API mandou (urgencia).
 */
export function ordenarPorCurva<T extends ItemComCurva>(
  itens: readonly T[], cobertura: (t: T) => number | string | null | undefined,
  /** Cards (excesso, sem giro, unidades): maior primeiro; sem valor continua no fim. */
  desc = false,
): T[] {
  const sinal = desc ? -1 : 1;
  return itens
    .map((t, i) => ({ t, i, g: ORDEM[grupoDe(t.curva ?? null)], d: dias(cobertura(t)) }))
    .sort((a, b) =>
      a.g - b.g
      || (a.d === null ? 1 : 0) - (b.d === null ? 1 : 0)
      || sinal * ((a.d ?? 0) - (b.d ?? 0))
      || a.i - b.i)
    .map((x) => x.t);
}

/** "Exigem ação: 5 AA · 12 A · 67 demais" sobre o recorte do filtro. */
export function resumoAcao<T extends ItemComCurva>(itens: readonly T[], exige: (t: T) => boolean): string {
  const n: Record<GrupoCurva, number> = { AA: 0, A: 0, demais: 0 };
  for (const t of itens) if (exige(t)) n[grupoDe(t.curva ?? null)]++;
  const fmt = (v: number) => v.toLocaleString("pt-BR");
  return `Por curva: ${fmt(n.AA)} AA · ${fmt(n.A)} A · ${fmt(n.demais)} demais`;
}
