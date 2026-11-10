/**
 * ADAPTADOR dos produtos das marcas menores (Bling) para as props que a aba Produtos ja' usa
 * (tabelas TikTok/Shopee, cards Pareto A/B/C/D, contagem, exportacao): o layout e' o das outras
 * marcas, so' a fonte muda. Campo que o Bling nao tem fica VAZIO (null), nunca 0.
 *
 * O servidor ordena, pagina e calcula o Pareto no Data Mart; aqui, com o conjunto inteiro do Bling na
 * mao, a mesma regra roda no navegador: Pareto sobre produtos com GMV > 0, classificado pelo acumulado
 * ANTERIOR ao produto (< 50 A, < 80 B, < 95 C, resto D).
 */
import type {
  ParetoSummaryBucket,
  ProdutoShopeeRow,
  ProdutoTikTokRow,
  ProdutosChannelSummary,
  ProdutosShopeeListResponse,
  ProdutosTikTokResponse,
} from "./api-client.ts";
import { brandLabel } from "./filters/brands.ts";
import type { ProdutosMarcas } from "./marcas-menores.ts";

export type CanalProduto = "tiktok" | "shopee";
const PLATAFORMA: Record<CanalProduto, string> = { tiktok: "TIKTOK", shopee: "SHOPEE" };

export interface LinhaProduto {
  marca: string;
  sku: string;
  produto: string;
  receita: number;
  quantidade: number | null;
  pedidos: number | null;
  /** A/B/C/D por canal e marca; so' produto com receita > 0. */
  bucket: string | null;
}

const BUCKETS: [string, string, string][] = [
  ["A_top50", "A", "Top 50% GMV"],
  ["B_next30", "B", "Next 30%"],
  ["C_next15", "C", "Next 15%"],
  ["D_tail", "D", "Cauda"],
];

const bucketDoAcumulado = (anteriorPct: number) => (anteriorPct < 50 ? "A_top50" : anteriorPct < 80 ? "B_next30" : anteriorPct < 95 ? "C_next15" : "D_tail");

/**
 * Linhas do canal, com Pareto. `marcas` restringe (vazio = todas); o Pareto e' calculado dentro do conjunto
 * mostrado (uma marca, ou todas as menores juntas), como o servidor faz sobre o recorte do filtro.
 */
export function linhasDoCanal(r: ProdutosMarcas | null | undefined, canal: CanalProduto, marcas?: readonly string[]): LinhaProduto[] {
  if (!r?.disponivel) return [];
  const linhas: LinhaProduto[] = [];
  for (const m of r.marcas) {
    if (m.status === "aguardando_autorizacao" || (marcas && marcas.length && !marcas.includes(m.id))) continue;
    for (const p of m.itens_por_canal ?? []) {
      if (p.plataforma !== PLATAFORMA[canal]) continue;
      linhas.push({
        marca: m.id,
        sku: p.sku,
        produto: p.produto,
        receita: p.receita ?? 0,
        quantidade: p.quantidade,
        pedidos: p.pedidos ?? null,
        bucket: null,
      });
    }
  }
  const elegiveis = linhas.filter((l) => l.receita > 0).sort((a, b) => b.receita - a.receita || a.sku.localeCompare(b.sku));
  const total = elegiveis.reduce((a, l) => a + l.receita, 0);
  let acum = 0;
  for (const l of elegiveis) {
    l.bucket = bucketDoAcumulado((acum / total) * 100);
    acum += l.receita;
  }
  return linhas;
}

export interface Pagina<T> {
  total: number;
  itens: T[];
}

type Chave = (l: LinhaProduto) => string | number | null;

const CHAVES_TIKTOK: Record<string, Chave> = {
  gmv: (l) => l.receita,
  orders: (l) => l.pedidos,
  items_sold: (l) => l.quantidade,
  avg_price: (l) => precoMedio(l),
  product_name: (l) => l.produto.toLocaleLowerCase("pt-BR"),
};
const CHAVES_SHOPEE: Record<string, Chave> = {
  gmv: (l) => l.receita,
  units_sold: (l) => l.quantidade,
  orders: (l) => l.pedidos,
  avg_price: (l) => precoMedio(l),
  product_name: (l) => l.produto.toLocaleLowerCase("pt-BR"),
};

/** receita / quantidade; sem quantidade (ou 0 unidade), sem preco medio: null. */
export const precoMedio = (l: Pick<LinhaProduto, "receita" | "quantidade">): number | null =>
  l.quantidade != null && l.quantidade > 0 ? l.receita / l.quantidade : null;

