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
  por_plataforma: PlataformaValor[];
  serie: DiaMarca[];
}

export interface MarcasMenores {
  disponivel: boolean;
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
  AMAZON: "Amazon",
  KWAI: "Kwai",
  SHEIN: "Shein",
};

export const nomeDaPlataforma = (p: string): string => NOME[p] ?? p;

const TOKEN: Record<string, string> = { MELI: "ml", SHOPEE: "shopee", TIKTOK: "tiktok", AMAZON: "amazon", KWAI: "kwai", SHEIN: "shein" };

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
