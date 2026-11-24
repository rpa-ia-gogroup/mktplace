/**
 * Visão geral do Full no modelo da Nath (24/11): veredito no topo, 4 KPIs com
 * meta, matriz "Onde dói" (marca x canal, R$/dia) e "Indo bem".
 *
 * Só dados que a API já devolve (impacto de ruptura, foto anterior, curva).
 * R$ de impacto NUNCA soma entre canais: o veredito fala de um canal (o ML,
 * ou a Shopee quando o ML está fora) e a matriz tem uma coluna por canal.
 */
import { doCanal, noCanal } from "./canal-preposicao.ts";
import {
  diaMes, fmtPct, fmtReais, impactosOk, marcaSemFoto, NOME_CANAL, perdaDestaque,
  type Canal, type CanalImpactoOk, type ImpactoRuptura,
} from "./full-visao-geral.ts";
import { tituloMarca } from "./ml-full-estoque.ts";

/** Metas do print da Nath. Menor é melhor nas três. */
export const META_FULL = { perdaDia: 2000, aaA: 0, ruptura: 0.05 } as const;

export function statusMeta(valor: number | null, meta: number): { texto: string; tom: "ok" | "crit" } | null {
  if (valor === null) return null;
  return valor <= meta ? { texto: "Na meta", tom: "ok" } : { texto: "Acima da meta", tom: "crit" };
}

export interface Comparacao { texto: string; tom: "ok" | "crit" | "neutro"; antes: number }

/** Perda do canal agora x foto anterior (mesma foto atual; senão `null`, nunca "igual"). */
export function compararPerda(canal: Canal, atual: ImpactoRuptura | null, comAnterior: ImpactoRuptura | null): Comparacao | null {
  const c = impactosOk(atual).find((x) => x.canal === canal);
  const d = impactosOk(comAnterior).find((x) => x.canal === canal);
  if (!c || !d?.anterior || d.ref_date !== c.ref_date) return null;
  const agora = perdaDestaque(canal, c), antes = perdaDestaque(canal, d.anterior);
  if (agora === null || antes === null) return null;
  const quando = `${diaMes(d.anterior.ref_date)} (${fmtReais(antes)}/dia)`;
  if (agora > antes) return { texto: `pior que em ${quando}`, tom: "crit", antes };
  if (agora < antes) return { texto: `melhor que em ${quando}`, tom: "ok", antes };
  return { texto: `igual a ${quando}`, tom: "neutro", antes };
}

/** "92% da perda está na Kokeshi": a marca que mais pesa no canal. `null` sem perda medida. */
export function concentracao(c: CanalImpactoOk): { marca: string; pct: number } | null {
  const total = perdaDestaque(c.canal, c);
  if (!total || total <= 0) return null;
  const top = c.marcas
    .map((m) => ({ marca: m.brand, v: perdaDestaque(c.canal, m) ?? 0 }))
    .sort((a, b) => b.v - a.v)[0];
  return top && top.v > 0 ? { marca: top.marca, pct: top.v / total } : null;
}

export interface Veredito {
  /** Maior perda entre os canais (cor do titulo); nunca a soma. */
  perda: number;
  titulo: string;
  /** A linha de baixo: concentração no canal que mais perde · AA/A zerados na Shopee. */
  linha: string;
  /** "vs" da foto anterior, um por canal medido. */
  comparacoes: { canal: Canal; cmp: Comparacao }[];
}

/**
 * "Perdendo R$ 3,4 mil/dia no ML e R$ 4,6 mil/dia na Shopee por ruptura no Full":
 * um valor por canal, lado a lado (R$ de impacto nunca soma entre canais).
 * `aaAShopee` = produtos AA/A zerados na Shopee.
 */
export function veredito(impacto: ImpactoRuptura | null, comAnterior: ImpactoRuptura | null, aaAShopee: number | null): Veredito | null {
  const medidos = impactosOk(impacto)
    .map((c) => ({ c, v: perdaDestaque(c.canal, c) }))
    .filter((x): x is { c: CanalImpactoOk; v: number } => x.v !== null);
  if (!medidos.length) return null;
  const perda = Math.max(...medidos.map((x) => x.v));
  const pior = medidos.find((x) => x.v === perda)!.c;
  const conc = concentracao(pior);
  const partes = [
    conc ? `${Math.round(conc.pct * 100)}% da perda ${doCanal(pior.canal, NOME_CANAL[pior.canal])} está na ${tituloMarca(conc.marca)}` : null,
    aaAShopee ? `${aaAShopee.toLocaleString("pt-BR")} ${aaAShopee === 1 ? "produto AA/A zerado" : "produtos AA/A zerados"} na Shopee` : null,
  ].filter(Boolean);
  const valores = medidos.map((x) => `${fmtReais(x.v)}/dia ${noCanal(x.c.canal, NOME_CANAL[x.c.canal])}`);
  return {
    perda,
    titulo: perda > 0
      ? `Perda potencial de ${valores.join(" e ")} por ruptura no Full`
      : `Sem perda por ruptura no Full ${medidos.length === 1 ? doCanal(pior.canal, NOME_CANAL[pior.canal]) : ""}`.trim(),
    linha: partes.join(" · "),
    comparacoes: medidos.flatMap((x) => {
      const cmp = compararPerda(x.c.canal, impacto, comAnterior);
      return cmp ? [{ canal: x.c.canal, cmp }] : [];
    }),
  };
}

