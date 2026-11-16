import type { ProdutoMLRow } from "@/lib/api-client";
import type { SortState } from "@/lib/use-sortable-table";
import SortableHeader from "@/components/SortableHeader";
import ProductTableShell from "@/components/ProductTableShell";
import { fmtBrlCurto, fmtNumCurto } from "@/lib/formatters";
import { brandLabel } from "@/lib/filters/brands";

/** Decimal em pt-BR ("15,4"), no lugar de toFixed ("15.4"). */
const dec = (v: number, casas = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

const PARETO_LABEL: Record<string, string> = {
  A_top50: "A", B_next30: "B", C_next15: "C", D_tail: "D",
};
const PARETO_COLOR: Record<string, string> = {
  A_top50: "bg-accent-soft text-accent-ink",
  B_next30: "bg-accent-soft text-accent-ink",
  C_next15: "bg-warn-soft text-warn-ink",
  D_tail: "bg-raised text-ink-muted",
};
const SIGNAL_COLOR: Record<string, string> = {
  "ACAO:": "bg-ok-soft border-ok/30 text-ok-ink",
  "ALERTA:": "bg-crit-soft border-crit/30 text-crit-ink",
  "ATENCAO:": "bg-warn-soft border-warn/30 text-warn-ink",
  "OPORTUNIDADE:": "bg-accent-soft border-line text-accent-ink",
  "REVIEW:": "bg-raised border-line text-ink-muted",
};

/** Sinal da API em chip curto, em portugues; o texto inteiro fica no title. */
const SINAL_CURTO: [RegExp, string][] = [
  [/aumentar investimento/i, "Aumentar investimento"],
  [/pausar ads/i, "Pausar ads?"],
  [/cancelamento/i, "Cancelamento alto"],
  [/vende organico/i, "Oportunidade orgânica"],
  [/spend sem vendas/i, "Investe sem vender"],
  [/variacao de preco/i, "Preço oscilando"],
];
export function sinalCurto(signal: string): string {
  return SINAL_CURTO.find(([re]) => re.test(signal))?.[1] ?? signal;
}

function signalStyle(signal: string): string {
  const key = Object.keys(SIGNAL_COLOR).find((k) => signal.startsWith(k));
  return key ? SIGNAL_COLOR[key] : "bg-raised border-line text-ink-muted";
}
interface Props {
  // ads_ate: ha relatorio de Ads no mes, entao item sem investimento e' "Sem Ads", nao ausencia.
  items: { total: number; items: ProdutoMLRow[]; ads_ate?: string | null } | null;
  loading: boolean;
  sort: SortState;
  onSort: (column: string) => void;
  pagination: { limit: number; offset: number; onChange: (offset: number) => void };
}

/** Colunas especificas do Mercado Livre, no periodo: preco medio, cancelamento,
 * Ads (ROAS total como no ML, direto no tooltip; ACOS; investimento) e sinal de
 * acao recalculado no periodo. Velocidade e status sao do ranking acumulado.
 * Nao inclui margem: `estimated_margin` tem formula desconhecida na fonte
 * (ver docs/sections/produtos_audit.md secao 10.3) e nunca deve ser exibido
 * como margem. */
export default function MercadoLivreProductTable({ items, loading, sort, onSort, pagination }: Props) {
  const COL_COUNT = 9;
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
          <th className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider">Sinal</th>
        </tr>
      }
      renderRow={(p) => (
        <tr key={`${p.brand}-${p.item_id}`} className="hover:bg-raised transition-colors">
          <td className="px-6 py-3 max-w-xs">
            <p className="text-ink font-medium truncate leading-tight">{p.title}</p>
            {p.seller_sku && <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">{p.seller_sku}</p>}
          </td>
          <td className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase whitespace-nowrap">{p.brand ? brandLabel(p.brand.toLowerCase()) : "—"}</td>
          <td className="px-4 py-3 text-right whitespace-nowrap">
            <p className="tabular-nums text-ink font-medium">{fmtBrlCurto(p.gross_revenue)}</p>
            {p.revenue_share_pct != null && (
              <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">{dec(p.revenue_share_pct, 1)}% do total</p>
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
            {p.pareto_bucket && (
              <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${PARETO_COLOR[p.pareto_bucket] ?? "bg-raised text-ink-muted"}`}>
                {PARETO_LABEL[p.pareto_bucket] ?? p.pareto_bucket}
              </span>
            )}
          </td>
          <td className="px-4 py-3 text-right tabular-nums">
            {p.cancel_rate_pct != null ? (
              <span className={p.cancel_rate_pct < 2 ? "text-ok-ink" : p.cancel_rate_pct < 5 ? "text-warn-ink font-semibold" : "text-crit-ink font-semibold"}>
                {dec(p.cancel_rate_pct, 1)}%
              </span>
            ) : <span className="text-ink-faint">—</span>}
          </td>
          <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
            {p.ad_roas != null ? (
              <span
                title={p.ad_roas_direto != null ? `ROAS direto ${dec(p.ad_roas_direto, 1)}x · total ${dec(p.ad_roas, 1)}x (inclui venda indireta)` : undefined}
                className={p.ad_roas >= 4 ? "text-ok-ink font-semibold" : p.ad_roas >= 2.5 ? "text-warn-ink" : "text-crit-ink"}
              >
                {dec(p.ad_roas, 1)}x ROAS
                {p.ad_roas_direto != null && <span className="sr-only">, ROAS direto {dec(p.ad_roas_direto, 1)}x</span>}
              </span>
            ) : p.ad_spend == null && items?.ads_ate ? (
              <span className="text-ink-muted">Sem Ads</span>
            ) : <span className="text-ink-faint">—</span>}
            {(p.ad_acos_pct != null || p.ad_spend != null) && (
              <p className="text-[11px] text-ink-muted tabular-nums mt-0.5">
                {[
                  p.ad_acos_pct != null && `ACOS ${dec(p.ad_acos_pct, 1)}%`,
                  p.ad_spend != null && `Investimento ${fmtBrlCurto(p.ad_spend)}`,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
          </td>
          <td className="px-4 py-3 max-w-[200px]">
            {p.action_signal && (
              <span title={p.action_signal} className={`inline-block whitespace-nowrap text-[10px] font-medium px-2 py-0.5 rounded border leading-tight ${signalStyle(p.action_signal)}`}>
                {sinalCurto(p.action_signal)}
              </span>
            )}
          </td>
        </tr>
      )}
    />
  );
}
