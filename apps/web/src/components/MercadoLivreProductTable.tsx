import type { ProdutoMLRow } from "@/lib/api-client";
import type { SortState } from "@/lib/use-sortable-table";
import SortableHeader from "@/components/SortableHeader";
import ProductTableShell from "@/components/ProductTableShell";
import { fmtBrlCurto, fmtNumCurto } from "@/lib/formatters";

const PARETO_LABEL: Record<string, string> = {
  A_top50: "A", B_next30: "B", C_next15: "C", D_tail: "D",
};
const PARETO_COLOR: Record<string, string> = {
  A_top50: "bg-accent-soft text-accent-ink",
  B_next30: "bg-accent-soft text-accent-ink",
  C_next15: "bg-warn-soft text-warn-ink",
  D_tail: "bg-raised text-ink-muted",
};
const VELOCITY_COLOR: Record<string, string> = {
  high: "text-ok-ink",
  medium: "text-warn-ink",
  low: "text-ink-muted",
  zero: "text-crit",
};
const EFFICIENCY_COLOR: Record<string, string> = {
  star: "bg-warn-soft text-warn-ink",
  efficient: "bg-ok-soft text-ok-ink",
  marginal: "bg-raised text-ink-muted",
  inefficient: "bg-crit-soft text-crit-ink",
  no_ads: "bg-raised text-ink-muted",
  no_return: "bg-crit-soft text-crit-ink",
};
const EFFICIENCY_LABEL: Record<string, string> = {
  star: "estrela", efficient: "eficiente", marginal: "marginal",
  inefficient: "ineficiente", no_ads: "sem ads", no_return: "sem retorno",
};
const SIGNAL_COLOR: Record<string, string> = {
  "ACAO:": "bg-ok-soft border-ok/30 text-ok-ink",
  "ALERTA:": "bg-crit-soft border-crit/30 text-crit-ink",
  "ATENCAO:": "bg-warn-soft border-warn/30 text-warn-ink",
  "OPORTUNIDADE:": "bg-accent-soft border-line text-accent-ink",
  "REVIEW:": "bg-raised border-line text-ink-muted",
};

function signalStyle(signal: string | null): string {
  if (!signal) return "";
  const key = Object.keys(SIGNAL_COLOR).find((k) => signal.startsWith(k));
  return key ? SIGNAL_COLOR[key] : "bg-raised border-line text-ink-muted";
}

interface Props {
  items: { total: number; items: ProdutoMLRow[] } | null;
  loading: boolean;
  sort: SortState;
  onSort: (column: string) => void;
  pagination: { limit: number; offset: number; onChange: (offset: number) => void };
}

/** Colunas especificas do Mercado Livre: preco medio, cancelamento,
 * eficiencia de Ads (ROAS/ACOS/spend), velocidade, status e sinal de acao.
 * Nao inclui margem: `estimated_margin` tem formula desconhecida na fonte
 * (ver docs/sections/produtos_audit.md secao 10.3) e nunca deve ser exibido
 * como margem. */