function ordenarEPaginar(
  linhas: LinhaProduto[],
  chaves: Record<string, Chave>,
  opc: { sortColumn?: string | null; sortDirection?: "asc" | "desc" | null; bucket?: string | null; offset: number; limit: number },
): Pagina<LinhaProduto> {
  const col = opc.sortColumn && chaves[opc.sortColumn] ? opc.sortColumn : "gmv";
  const dir = opc.sortColumn && chaves[opc.sortColumn] ? (opc.sortDirection === "asc" ? 1 : -1) : -1;
  const chave = chaves[col];
  const filtradas = opc.bucket ? linhas.filter((l) => l.bucket === opc.bucket) : [...linhas];
  filtradas.sort((a, b) => {
    const x = chave(a);
    const y = chave(b);
    if (x == null && y == null) return a.sku.localeCompare(b.sku);
    if (x == null) return 1; // vazio sempre no fim, qualquer que seja a direcao
    if (y == null) return -1;
    const c = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y), "pt-BR") : x - y;
    return c * dir || a.sku.localeCompare(b.sku);
  });
  return { total: filtradas.length, itens: filtradas.slice(opc.offset, opc.offset + opc.limit) };
}

export interface OpcoesLista {
  refMonth: string;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc" | null;
  bucket?: string | null;
  offset: number;
  limit: number;
}

export function listaTikTok(linhas: LinhaProduto[], o: OpcoesLista): ProdutosTikTokResponse {
  const { total, itens } = ordenarEPaginar(linhas, CHAVES_TIKTOK, o);
  const items: ProdutoTikTokRow[] = itens.map((l) => ({
    brand: brandLabel(l.marca), // "AUÁ", "BY SAMIA" como no seletor (nao o slug)
    product_id: l.sku,
    product_name: l.produto,
    gmv: l.receita,
    // Sem o campo no Bling: vazio do componente (a tabela mostra "—"), nunca 0.
    orders: l.pedidos as number,
    items_sold: l.quantidade as number,
    avg_price: precoMedio(l),
    pct_gmv_video: null,
    pct_gmv_live: null,
    pct_gmv_card: null,
    problem_rate: null,
    rating_avg: null,
    total_ratings: null,
    pareto_bucket: l.bucket,
  }));
  return { ref_month: o.refMonth, total, limit: o.limit, offset: o.offset, items };
}

export function listaShopee(linhas: LinhaProduto[], o: OpcoesLista): ProdutosShopeeListResponse {
  const { total, itens } = ordenarEPaginar(linhas, CHAVES_SHOPEE, o);
  const items: ProdutoShopeeRow[] = itens.map((l) => ({
    brand: brandLabel(l.marca), // "AUÁ", "BY SAMIA" como no seletor (nao o slug)
    sku_ref: l.sku,
    product_name: l.produto,
    variation_name: null,
    gmv: l.receita,
    units_sold: l.quantidade as number,
    orders: l.pedidos as number,
    canceled_orders: null as unknown as number, // cancelados ficam fora da lista do Bling: nao ha contagem
    cancel_rate_pct: null,
    unique_buyers: null,
    avg_price: precoMedio(l),
    pareto_bucket: l.bucket,
  }));
  return { ref_month: o.refMonth, total, limit: o.limit, offset: o.offset, items };
}

/** Cards A/B/C/D no formato do resumo do servidor. Sem produto com receita, sem cards (nunca R$ 0). */
export function resumoDoCanal(linhas: LinhaProduto[], refMonth: string, marca: string | null): ProdutosChannelSummary {
  const elegiveis = linhas.filter((l) => l.receita > 0);
  const totalGmv = elegiveis.reduce((a, l) => a + l.receita, 0);
  const buckets: ParetoSummaryBucket[] = BUCKETS.map(([bucket, label, description]) => {
    const doBucket = elegiveis.filter((l) => l.bucket === bucket);
    const gmv = doBucket.reduce((a, l) => a + l.receita, 0);
    return { bucket, label, description, gmv, count: doBucket.length, gmv_pct: totalGmv > 0 ? Math.round((gmv / totalGmv) * 1000) / 10 : 0 };
  });
  // Preco medio ponderado: receita total / unidades totais, so' sobre produtos com quantidade conhecida.
  const comQtd = elegiveis.filter((l) => l.quantidade != null && l.quantidade > 0);
  const unidades = comQtd.reduce((a, l) => a + (l.quantidade as number), 0);
  const receitaComQtd = comQtd.reduce((a, l) => a + l.receita, 0);
  return {
    ref_month: refMonth,
    total_gmv: totalGmv,
    total_count: linhas.length,
    eligible_count: elegiveis.length,
    excluded_zero_gmv_count: linhas.length - elegiveis.length,
    brand: marca,
    buckets: elegiveis.length ? buckets : [],
    avg_price_weighted: unidades > 0 ? receitaComQtd / unidades : null,
    quality: null,
    refreshed_at: null,
  };
}

/** "2026-11" -> [primeiro dia, ultimo dia ou hoje, o que vier antes]: o Bling nao tem o futuro. */
export function periodoDoMes(ym: string, hoje: string): { inicio: string; fim: string } {
  const [a, m] = ym.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const fim = `${ym}-${String(ultimo).padStart(2, "0")}`;
  return { inicio: `${ym}-01`, fim: fim > hoje ? hoje : fim };
}
