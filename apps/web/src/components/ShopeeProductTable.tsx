import type { ProdutoShopeeRow } from "@/lib/api-client";
import type { SortState } from "@/lib/use-sortable-table";
import SortableHeader from "@/components/SortableHeader";
import ProductTableShell from "@/components/ProductTableShell";
import { fmtBrl, fmtNumber } from "@/lib/formatters";

const PARETO_LABEL: Record<string, string> = {
  A_top50: "A", B_next30: "B", C_next15: "C", D_tail: "D",
};
const PARETO_COLOR: Record<string, string> = {
  A_top50: "bg-accent-soft text-accent-ink",
  B_next30: "bg-accent-soft text-accent-ink",
  C_next15: "bg-warn-soft text-warn-ink",
  D_tail: "bg-raised text-ink-muted",
};

interface Props {
  items: { total: number; items: ProdutoShopeeRow[] } | null;
  loading: boolean;
  sort: SortState;
  onSort: (column: string) => void;
  pagination: { limit: number; offset: number; onChange: (offset: number) => void };
}

/** Colunas especificas da Shopee: variacao, SKU, pedidos, cancelamentos,
 * ticket medio e compradores (quando confiavel). */
export default function ShopeeProductTable({ items, loading, sort, onSort, pagination }: Props) {
  const COL_COUNT = 10;
  return (
    <ProductTableShell<ProdutoShopeeRow>
      ariaLabel="Produtos Shopee"
      colCount={COL_COUNT}
      loading={loading}
      items={items?.items ?? null}
      pagination={items ? { total: items.total, ...pagination } : undefined}
      thead={
        <tr className="bg-raised text-left">
          <SortableHeader label="Produto" column="product_name" sort={sort} onSort={onSort} align="left" />
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider">Variação</th>
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider">SKU</th>
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider">Marca</th>
          <SortableHeader label="GMV" column="gmv" sort={sort} onSort={onSort} align="right" />
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider text-center">Pareto</th>
          <SortableHeader label="Unid." column="units_sold" sort={sort} onSort={onSort} align="right" />
          <SortableHeader label="Pedidos" column="orders" sort={sort} onSort={onSort} align="right" />
          <SortableHeader label="Cancel.%" column="cancel_rate_pct" sort={sort} onSort={onSort} align="right" />
          <SortableHeader label="Ticket Médio" column="avg_price" sort={sort} onSort={onSort} align="right" />
        </tr>
      }
      renderRow={(p, i) => (
        <tr key={`${p.brand}-${p.sku_ref ?? "sem-sku"}-${p.variation_name ?? ""}-${i}`} className="hover:bg-raised transition-colors">
          <td className="px-6 py-3 max-w-xs">
            <p className="text-ink font-medium truncate leading-tight">{p.product_name}</p>
          </td>
          <td className="px-4 py-3 text-xs text-ink-muted max-w-[120px] truncate">
            {p.variation_name ?? <span className="text-ink-faint">—</span>}
          </td>
          <td className="px-4 py-3 text-[11px] text-ink-muted tabular-nums whitespace-nowrap">
            {p.sku_ref ?? <span className="text-ink-faint">—</span>}
          </td>
          <td className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase whitespace-nowrap">{p.brand}</td>
          <td className="px-4 py-3 text-right tabular-nums text-ink font-medium whitespace-nowrap">{fmtBrl(p.gmv)}</td>
          <td className="px-4 py-3 text-center">
            {p.pareto_bucket && (
              <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${PARETO_COLOR[p.pareto_bucket] ?? "bg-raised text-ink-muted"}`}>
                {PARETO_LABEL[p.pareto_bucket] ?? p.pareto_bucket}
              </span>
            )}
          </td>
          <td className="px-4 py-3 text-right tabular-nums text-ink-muted whitespace-nowrap">{p.units_sold != null ? fmtNumber(p.units_sold) : <span className="text-ink-faint">—</span>}</td>
          <td className="px-4 py-3 text-right tabular-nums text-ink-muted whitespace-nowrap">{p.orders != null ? fmtNumber(p.orders) : <span className="text-ink-faint">—</span>}</td>
          <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
            {p.cancel_rate_pct != null ? (
              <span className={p.cancel_rate_pct < 2 ? "text-ok-ink" : p.cancel_rate_pct < 5 ? "text-warn-ink font-semibold" : "text-crit-ink font-semibold"}>
                {p.cancel_rate_pct.toFixed(1)}%
              </span>
            ) : <span className="text-ink-faint">—</span>}
          </td>
          <td className="px-4 py-3 text-right tabular-nums text-ink-muted whitespace-nowrap">
            {p.avg_price != null ? fmtBrl(p.avg_price) : <span className="text-ink-faint">—</span>}
          </td>
        </tr>
      )}
    />
  );
}
