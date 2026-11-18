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
  /** Pecas por dia em `dias` (60, ate' ontem), por canal+envio ("ML-F", "SP-N"...), kit aberto em pecas. */
  serie: Partial<Record<CanalSlow, number[]>>;
  receita_15d: Partial<Record<CanalSlow, number>>;
}

/** Canal + envio, igual ao dash da Nath: ML/SP/TT e F (Full) ou N (normal). */
export type CanalSlow = "ML-F" | "ML-N" | "SP-F" | "SP-N" | "TT-F" | "TT-N";
export type Marketplace = "ML" | "SP" | "TT";
export const MARKETPLACES: Marketplace[] = ["ML", "SP", "TT"];
/** Filtro de canal e de envio: grafico, faturamento e a venda por canal seguem. Cobertura e a lista sao do Supply. */
export type FiltroCanal = "todos" | Marketplace;
export type FiltroEnvio = "todos" | "F" | "N";
export const ROTULO_CANAL: Record<FiltroCanal, string> = { todos: "Todos", ML: "Mercado Livre", SP: "Shopee", TT: "TikTok Shop" };
export const ROTULO_ENVIO: Record<FiltroEnvio, string> = { todos: "Todos", F: "Full", N: "Normal" };
export type FiltroTendencia = "todos" | "melhorando" | "piorando";

export interface SlowMovingResponse {
  status: "ok";
  fonte: string;
  atualizado_em: string | null;
  meta_dias: number;
  dias: string[];
  vendas_disponivel: boolean;
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

export function canaisDo(f: FiltroCanal, e: FiltroEnvio = "todos"): CanalSlow[] {
  const mk = f === "todos" ? MARKETPLACES : [f];
  const en = e === "todos" ? ["F", "N"] : [e];
  return mk.flatMap((m) => en.map((x) => `${m}-${x}` as CanalSlow));
}

/** Pecas por dia somando os canais do filtro (zeros quando o SKU nao vendeu). */
export function serieDo(s: SkuSlowMoving, n: number, f: FiltroCanal = "todos", e: FiltroEnvio = "todos"): number[] {
  const out = new Array<number>(n).fill(0);
  for (const c of canaisDo(f, e)) (s.serie[c] ?? []).forEach((v, i) => { if (i < n) out[i] += v; });
  return out;
}

const soma = (a: number[]) => a.reduce((t, v) => t + v, 0);

/** Media/dia dos ultimos 15 dias, dos 15 anteriores e a variacao (%). `null` = sem base para comparar. */
export function ritmo(s: SkuSlowMoving, n: number, f: FiltroCanal = "todos", e: FiltroEnvio = "todos"): { m15: number; m15p: number; tendencia: number | null } {
  const v = serieDo(s, n, f, e);
  const m15 = soma(v.slice(-15)) / 15, m15p = soma(v.slice(-30, -15)) / 15;
  return { m15, m15p, tendencia: m15p > 0 ? (m15 / m15p - 1) * 100 : null };
}

/** O SKU vendeu algo no canal/envio escolhido na janela (60 dias)? Sem recorte, todos passam. */
export function vendeNoCanal(s: SkuSlowMoving, n: number, f: FiltroCanal, e: FiltroEnvio): boolean {
  return (f === "todos" && e === "todos") || soma(serieDo(s, n, f, e)) > 0;
}

export function passaTendencia(s: SkuSlowMoving, n: number, f: FiltroTendencia, c: FiltroCanal = "todos", e: FiltroEnvio = "todos"): boolean {
  if (f === "todos") return true;
  const t = ritmo(s, n, c, e).tendencia;
  return t != null && (f === "melhorando" ? t > 0 : t < 0);
}

/** Pecas por dia da lista (grafico), uma serie por marketplace dentro do filtro de canal e envio. */
export function seriesPorMarketplace(skus: readonly SkuSlowMoving[], n: number, f: FiltroCanal, e: FiltroEnvio): Record<Marketplace, number[]> {
  const out = { ML: new Array<number>(n).fill(0), SP: new Array<number>(n).fill(0), TT: new Array<number>(n).fill(0) };
  for (const m of MARKETPLACES) {
    if (f !== "todos" && f !== m) continue;
    for (const s of skus) serieDo(s, n, m, e).forEach((v, i) => { out[m][i] += v; });
  }
  return out;
}

/** Media movel de 7 dias (menos dias no comeco da serie). */
export function mediaMovel7(v: number[]): number[] {
  return v.map((_, i) => soma(v.slice(Math.max(0, i - 6), i + 1)) / Math.min(7, i + 1));
}

export function faturamento15d(skus: readonly SkuSlowMoving[], f: FiltroCanal = "todos", e: FiltroEnvio = "todos"): number {
  return skus.reduce((t, s) => t + canaisDo(f, e).reduce((u, c) => u + (s.receita_15d[c] ?? 0), 0), 0);
}

/** Pecas dos ultimos 15 dias por marketplace (ficha do produto). */
export function pecas15dPorMarketplace(s: SkuSlowMoving, n: number): Record<Marketplace, number> {
  const t = (m: Marketplace) => soma(serieDo(s, n, m).slice(-15));
  return { ML: t("ML"), SP: t("SP"), TT: t("TT") };
}

/** Tendencia da lista: Σ media 15d ÷ Σ media 15d anteriores. */
export function tendenciaDaLista(skus: readonly SkuSlowMoving[], n: number, f: FiltroCanal = "todos", e: FiltroEnvio = "todos"): number | null {
  let a = 0, b = 0;
  for (const s of skus) { const r = ritmo(s, n, f, e); a += r.m15; b += r.m15p; }
  return b > 0 ? (a / b - 1) * 100 : null;
}

export const COLUNAS_EXPORT = [
  "Marca", "SKU", "Produto", "Categoria", "Curva", "Status", "Estoque Marketplace (pç)", "Custo unit. (R$)",
  "Capital parado (R$)", "Média/dia 15d (pç)", "Média/dia 15d anteriores (pç)", "Tendência (%)",
  "Cobertura (dias)", "Precisa vender/dia (pç)", "Faturamento 15d (R$)",
];

const r1 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

export function linhaExport(s: SkuSlowMoving, n: number, meta: number, marca: string): Record<string, string | number | null> {
  const r = ritmo(s, n);
  return {
    "Marca": marca, "SKU": s.sku, "Produto": s.descricao, "Categoria": s.categoria, "Curva": s.curva, "Status": s.status,
    "Estoque Marketplace (pç)": s.estoque, "Custo unit. (R$)": s.custo_unitario, "Capital parado (R$)": Math.round(s.valor_parado * 100) / 100,
    "Média/dia 15d (pç)": r1(s.venda_dia), "Média/dia 15d anteriores (pç)": r1(r.m15p), "Tendência (%)": r1(r.tendencia),
    "Cobertura (dias)": s.cobertura_dias == null ? "sem venda" : Math.round(s.cobertura_dias),
    "Precisa vender/dia (pç)": s.estoque == null ? null : r1(s.estoque / meta),
    "Faturamento 15d (R$)": Math.round(faturamento15d([s]) * 100) / 100,
  };
}
