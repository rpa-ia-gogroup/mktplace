/**
 * SLOW-MOVING-1 — aba "Slow Moving" do /full: SKUs parados no Marketplace pela
 * regra do Supply (Painel S&OE). A API so' le' o Supply Intelligence; aqui ficam
 * o contrato, os totais e os filtros da tela.
 */
import { torreFetch } from "./torre-fetch.ts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function fetchSlowMoving(signal?: AbortSignal): Promise<SlowMovingResponse> {
  const res = await torreFetch(`${API_URL}/api/v1/performance/full-slow-moving`, { signal });
  if (!res.ok) throw new Error("A base do Supply está indisponível no momento.");
  return (await res.json()) as SlowMovingResponse;
}

export interface SkuSlowMoving {
  marca: string;
  sku: string;
  descricao: string;
  categoria: string | null;
  curva: string | null;
  status: string | null;
  estoque: number | null;
  custo_unitario: number | null;
  valor_parado: number;
  venda_dia: number;
  cobertura_dias: number | null;
}

export interface SlowMovingResponse {
  status: "ok";
  fonte: string;
  atualizado_em: string | null;
  meta_dias: number;
  skus: SkuSlowMoving[];
}

export interface TotaisSlow {
  skus: number;
  valor: number;
  estoque: number;
  vendaDia: number;
  /** Σ estoque ÷ Σ venda/dia (so' SKUs com estoque conhecido). */
  cobertura: number | null;
  /** Pecas/dia para chegar na meta: Σ estoque ÷ meta. */
  precisaDia: number;
}

export function totais(skus: readonly SkuSlowMoving[], meta: number): TotaisSlow {
  let valor = 0, estoque = 0, vendaDia = 0, vendaComEstoque = 0;
  for (const s of skus) {
    valor += s.valor_parado;
    vendaDia += s.venda_dia;
    if (s.estoque != null) { estoque += s.estoque; vendaComEstoque += s.venda_dia; }
  }
  return {
    skus: skus.length, valor, estoque, vendaDia,
    cobertura: vendaComEstoque > 0 ? estoque / vendaComEstoque : null,
    precisaDia: estoque / meta,
  };
}

/** Totais por marca, maior R$ parado primeiro. */
export function porMarca(skus: readonly SkuSlowMoving[], meta: number): { marca: string; t: TotaisSlow }[] {
  const g = new Map<string, SkuSlowMoving[]>();
  for (const s of skus) g.set(s.marca, [...(g.get(s.marca) ?? []), s]);
  return [...g].map(([marca, l]) => ({ marca, t: totais(l, meta) })).sort((a, b) => b.t.valor - a.t.valor);
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Marca escolhida (vazio = todas) e busca por SKU, nome ou categoria (todas as palavras). */
export function filtrar(skus: readonly SkuSlowMoving[], marcas: readonly string[], busca: string): SkuSlowMoving[] {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  return skus.filter((s) => {
    if (marcas.length && !marcas.includes(s.marca)) return false;
    if (!termos.length) return true;
    const alvo = semAcento(`${s.sku} ${s.descricao} ${s.categoria ?? ""}`);
    return termos.every((t) => alvo.includes(t));
  });
}
