/**
 * Full (ML Full + Shopee FBS) x sem Full. A PROPORCAO vem das fatos de
 * modalidade logistica (/ml-fulfillment e /shopee-fbs); o VALOR, do GMV mostrado.
 * TikTok nao tem Full.
 */
/** GMV de uma marca por canal, separado em Full, sem Full e sem dado de Full. */
export interface FullDaMarca {
  full: Partial<Record<"tiktok" | "ml" | "shopee", number>>;
  semFull: Partial<Record<"tiktok" | "ml" | "shopee", number>>;
  /** Canal com venda e sem modalidade medida (ex.: Kokeshi na Shopee). */
  semDado: Partial<Record<"tiktok" | "ml" | "shopee", number>>;
}

/**
 * Por canal de uma marca: a proporcao vem da
 * fato de modalidade, o valor do GMV do card. TikTok nao tem Full; canal sem
 * proporcao medida vai para "sem dado", nunca para "sem Full".
 */
export function fullDaMarca(
  gmv: Partial<Record<"tiktok" | "ml" | "shopee", number>>,
  share: { ml?: number | null; shopee?: number | null },
): FullDaMarca {
  const r: FullDaMarca = { full: {}, semFull: {}, semDado: {} };
  for (const [c, v] of Object.entries(gmv) as ["tiktok" | "ml" | "shopee", number][]) {
    if (!(v > 0)) continue;
    const s = c === "tiktok" ? 0 : share[c];
    if (s == null) r.semDado[c] = v;
    else {
      if (s > 0) r.full[c] = v * s;
      if (s < 1) r.semFull[c] = v - v * s;
    }
  }
  return r;
}

/** Por marca: proporcao de GMV (ml, shopee) e contagem real de pedidos Full das fatos. */
export interface FullMarca {
  ml?: number | null;
  shopee?: number | null;
  /** Pedidos Full medidos: ML Full (pagos) + Shopee FBS (elegiveis). Ausente = canal sem medida. */
  pedFull?: number | null;
  /** Pedidos da marca na janela da medida; so' preenchido quando a janela nao e' o periodo. */
  pedBase?: number | null;
}

export type FullPorMarca = Record<string, FullMarca>;

/** Dados de Full que a pagina entrega aos detalhes; `aproximado` = a medida cobre so' parte do periodo (ate' ontem). */
export interface FullDoDetalhe {
  por: FullPorMarca;
  aproximado: boolean;
}

/**
 * Pedidos de uma marca em Full e sem Full. A contagem de Full e' real (fatos de
 * modalidade); sem Full e' o resto dos pedidos da marca, TikTok incluso.
 * `null` = sem medida: marca sem Full medido, ou com canal vendendo sem
 * modalidade (Kokeshi na Shopee) -- nunca vira "tudo sem Full".
 * Janela diferente do periodo (dia em andamento): vale a PROPORCAO da janela.
 */
export function fullPedidosDaMarca(
  pedidos: number,
  f: FullMarca | undefined,
  aproximado: boolean,
  d: FullDaMarca | null,
): { full: number; semFull: number } | null {
  const base = aproximado ? f?.pedBase : pedidos;
  if (!f || f.pedFull == null || !d || !(pedidos > 0) || !(base != null && base > 0)) return null;
  if (Object.values(d.semDado).some((v) => (v ?? 0) > 0)) return null;
  const full = Math.round(pedidos * Math.min(1, f.pedFull / base));
  return { full, semFull: pedidos - full };
}
