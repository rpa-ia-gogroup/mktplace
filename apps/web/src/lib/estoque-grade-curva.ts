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
export const LINHAS_CURVA: { chave: LinhaCurva; rotulo: string }[] = [
  { chave: "aa_a", rotulo: "AA/A" },
  { chave: "b", rotulo: "B" },
  { chave: "c", rotulo: "C" },
  { chave: "sem", rotulo: "Sem curva" },
];

/** Curva da celula clicada: uma linha ou "todas" (a grade da tela junta as curvas escolhidas no filtro do topo). */
export type FiltroCurvaGrade = LinhaCurva | "todas";

export type ClasseGrade = "ruptura" | "baixo" | "excesso" | null;

export interface ItemGrade {
  brand: string;
  curva: Curva | null | undefined;
  /** null = sem leitura (ausencia). */
  disponivel: number | null;
  mediaDiaria: number | string | null | undefined;
  classe: ClasseGrade;
  /** "SKU · título" para a lista ao clicar na pilula. */
  rotulo?: string;
  /** Dias de cobertura da Torre (null = sem venda medida). */
  cobertura?: number | string | null;
}

export interface CelulaGrade {
  itens: number;
  disponivel: number | null;
  ruptura: number;
  baixo: number;
  excesso: number;
  /** Itens sem ruptura/baixo/excesso (suficiente, sem giro...): o resto da barra. */
  demais: number;
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
  demais: a.itens - a.ruptura - a.baixo - a.excesso,
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

/**
 * Itens de uma celula (pilula clicada): marca (ou TOTAL), linha de curva e
 * classe. Ruptura/baixo: menos cobertura primeiro; excesso: mais primeiro.
 */
export function itensDaCelula(
  itens: readonly ItemGrade[], marcas: readonly string[], marca: string, linha: FiltroCurvaGrade, classe: Exclude<ClasseGrade, null>,
): ItemGrade[] {
  const dias = (v: ItemGrade["cobertura"]) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n; };
  const sinal = classe === "excesso" ? -1 : 1;
  return itens
    .filter((i) => marcas.includes(i.brand) && (marca === TOTAL || i.brand === marca) && (linha === "todas" || linhaDaCurva(i.curva) === linha) && i.classe === classe)
    .sort((a, b) => {
      const da = dias(a.cobertura), db = dias(b.cobertura);
      return (da === null ? 1 : 0) - (db === null ? 1 : 0) || sinal * ((da ?? 0) - (db ?? 0));
    });
}

/**
 * Ordem das marcas na lista: quem mais precisa de acao primeiro (mais rupturas,
 * depois mais estoque baixo); marca sem itens por ultimo. Estavel: empate fica
 * na ordem recebida.
 */
export function ordenarPorAcao(marcas: readonly string[], celulas: Record<string, CelulaGrade>): string[] {
  return [...marcas].sort((a, b) => {
    const x = celulas[a], y = celulas[b];
    return (y.itens > 0 ? 1 : 0) - (x.itens > 0 ? 1 : 0) || y.ruptura - x.ruptura || y.baixo - x.baixo;
  });
}

/** Texto da barra (title e leitor de tela): so' o que existe, sem "0 em...". */
export function descreverPartes(c: Pick<CelulaGrade, "itens" | "ruptura" | "baixo" | "excesso" | "demais">): string {
  const n = (v: number, um: string, varios = um) => `${v.toLocaleString("pt-BR")} ${v === 1 ? um : varios}`;
  const partes = [
    c.ruptura > 0 && `${n(c.ruptura, "em ruptura")}`,
    c.baixo > 0 && `${n(c.baixo, "com estoque baixo")}`,
    c.excesso > 0 && `${n(c.excesso, "em excesso")}`,
    c.demais > 0 && `${n(c.demais, "demais")}`,
  ].filter(Boolean);
  return `${n(c.itens, "item", "itens")}: ${partes.join(", ")}`;
}

/** "38 d" / "—". Arredonda para dia inteiro. */
export function fmtPermanencia(dias: number | null): string {
  return dias === null ? "—" : `${Math.round(dias).toLocaleString("pt-BR")} d`;
}

export const AJUDA_GRADE =
  "Mesmo recorte dos cartões (brinde e descontinuado fora). A barra mostra os itens da marca: ruptura, estoque baixo, excesso e, em cinza, os demais (suficiente, sem giro). Quem mais precisa de ação vem primeiro; clique em ruptura, baixo ou excesso para ver os itens. A curva segue o filtro “Curva” do topo da aba (sem filtro, todas); os cartões do topo e a tabela seguem o mesmo filtro. Disponível em unidades; ruptura, estoque baixo e excesso em nº de itens. Permanência = quantos dias o estoque dura no ritmo de venda dos últimos 28 dias: soma do disponível ÷ soma da venda média diária, só dos itens com venda. “—” = sem dado, não zero. “Sem curva” não é C.";