export interface CelulaDoi {
  /** R$/dia medido (0 = sem perda medida); `null` = ausência, com o motivo. */
  valor: number | null;
  texto: string;
  motivo?: string;
}

export interface LinhaDoi { marca: string; celulas: Partial<Record<Canal, CelulaDoi>>; maior: number }

/** Matriz "Onde dói": marca x canal em R$/dia (destaque do canal). Maior perda primeiro. */
export function matrizOndeDoi(impacto: ImpactoRuptura | null): { canais: Canal[]; linhas: LinhaDoi[]; max: number } | null {
  const oks = impactosOk(impacto);
  if (!oks.length) return null;
  const linhas = new Map<string, LinhaDoi>();
  for (const c of oks) {
    for (const m of c.marcas) {
      const l = linhas.get(m.brand) ?? { marca: m.brand, celulas: {}, maior: 0 };
      const v = perdaDestaque(c.canal, m);
      l.celulas[c.canal] = marcaSemFoto(m) ? { valor: null, texto: "sem foto", motivo: "sem fotografia no dia" }
        : v === null ? { valor: null, texto: "—", motivo: "sem preço" }
        : v === 0 && c.canal === "shopee" && (m.perda_dia ?? 0) > 0 ? { valor: 0, texto: "sem perda", motivo: "o vendedor tem estoque: a venda segue fora do Full" }
        : { valor: v, texto: v === 0 ? "R$ 0" : fmtReais(v) };
      l.maior = Math.max(l.maior, l.celulas[c.canal]!.valor ?? 0);
      linhas.set(m.brand, l);
    }
  }
  const lista = [...linhas.values()].sort((a, b) => b.maior - a.maior || a.marca.localeCompare(b.marca));
  return { canais: oks.map((c) => c.canal), linhas: lista, max: Math.max(0, ...lista.map((l) => l.maior)) };
}

/** Intensidade da célula (0..1) pelo dinheiro: 0 sem perda; a maior perda da matriz = 1. */
export function intensidade(valor: number | null, max: number): number {
  if (!valor || valor <= 0 || max <= 0) return 0;
  return Math.min(1, valor / max);
}

/** "Indo bem": só o que foi medido e está bom. Vazio = nada a destacar. */
export function indoBem(o: {
  impacto: ImpactoRuptura | null; comAnterior: ImpactoRuptura | null;
  ruptura: number | null; aaA: number | null;
}): string[] {
  const out: string[] = [];
  if (o.ruptura !== null && o.ruptura <= META_FULL.ruptura) out.push(`Ruptura com demanda em ${fmtPct(o.ruptura)} (meta ≤ ${fmtPct(META_FULL.ruptura)})`);
  if (o.aaA === 0) out.push("Nenhum produto AA/A sem estoque no Full");
  for (const c of impactosOk(o.impacto)) {
    const cmp = compararPerda(c.canal, o.impacto, o.comAnterior);
    if (cmp?.tom === "ok") out.push(`${NOME_CANAL[c.canal]}: perda ${cmp.texto}`);
    const v = perdaDestaque(c.canal, c);
    if (c.canal === "ml" && v !== null && v <= META_FULL.perdaDia) out.push(`Venda perdida ${noCanal("ml", "ML")} dentro da meta (≤ ${fmtReais(META_FULL.perdaDia)}/dia)`);
  }
  const m = matrizOndeDoi(o.impacto);
  const semPerda = m?.linhas.filter((l) => {
    const cs = Object.values(l.celulas);
    // Ausencia nao vira "sem perda": a marca entra so' medida (e zerada) em todos os canais onde tem conta.
    return cs.length > 0 && cs.every((x) => x.valor === 0);
  }).map((l) => tituloMarca(l.marca)) ?? [];
  if (semPerda.length) out.push(`${semPerda.join(", ")}: sem perda por ruptura`);
  return out.slice(0, 4);
}
