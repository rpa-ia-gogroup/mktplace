/**
 * Marcas menores (Denavita, Yenzah, Auá, By Samia) — contrato de
 * `GET /api/v1/performance/marcas-menores` (fonte: API do Bling v3) e a
 * leitura pura dele. Ausência nunca vira 0: `total` null = sem dado.
 */
export interface PlataformaValor {
  plataforma: string;
  faturamento: number;
}

export interface DiaMarca {
  data: string;
  faturamento: number;
  por_plataforma: Record<string, number>;
  pedidos_por_plataforma?: Record<string, number>;
}

export interface MarcaMenor {
  id: string;
  label: string;
  /** "aguardando_autorizacao" = conta do Bling ainda não autorizada (não é zero). */
  status?: string;
  total: number | null;
  /** Período anterior de mesma duração; null = sem base (nunca 0). */
  total_anterior?: number | null;
  /** O anterior por canal (plataforma): permite respeitar o filtro de canal na comparação. */
  por_plataforma_anterior?: Record<string, number>;
  /** Pedidos não cancelados do Bling; null = sem pedido (sem dado, nunca 0). */
  pedidos?: number | null;
  pedidos_por_plataforma?: Record<string, number>;
  pedidos_por_plataforma_anterior?: Record<string, number>;
  por_plataforma: PlataformaValor[];
  serie: DiaMarca[];
}

export interface Consolidado {
  total: number | null;
  total_anterior: number | null;
  por_plataforma_anterior?: Record<string, number>;
  pedidos?: number | null;
  pedidos_por_plataforma?: Record<string, number>;
  pedidos_por_plataforma_anterior?: Record<string, number>;
  por_plataforma: PlataformaValor[];
}

export interface MarcasMenores {
  disponivel: boolean;
  consolidado?: Consolidado | null;
  motivo?: string | null;
  periodo?: { inicio: string; fim: string } | null;
  marcas: MarcaMenor[];
}

const NOME: Record<string, string> = {
  MELI: "Mercado Livre",
  SHOPEE: "Shopee",
  TIKTOK: "TikTok",
};

/** Conhecida: nome amigavel; desconhecida: capitalizada ("NETSHOES" -> "Netshoes"). */
export const nomeDaPlataforma = (p: string): string =>
  NOME[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p);

const TOKEN: Record<string, string> = { MELI: "ml", SHOPEE: "shopee", TIKTOK: "tiktok" };

/** Cor de canal como valor CSS (barra e gráfico); plataforma sem token cai no cinza de apoio. */
export function corDaPlataforma(p: string): string {
  const t = TOKEN[p];
  return t ? `rgb(var(--tc-canal-${t}))` : "rgb(var(--tc-faint))";
}

/** Fatias de 0..1 da quebra por plataforma; sem total, sem fatia. */
export function fatias(m: MarcaMenor): { plataforma: string; frac: number }[] {
  const soma = m.por_plataforma.reduce((a, p) => a + p.faturamento, 0);
  return soma > 0 ? m.por_plataforma.map((p) => ({ plataforma: p.plataforma, frac: p.faturamento / soma })) : [];
}

/** Plataformas presentes na série, na ordem da quebra (para empilhar). */
export function plataformasDaSerie(m: MarcaMenor): string[] {
  return m.por_plataforma.map((p) => p.plataforma);
}

/** Variação % contra o período anterior; sem base (ou base 0) não inventa percentual. */
export function variacaoPct(total: number | null | undefined, anterior: number | null | undefined): number | null {
  if (total == null || anterior == null || anterior <= 0) return null;
  return ((total - anterior) / anterior) * 100;
}

/** Produto x quantidade x receita por marca (itens dos pedidos do Bling). */
export interface ProdutoLinha {
  sku: string;
  produto: string;
  quantidade: number | null;
  receita: number | null;
  /** So' nos itens por canal: plataforma (SHOPEE/TIKTOK/MELI) e pedidos distintos que trazem o produto. */
  plataforma?: string | null;
  pedidos?: number | null;
}

export interface ProdutosDaMarca {
  id: string;
  label: string;
  status?: string;
  produtos: ProdutoLinha[];
  /** O mesmo produto por canal (o Gerencial e a aba Produtos filtram por canal). */
  itens_por_canal?: ProdutoLinha[];
  /** Conferencia: soma dos itens lidos x GMV (total dos pedidos) do mesmo recorte. */
  receita_itens?: number | null;
  gmv_pedidos?: number | null;
}

export interface ProdutosMarcas {
  disponivel: boolean;
  motivo?: string | null;
  /** false enquanto faltam itens de pedido (1 chamada cada): consulta de novo. */
  completo: boolean;
  pedidos_total: number;
  pedidos_lidos: number;
  marcas: ProdutosDaMarca[];
}
