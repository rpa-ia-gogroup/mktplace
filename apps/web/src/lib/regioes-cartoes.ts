/**
 * Regioes — o detalhe "por UF" e "por marca" dos cartoes de GMV e de Pedidos.
 * Logica PURA (testada): as linhas saem das MESMAS listas ja' carregadas pela
 * pagina (`by_uf`, `by_brand`), entao o detalhe nunca contradiz o ranking nem o
 * mapa. Nada novo e' buscado.
 *
 * A fonte regional so' cobre alguns canais (ver `regioes-scope.ts`): estes numeros
 * NAO sao comparaveis ao GMV total da Gerencial, e o detalhe herda essa ressalva no
 * ⓘ da pagina. Percentual ANTES do absoluto ("12,3% · R$ 1,2 mi"). Sem valor:
 * "Sem dado", nunca zero.
 */
import type { CoverageLevel, RegiaoBrandRow, RegiaoUfRow } from "./api-client.ts";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "./formatters.ts";

export type ChaveRegioes = "gmv" | "pedidos";

const NUM = new Intl.NumberFormat("pt-BR");
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Valor EXATO para o topo do detalhe ("R$ 13.110.234", "140.412"); o cartao mostra o curto. */
export function valorExato(
  chave: ChaveRegioes,
  r: { gmv: number | null; orders: number | null } | null | undefined,
): string | null {
  if (r == null) return null;
  // T-0111: total nulo = sem linha na fonte; o detalhe mostra ausencia, nunca "R$ 0".
  const v = chave === "gmv" ? r.gmv : r.orders;
  if (v == null) return null;
  return chave === "gmv" ? BRL0.format(v) : NUM.format(v);
}

export const TITULO_DETALHE: Record<ChaveRegioes, string> = {
  gmv: "GMV com cobertura regional",
  pedidos: "Pedidos",
};

/** Cobertura de UF: a regra de severidade que ja' existia (ok / parcial / baixa). */
export function tomDaCobertura(nivel: CoverageLevel | null | undefined): "ausente" | "bom" | "atencao" | "critico" {
  if (nivel === "ok") return "bom";
  if (nivel === "partial") return "atencao";
  if (nivel === "low") return "critico";
  return "ausente";
}

/** Codigo "XX" e' o pedido sem UF conhecida: nunca some nem vira uma UF. */
export const ROTULO_UF = (uf: string) => (uf === "XX" ? "UF não informada" : uf);

export interface LinhaRegiao {
  chave: string;
  label: string;
  /** "12,3% · R$ 1,2 mi"; "Sem dado" quando ausente. */
  valor: string;
  ausente: boolean;
  /** 0–100 para a barra: a participacao no total; `null` sem dado. */
  pct: number | null;
}

type Linha = { gmv: number | null | undefined; orders: number | null | undefined };

function montar(chave: ChaveRegioes, rotulo: string, id: string, l: Linha, total: number): LinhaRegiao {
  const v = chave === "gmv" ? l.gmv : l.orders;
  if (v == null) return { chave: id, label: rotulo, valor: "Sem dado", ausente: true, pct: null };
  const abs = chave === "gmv" ? fmtBrlCurto(v) : fmtNumCurto(v);
  const pct = total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : null;
  return { chave: id, label: rotulo, valor: pct != null ? `${fmtPctSimples(pct)} · ${abs}` : abs, ausente: false, pct };
}

/** As UFs com venda, da maior para a menor, ate' `limite`. `total` = o total regional do cartao. */
export function linhasPorUf(chave: ChaveRegioes, ufs: RegiaoUfRow[], total: number, limite = 10): LinhaRegiao[] {
  const v = (r: RegiaoUfRow) => (chave === "gmv" ? r.gmv : r.orders);
  return [...ufs]
    .filter((r) => v(r) > 0)
    .sort((a, b) => v(b) - v(a))
    .slice(0, limite)
    .map((r) => montar(chave, ROTULO_UF(r.uf), r.uf, r, total));
}

/** Marca x canal (a fonte regional vem por marketplace), da maior para a menor. */
export function linhasPorMarca(chave: ChaveRegioes, marcas: RegiaoBrandRow[], total: number): LinhaRegiao[] {
  const v = (r: RegiaoBrandRow) => (chave === "gmv" ? r.gmv : r.orders);
  return [...marcas]
    .sort((a, b) => v(b) - v(a))
    .map((r) => montar(chave, `${r.label} · ${r.marketplace}`, `${r.brand}:${r.marketplace_id}`, r, total));
}

/** Quantas UFs com venda ficaram de fora do "top N" (para o titulo da secao nao mentir). */
export function ufsForaDoTop(ufs: RegiaoUfRow[], chave: ChaveRegioes, limite = 10): number {
  const n = ufs.filter((r) => (chave === "gmv" ? r.gmv : r.orders) > 0).length;
  return Math.max(0, n - limite);
}