export default function MercadoLivreProductTable({ items, loading, sort, onSort, pagination }: Props) {
  const COL_COUNT = 10;
  return (
    <ProductTableShell<ProdutoMLRow>
      ariaLabel="Produtos Mercado Livre"
      colCount={COL_COUNT}
      loading={loading}
      items={items?.items ?? null}
      pagination={items ? { total: items.total, ...pagination } : undefined}
      thead={
        <tr className="bg-raised text-left">
          <SortableHeader label="Produto" column="title" sort={sort} onSort={onSort} align="left" />
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider">Marca</th>
          <SortableHeader label="Receita" column="gross_revenue" sort={sort} onSort={onSort} align="right" />
          <SortableHeader label="Preço Médio" column="avg_price" sort={sort} onSort={onSort} align="right" />
          <SortableHeader label="Unid." column="units_sold" sort={sort} onSort={onSort} align="right" />
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider text-center">Pareto</th>
          <SortableHeader label="Cancel." column="cancel_rate_pct" sort={sort} onSort={onSort} align="right" />
          <SortableHeader label="Eficiência Ads" column="ad_roas" sort={sort} onSort={onSort} align="right" />
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider text-center">Efic. Ads</th>
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider">Sinal</th>
        </tr>
      }
      renderRow={(p) => (
        <tr key={`${p.brand}-${p.item_id}`} className="hover:bg-raised transition-colors">
          <td className="px-6 py-3 max-w-xs">
            <p className="text-ink font-medium truncate leading-tight">{p.title}</p>
            {p.seller_sku && <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">{p.seller_sku}</p>}
          </td>
          <td className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase whitespace-nowrap">{p.brand}</td>
          <td className="px-4 py-3 text-right whitespace-nowrap">
            <p className="tabular-nums text-ink font-medium">{fmtBrlCurto(p.gross_revenue)}</p>
            {p.revenue_share_pct != null && (
              <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">{p.revenue_share_pct.toFixed(1)}% do total</p>
            )}
          </td>
          <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums text-ink-muted">
            {p.avg_price != null ? fmtBrlCurto(p.avg_price) : <span className="text-ink-faint">—</span>}
          </td>
          <td className="px-4 py-3 text-right whitespace-nowrap">
            <p className="tabular-nums text-ink-muted">{fmtNumCurto(p.units_sold)}</p>
            {p.unique_buyers != null && (
              <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">{fmtNumCurto(p.unique_buyers)} compr.</p>
            )}
          </td>
          <td className="px-4 py-3 text-center">
            <div className="flex flex-col items-center gap-1">
              {p.pareto_bucket && (
                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${PARETO_COLOR[p.pareto_bucket] ?? "bg-raised text-ink-muted"}`}>
                  {PARETO_LABEL[p.pareto_bucket] ?? p.pareto_bucket}
                </span>
              )}
              {p.revenue_velocity && (
                <span className={`text-[10px] font-medium ${VELOCITY_COLOR[p.revenue_velocity] ?? "text-ink-muted"}`}>
                  {p.revenue_velocity}
                </span>
              )}
            </div>
          </td>
          <td className="px-4 py-3 text-right tabular-nums">
            {p.cancel_rate_pct != null ? (
              <span className={p.cancel_rate_pct < 2 ? "text-ok-ink" : p.cancel_rate_pct < 5 ? "text-warn-ink font-semibold" : "text-crit-ink font-semibold"}>
                {p.cancel_rate_pct.toFixed(1)}%
              </span>
            ) : <span className="text-ink-faint">—</span>}
          </td>
          <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
            {p.ad_roas != null ? (
              <span className={p.ad_roas >= 4 ? "text-ok-ink font-semibold" : p.ad_roas >= 2.5 ? "text-warn-ink" : "text-crit-ink"}>
                {p.ad_roas.toFixed(1)}x ROAS
              </span>
            ) : <span className="text-ink-faint">—</span>}
            {(p.ad_acos_pct != null || p.ad_spend != null) && (
              <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">
                {[
                  p.ad_acos_pct != null && `ACOS ${p.ad_acos_pct.toFixed(1)}%`,
                  p.ad_spend != null && `Spend ${fmtBrlCurto(p.ad_spend)}`,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
          </td>
          <td className="px-4 py-3 text-center">
            {p.ad_efficiency && (
              <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${EFFICIENCY_COLOR[p.ad_efficiency] ?? "bg-raised text-ink-muted"}`}>
                {EFFICIENCY_LABEL[p.ad_efficiency] ?? p.ad_efficiency}
              </span>
            )}
          </td>
          <td className="px-4 py-3 max-w-[200px]">
            {p.action_signal && (
              <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded border leading-tight ${signalStyle(p.action_signal)}`}>
                {p.action_signal}
              </span>
            )}
          </td>
        </tr>
      )}
    />
  );
}
