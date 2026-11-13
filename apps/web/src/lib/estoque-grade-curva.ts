/**
 * GRADE-CURVA (pedido da Nathalia, 13/11/2026): curva ABC nas linhas x marcas
 * nas colunas, nas abas Estoque ML e Estoque Shopee. Cada celula: Disponivel
 * Full, Ruptura, Estoque baixo, Excesso e Permanencia.
 *
 * So' reagrupa o que a API ja' manda por item; nao reclassifica nada.
 * - Recorte = o dos cards: brinde/descontinuado (`situacao`) ficam fora.
 * - Permanencia = dias que o estoque dura no ritmo de venda: soma do
 *   disponivel / soma da venda media diaria, so' dos itens com venda (media
 *   ponderada, nunca media de medias). Sem venda no grupo = null ("—").
 * - Disponivel sem leitura (null) nao entra na soma; grupo sem nenhuma
 *   leitura = null. Ausencia nunca vira zero.
 * - "Sem curva" e' linha propria: nunca vira C.
 */
import type { Curva } from "./full-visao-geral.ts";

export type LinhaCurva = "aa_a" | "b" | "c" | "sem";
export const LINHAS_CURVA: { chave: LinhaCurva; rotulo: string; aberta: boolean }[] = [
  { chave: "aa_a", rotulo: "AA/A", aberta: true },
  { chave: "b", rotulo: "B", aberta: false },
  { chave: "c", rotulo: "C", aberta: false },
  { chave: "sem", rotulo: "Sem curva", aberta: false },
];

export type ClasseGrade = "ruptura" | "baixo" | "excesso" | null;

export interface ItemGrade {
  brand: string;
  curva: Curva | null | undefined;
  /** null = sem leitura (ausencia). */
  disponivel: number | null;
  mediaDiaria: number | string | null | undefined;
  classe: ClasseGrade;
}

export interface CelulaGrade {
  itens: number;
  disponivel: number | null;
  ruptura: number;
  baixo: number;
  excesso: number;
  permanencia: number | null;
}

export const TOTAL = "__total__";

export interface Grade {
  /** [linha][marca | TOTAL] */
  celulas: Record<LinhaCurva, Record<string, CelulaGrade>>;
  /** Linha "Total marca" (todas as curvas). */
  totalMarca: Record<string, CelulaGrade>;
}

export function linhaDaCurva(c: Curva | null | undefined): LinhaCurva {
  return c == null ? "sem" : c === "AA" || c === "A" ? "aa_a" : c === "B" ? "b" : "c";
}

interface Acumulador { itens: number; disp: number; lidos: number; dispComVenda: number; venda: number; ruptura: number; baixo: number; excesso: number }
const novo = (): Acumulador => ({ itens: 0, disp: 0, lidos: 0, dispComVenda: 0, venda: 0, ruptura: 0, baixo: 0, excesso: 0 });

function somar(a: Acumulador, i: ItemGrade, media: number) {
  a.itens++;
  if (i.disponivel !== null) {
    a.disp += i.disponivel;
    a.lidos++;
    if (media > 0) { a.dispComVenda += i.disponivel; a.venda += media; }
  }
  if (i.classe) a[i.classe]++;
}

const fechar = (a: Acumulador): CelulaGrade => ({
  itens: a.itens,
  disponivel: a.lidos > 0 ? a.disp : null,
  ruptura: a.ruptura,
  baixo: a.baixo,
  excesso: a.excesso,
  permanencia: a.venda > 0 ? a.dispComVenda / a.venda : null,
});

export function montarGrade(itens: readonly ItemGrade[], marcas: readonly string[]): Grade {
  const chaves = [...marcas, TOTAL];
  const acc = Object.fromEntries(
    [...LINHAS_CURVA.map((l) => l.chave), "total"].map((l) => [l, Object.fromEntries(chaves.map((m) => [m, novo()]))]),
  ) as Record<LinhaCurva | "total", Record<string, Acumulador>>;
  for (const i of itens) {
    if (!marcas.includes(i.brand)) continue;
    const n = Number(i.mediaDiaria);
    const media = Number.isFinite(n) ? n : 0;
    const linha = linhaDaCurva(i.curva);
    for (const l of [linha, "total"] as const) {
      somar(acc[l][i.brand], i, media);
      somar(acc[l][TOTAL], i, media);
    }
  }
  const fecharLinha = (l: LinhaCurva | "total") => Object.fromEntries(chaves.map((m) => [m, fechar(acc[l][m])]));
  return {
    celulas: Object.fromEntries(LINHAS_CURVA.map((l) => [l.chave, fecharLinha(l.chave)])) as Grade["celulas"],
    totalMarca: fecharLinha("total"),
  };
}

/** "38 d" / "—". Arredonda para dia inteiro. */
export function fmtPermanencia(dias: number | null): string {
  return dias === null ? "—" : `${Math.round(dias).toLocaleString("pt-BR")} d`;
}

export const AJUDA_GRADE =
  "Mesmo recorte dos cartões (brinde e descontinuado fora). Permanência = quantos dias o estoque dura no ritmo de venda dos últimos 28 dias: soma do disponível ÷ soma da venda média diária, só dos itens com venda. “—” = sem dado, não zero. “Sem curva” não é C.";
