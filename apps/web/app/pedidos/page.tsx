"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  fetchPedidos,
  type PedidosData,
  type PedidosBrandRow,
} from "@/lib/api-client";
import { isMarketplaceSelected } from "@/lib/marketplace-filter";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import FaixaCarregando from "@/components/ui/FaixaCarregando";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { FaixaTotais, GrupoCanal, VISUAL_DETALHE } from "@/components/pedidos/PedidosCartoes";
import PedidosDrilldownContent from "@/components/pedidos/PedidosDrilldownContent";
import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import { PeriodChip } from "@/components/ui/Freshness";
import { ShoppingBag } from "lucide-react";
import BrandFilter from "@/components/BrandFilter";
import DateRangeFilter from "@/components/DateRangeFilter";
import LiveStatusBadge from "@/components/LiveStatusBadge";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import { fmtBrlCurto, fmtPctSimples, fmtNumCurto } from "@/lib/formatters";
import { seriesDoPeriodo, TITULO_DETALHE, type ChaveDetalhe } from "@/lib/pedidos-cartoes";
import { fmtPeriodo, fmtRefreshedAt } from "@/lib/filters/format";
import { useSortableTable } from "@/lib/use-sortable-table";
import SortableHeader from "@/components/SortableHeader";
import TableScrollHint from "@/components/TableScrollHint";
import { avisoCoberturaShopee, buildPedidosRequestKey, computePedidosCoverage } from "@/lib/pedidos-request-key";
import { computeRequestStatus } from "@/lib/request-freshness";

function fmtNum(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR");
}

function fmtRate(v: number | null): string {
  if (v == null) return "—";
  return fmtPctSimples(v);
}

