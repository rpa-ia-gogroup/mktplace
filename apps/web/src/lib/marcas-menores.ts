/**
 * Marcas menores (Denavita, Yenzah, Auá, By Samia) — contrato de
 * `GET /api/v1/performance/marcas-menores` (fonte: API do Avoe, só até D-1) e a
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
}

export interface MarcaMenor {
  id: string;
  label: string;
  total: number | null;
  /** Período anterior de mesma duração; null = sem base (nunca 0). */
  total_anterior?: number | null;
  por_plataforma: PlataformaValor[];
  serie: DiaMarca[];
}

export interface Consolidado {
  total: number | null;
  total_anterior: number | null;
  por_plataforma: PlataformaValor[];
}

export interface MarcasMenores {
  disponivel: boolean;
  consolidado?: Consolidado | null;
  motivo?: string | null;
  periodo?: { inicio: string; fim: string } | null;
  dado_ate?: string | null;
  /** O período pedido passava de ontem e foi recortado (ex.: filtro Hoje). */
  ajustado: boolean;
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

/** Produto x quantidade x receita; só Denavita no TikTok tem item (Data Mart). */
export interface ProdutoLinha {
  sku: string;
  produto: string;
  quantidade: number | null;
  receita: number | null;
}

export interface ProdutosDenavitaTiktok {
  disponivel: boolean;
  motivo?: string | null;
  produtos: ProdutoLinha[];
}