function cancelColor(v: number | null): string {
  if (v == null) return "text-slate-400";
  if (v < 2) return "text-emerald-700";
  if (v < 5) return "text-amber-700";
  return "text-rose-700";
}

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(d)}/${parseInt(m)}`;
}

function getBrandSortValue(row: PedidosBrandRow, column: string): string | number | null {
  switch (column) {
    case "brand":
      return row.label;
    case "tk_orders":
      return row.tiktok_orders;
    case "tk_cancel":
      return row.tiktok_cancel_rate_pct;
    case "ml_orders":
      return row.ml_orders;
    case "ml_cancel":
      return row.ml_cancel_rate_pct;
    case "total_orders":
      return row.total_orders;
    case "total_gmv":
      return row.total_gmv;
    default:
      return null;
  }
}

const BRAND_COLUMN_TYPES: Record<string, "numeric" | "text"> = {
  brand: "text",
  tk_orders: "numeric",
  tk_cancel: "numeric",
  ml_orders: "numeric",
  ml_cancel: "numeric",
  total_orders: "numeric",
  total_gmv: "numeric",
};

function BrandTable({ rows, showTiktok, showMl, loading }: { rows: PedidosBrandRow[]; showTiktok: boolean; showMl: boolean; loading: boolean }) {
  const { sort, toggleSort, sortedRows } = useSortableTable(rows, getBrandSortValue, BRAND_COLUMN_TYPES);
  const colSpan = 2 + (showTiktok ? 2 : 0) + (showMl ? 2 : 0);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-violet-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-violet-100">
        <h2 className="text-sm font-semibold text-slate-700">Por marca</h2>
      </div>
      <TableScrollHint>
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="bg-slate-50 text-left">
              <SortableHeader label="Marca" column="brand" sort={sort} onSort={toggleSort} align="left" className="!px-5 !py-3 !text-[10px]" />
              {showTiktok && (
                <>
                  <SortableHeader label="TK Pedidos" column="tk_orders" sort={sort} onSort={toggleSort} className="!px-4 !py-3 !text-[10px]" />
                  <SortableHeader label="TK Cancel." column="tk_cancel" sort={sort} onSort={toggleSort} className="!px-4 !py-3 !text-[10px]" />
                </>
              )}
              {showMl && (
                <>
                  <SortableHeader label="ML Pedidos" column="ml_orders" sort={sort} onSort={toggleSort} className="!px-4 !py-3 !text-[10px]" />
                  <SortableHeader label="ML Cancel." column="ml_cancel" sort={sort} onSort={toggleSort} className="!px-4 !py-3 !text-[10px]" />
                </>
              )}
              <SortableHeader label="Total" column="total_orders" sort={sort} onSort={toggleSort} className="!px-4 !py-3 !text-[10px]" />
              <SortableHeader label="GMV" column="total_gmv" sort={sort} onSort={toggleSort} className="!px-5 !py-3 !text-[10px]" />
            </tr>
          </thead>
          <tbody className={`divide-y divide-slate-50 transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-5 py-8 text-center text-slate-400 text-sm">
                  Sem dados por marca para o período e filtros selecionados.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => (
              <tr key={row.brand} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-5 py-3 font-semibold text-slate-700">{row.label}</td>
                {showTiktok && (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtNum(row.tiktok_orders)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={`text-xs font-semibold ${cancelColor(row.tiktok_cancel_rate_pct)}`}>
                        {fmtRate(row.tiktok_cancel_rate_pct)}
                      </span>
                    </td>
                  </>
                )}
                {showMl && (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtNum(row.ml_orders)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={`text-xs font-semibold ${cancelColor(row.ml_cancel_rate_pct)}`}>
                        {fmtRate(row.ml_cancel_rate_pct)}
                      </span>
                    </td>
                  </>
                )}
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">
                  {fmtNum(row.total_orders)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{fmtBrlCurto(row.total_gmv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollHint>
    </div>
  );
}

function PedidosPageInner() {
  const [filters, setFilters] = useGlobalFilters({ defaultPreset: "30d" });
  const [data, setData] = useState<PedidosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Cartao aberto no detalhe (dialogo unico da pagina).
  const [detalhe, setDetalhe] = useState<ChaveDetalhe | null>(null);
  // Chave da ultima requisicao resolvida (sucesso ou falha) — comparada com
  // a chave atual para decidir se o estado em memoria reflete de fato os
  // filtros exibidos agora (mesmo padrao Financeiro/Regioes/Qualidade, Gate U4/U5).
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);

  const showTiktokSel = isMarketplaceSelected(filters.channels, "tiktok");
  const showMlSel = isMarketplaceSelected(filters.channels, "ml");
  const showShopeeSel = isMarketplaceSelected(filters.channels, "shopee");
  // Esta fonte cobre apenas TikTok Shop e Mercado Livre — nunca Shopee.
  const { showShopeeOnly, showShopeeMixed } = computePedidosCoverage({
    showTiktok: showTiktokSel, showMl: showMlSel, showShopee: showShopeeSel,
  });

  const requestKey = useMemo(
    () => buildPedidosRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, retryKey }),
    [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, retryKey],
  );

  useEffect(() => {
    // Ignora a resposta se os filtros mudarem antes dela chegar.
    let ignore = false;
    setLoading(true);
    setError(null);
    const key = buildPedidosRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, retryKey });

    if (showShopeeOnly) {
      // Fonte nao cobre Shopee — nunca dispara fetch para essa selecao (evita
      // pedir dado a um endpoint que nao suporta o canal e arriscar
      // interpretar a ausencia como falha de rede em vez de indisponibilidade
      // de cobertura).
      setData(null);
      setIsLive(false);
      setResolvedKey(key);
      setLoading(false);
      return () => { ignore = true; };
    }

    const opts = { brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo };
    fetchPedidos(filters.channels, opts)
      .then((result) => {
        if (ignore) return;
        if (result) {
          setData(result);
          setIsLive(true);
        } else {
          setIsLive(false);
          setData(null);
        }
        setResolvedKey(key);
        setLoading(false);
      })
      .catch(() => {
        if (ignore) return;
        setError("Falha ao carregar dados de pedidos. Verifique a conexão.");
        // A chave precisa ser marcada como resolvida MESMO na falha — senao
        // `computeRequestStatus` nunca sai de "loading" (resolvedKey nunca
        // bate com requestKey) e a falha da requisicao atual nunca vira
        // "error" de fato (fica presa em loading para sempre).
        setResolvedKey(key);
        setLoading(false);
      });
    return () => { ignore = true; };
  }, [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, retryKey, showShopeeOnly]);

  // FINDING 2 (Gate U4) — loading/error/fresh SEPARADOS: depois de um erro
  // definitivo, `dataIsFresh` fica `false` para sempre, mas `isLoadingState`
  // tambem precisa ficar `false`.
  const requestStatus = computeRequestStatus({ loading, error: error != null, resolvedKey, requestKey });
  const dataIsFresh = requestStatus.fresh;
  const isLoadingState = requestStatus.loading;
  const isErrorState = requestStatus.error;

  // Versao protegida do estado bruto — nenhum calculo/card/tabela abaixo
  // deve ler `data`/`isLive` diretamente.
  const displayData = dataIsFresh ? data : null;
  const displayIsLive = dataIsFresh ? isLive : false;

  const kpis = displayData?.kpis;
  const tk = showTiktokSel ? displayData?.tiktok : undefined;
  const ml = showMlSel ? displayData?.ml : undefined;
  const daily = displayData?.daily ?? [];
  const brandRows = displayData?.by_brand ?? [];
  const periodLabel = fmtPeriodo(filters.dateFrom, filters.dateTo);

  const chartData = daily.map((r) => ({
    date: shortDate(r.date),
    ...(showTiktokSel ? { tiktok: r.tiktok_orders } : {}),
    ...(showMlSel ? { ml: r.ml_orders } : {}),
  }));

  const selecao = { tiktok: showTiktokSel, ml: showMlSel };
  const series = useMemo(() => seriesDoPeriodo(daily, selecao), [daily, showTiktokSel, showMlSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const dadosCartoes = { kpis, tk, ml };

  return (
    <PageContainer>
      <PageHeader
        title="Pedidos"
        icon={ShoppingBag}
        meta={
          <>
            <PeriodChip label={periodLabel} />
            {dataIsFresh && displayData?.refreshed_at && (
              <span className="text-xs text-ink-muted tabular-nums">Atualizado em {fmtRefreshedAt(displayData.refreshed_at)}</span>
            )}
          </>
        }
        // FINDING 2 (rodada de correcao) — Shopee isolada nunca chama fetch
        // (ver efeito abaixo): "API offline" implicaria falha de rede, que
        // nunca ocorreu aqui — e' apenas uma fonte sem cobertura Shopee.
        // Checado ANTES de `dataIsFresh` (que e' `true` nesse caminho, pois
        // a identidade foi marcada como resolvida sem erro/loading).
        status={
          dataIsFresh && showShopeeOnly ? (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
              Shopee sem cobertura nesta visão
            </span>
          ) : dataIsFresh ? (
            <LiveStatusBadge live={displayIsLive} offlineLabel="Sem dados · API offline" />
          ) : null
        }
        filters={<GlobalFilterControls filters={filters} onChange={setFilters} hideCompare loading={isLoadingState} />}
      />

        {/* Shopee isolada: o selo do cabecalho e o estado vazio abaixo ja dizem
            que nao ha cobertura. Selecao mista: os numeros nunca incluem Shopee. */}
        {showShopeeMixed && (
          <p className="w-fit rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            {avisoCoberturaShopee({ showTiktok: showTiktokSel, showMl: showMlSel, showShopee: showShopeeSel })}
          </p>
        )}

        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {isLoadingState
            ? "Carregando dados de pedidos..."
            : isErrorState
            ? "Falha ao carregar."
            : showShopeeOnly
            ? "Pedidos não possui cobertura Shopee nesta fonte."
            : "Dados de pedidos carregados."}
        </span>

      {isErrorState ? (
        <StateBlock
          tipo="erro"
          titulo="Não foi possível carregar os dados de pedidos."
          descricao={error}
          acao={<RetryButton onClick={() => { setError(null); setRetryKey((k) => k + 1); }} />}
        />
      ) : showShopeeOnly ? (
        <StateBlock tipo="indisponivel" titulo="Sem cobertura de Shopee em Pedidos." descricao="Selecione TikTok Shop ou Mercado Livre." />
      ) : (
      <>
        {/* Navegacao interna compacta */}
        <nav aria-label="Navegação interna da página" className="flex flex-wrap gap-1 -mx-2.5">
          <a href="#resumo" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Resumo</a>
          <a href="#por-canal" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Por Canal</a>
          <a href="#tendencia" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Tendência</a>
          <a href="#por-marca" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Por Marca</a>
        </nav>

        {/* Cartoes no padrao da Gerencial: os 4 totais e um grupo por canal. */}
        <div id="resumo" className="scroll-mt-24" aria-busy={isLoadingState}>
          {isLoadingState ? (
            <FaixaCarregando cartoes={4} className="grid grid-cols-2 md:grid-cols-4 gap-3" />
          ) : (
            <FaixaTotais dados={dadosCartoes} series={series} onAbrir={setDetalhe} />
          )}
        </div>

        <div id="por-canal" className="scroll-mt-24 flex flex-col gap-4">
          {isLoadingState && <FaixaCarregando cartoes={4} className="grid grid-cols-2 md:grid-cols-4 gap-3" />}
          {!isLoadingState && tk && (
            <GrupoCanal
              canal="tiktok" titulo="TikTok Shop" dados={tk}
              serieOrders={series.tkPedidos} serieCancelados={series.tkCancelados}
              chaveOrders="tk_pedidos" chaveGmv="tk_gmv" chaveCancelados="tk_cancelados" onAbrir={setDetalhe}
            />
          )}
          {!isLoadingState && ml && (
            <GrupoCanal
              canal="ml" titulo="Mercado Livre" dados={ml}
              serieOrders={series.mlPedidos} serieCancelados={series.mlCancelados}
              chaveOrders="ml_pedidos" chaveGmv="ml_gmv" chaveCancelados="ml_cancelados" onAbrir={setDetalhe}
            />
          )}
          {!isLoadingState && !tk && !ml && dataIsFresh && (
            <StateBlock tipo="vazio" titulo="Sem dados de canais disponíveis." />
          )}
        </div>

        {/* Daily chart */}
        <div id="tendencia" className="scroll-mt-24 bg-white rounded-2xl shadow-sm border border-violet-100 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Volume diário de pedidos — {periodLabel}
          </h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barSize={chartData.length > 14 ? 8 : 14}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  interval={chartData.length > 14 ? 4 : 1}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => fmtNumCurto(v)}
                  width={56}
                />
                <Tooltip
                  contentStyle={{ borderRadius: "12px", border: "1px solid #ede9fe", fontSize: 12 }}
                  formatter={(value: number, name: string) => [
                    fmtNum(value),
                    name === "tiktok" ? "TikTok Shop" : "Mercado Livre",
                  ]}
                  labelStyle={{ fontWeight: 600, color: "#1e293b" }}
                />
                <Legend
                  formatter={(v) => v === "tiktok" ? "TikTok Shop" : "Mercado Livre"}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                />
                {showTiktokSel && <Bar dataKey="tiktok" animationDuration={450} animationEasing="ease-out" stackId="orders" fill="#7c3aed" radius={[0, 0, 0, 0]} />}
                {showMlSel && <Bar dataKey="ml" animationDuration={450} animationEasing="ease-out" stackId="orders" fill="#f59e0b" radius={[3, 3, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            dataIsFresh && <p className="text-sm text-slate-400 text-center py-10">Sem série diária para o período e filtros selecionados.</p>
          )}
        </div>

        {/* Brand table */}
        <div id="por-marca" className="scroll-mt-24">
          <BrandTable rows={brandRows} showTiktok={showTiktokSel} showMl={showMlSel} loading={isLoadingState} />
        </div>

        {dataIsFresh && !displayData && (
          <StateBlock tipo="indisponivel" titulo="API offline — pedidos indisponíveis." />
        )}
      </>
      )}
      <KpiDrilldownDialog
        open={detalhe != null}
        onClose={() => setDetalhe(null)}
        title={detalhe ? TITULO_DETALHE[detalhe] : ""}
        icone={detalhe ? VISUAL_DETALHE[detalhe].icone : undefined}
        identidade={detalhe ? VISUAL_DETALHE[detalhe].identidade : undefined}
      >
        {detalhe && dataIsFresh && (
          <PedidosDrilldownContent
            chave={detalhe}
            dados={dadosCartoes}
            marcas={brandRows}
            sel={selecao}
            series={series}
            identidade={VISUAL_DETALHE[detalhe].identidade}
            periodLabel={periodLabel}
            refreshedAt={displayData?.refreshed_at ?? null}
          />
        )}
      </KpiDrilldownDialog>
    </PageContainer>
  );
}

export default function PedidosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8f7ff]" />}>
      <PedidosPageInner />
    </Suspense>
  );
}
