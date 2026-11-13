"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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
import { FaixaTotais, GRADE_PEDIDOS, GrupoCanal, VISUAL_DETALHE } from "@/components/pedidos/PedidosCartoes";
import PedidosDrilldownContent from "@/components/pedidos/PedidosDrilldownContent";
import Aba, { type VisaoDaAba } from "@/components/layout/Aba";
import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import CelulaBarra from "@/components/ui/CelulaBarra";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import { useTema } from "@/components/theme/ThemeProvider";
import { temaDoGrafico } from "@/lib/chart-theme";
import { fmtBrlCurto, fmtPctSimples, fmtNumCurto } from "@/lib/formatters";
import { paraPedidosLiquidos, pedidosLiquidosDaMarca, seriesDoPeriodo, TITULO_DETALHE, type ChaveDetalhe } from "@/lib/pedidos-cartoes";
import { fmtPeriodo } from "@/lib/filters/format";
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
  if (v == null) return "text-ink-faint";
  if (v < 2) return "text-ok-ink";
  if (v < 5) return "text-warn-ink";
  return "text-crit-ink";
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
      return pedidosLiquidosDaMarca(row);
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

/** Peso 0..1 de cada linha na escala da coluna (so' desenha a barrinha); `null` sem dado. */
function pesos(valores: (number | null)[]): (number | null)[] {
  const max = Math.max(0, ...valores.map((v) => v ?? 0));
  return valores.map((v) => (v == null || max <= 0 ? null : v / max));
}

const COR = {
  tiktok: "rgb(var(--tc-canal-tiktok))",
  ml: "rgb(var(--tc-canal-ml))",
  pedidos: "rgb(var(--tc-kpi-pedidos))",
  gmv: "rgb(var(--tc-kpi-gmv))",
} as const;
const TD = "px-4 py-3 text-right tabular-nums";

/** Numero com a barrinha na cor de identidade; sem dado: "—", sem barra. */
function CelulaNum({ texto, peso, cor }: { texto: string; peso: number | null; cor: string }) {
  return <td className={TD}>{peso == null ? <span className="text-ink-faint">{texto}</span> : <CelulaBarra valor={texto} peso={peso} cor={cor} />}</td>;
}

/** `showTotais`: Total e GMV somam os canais, entao so' aparecem na Visao geral (na aba de canal, misturariam canais). */
function BrandTable({ rows, showTiktok, showMl, showTotais, loading }: { rows: PedidosBrandRow[]; showTiktok: boolean; showMl: boolean; showTotais: boolean; loading: boolean }) {
  const { sort, toggleSort, sortedRows, resetSortIfColumnMissing } = useSortableTable(rows, getBrandSortValue, BRAND_COLUMN_TYPES);
  useEffect(() => {
    // coluna escondida nao pode continuar ordenando a tabela
    resetSortIfColumnMissing(["brand", ...(showTiktok ? ["tk_orders", "tk_cancel"] : []), ...(showMl ? ["ml_orders", "ml_cancel"] : []), ...(showTotais ? ["total_orders", "total_gmv"] : [])]);
  }, [showTiktok, showMl, showTotais]); // eslint-disable-line react-hooks/exhaustive-deps
  const colSpan = 1 + (showTotais ? 2 : 0) + (showTiktok ? 2 : 0) + (showMl ? 2 : 0);
  const pTk = pesos(sortedRows.map((r) => r.tiktok_orders));
  const pMl = pesos(sortedRows.map((r) => r.ml_orders));
  const pTotal = pesos(sortedRows.map((r) => pedidosLiquidosDaMarca(r)));
  const pGmv = pesos(sortedRows.map((r) => r.total_gmv));
  return (
    <TableScrollHint>
      <table className="w-full text-sm" role="table">
        <thead>
          <tr className="bg-raised text-left">
            <SortableHeader label="Marca" column="brand" sort={sort} onSort={toggleSort} align="left" />
            {showTiktok && (
              <>
                <SortableHeader label="TikTok · Pedidos" column="tk_orders" sort={sort} onSort={toggleSort} />
                <SortableHeader label="TikTok · Cancelamento" column="tk_cancel" sort={sort} onSort={toggleSort} />
              </>
            )}
            {showMl && (
              <>
                <SortableHeader label="ML · Pedidos" column="ml_orders" sort={sort} onSort={toggleSort} />
                <SortableHeader label="ML · Cancelamento" column="ml_cancel" sort={sort} onSort={toggleSort} />
              </>
            )}
            {showTotais && (
              <>
                <SortableHeader label="Total" column="total_orders" sort={sort} onSort={toggleSort} />
                <SortableHeader label="GMV" column="total_gmv" sort={sort} onSort={toggleSort} />
              </>
            )}
          </tr>
        </thead>
        <tbody className={`divide-y divide-line transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-ink-faint">
                Sem dados por marca para o período e filtros selecionados.
              </td>
            </tr>
          )}
          {sortedRows.map((row, i) => (
            <tr key={row.brand} className="transition-colors hover:bg-raised/60">
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">{row.label}</td>
              {showTiktok && (
                <>
                  <CelulaNum texto={fmtNum(row.tiktok_orders)} peso={pTk[i]} cor={COR.tiktok} />
                  <td className={TD}>
                    <span className={`font-semibold ${cancelColor(row.tiktok_cancel_rate_pct)}`}>{fmtRate(row.tiktok_cancel_rate_pct)}</span>
                  </td>
                </>
              )}
              {showMl && (
                <>
                  <CelulaNum texto={fmtNum(row.ml_orders)} peso={pMl[i]} cor={COR.ml} />
                  <td className={TD}>
                    <span className={`font-semibold ${cancelColor(row.ml_cancel_rate_pct)}`}>{fmtRate(row.ml_cancel_rate_pct)}</span>
                  </td>
                </>
              )}
              {showTotais && (
                <>
                  <CelulaNum texto={fmtNum(pedidosLiquidosDaMarca(row))} peso={pTotal[i]} cor={COR.pedidos} />
                  <CelulaNum texto={fmtBrlCurto(row.total_gmv)} peso={pGmv[i]} cor={COR.gmv} />
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScrollHint>
  );
}

type VisaoPedidos = "geral" | "tiktok" | "ml";

/** As ancoras de antes das abas continuam valendo: o link antigo abre a Visao geral. */
const ANCORAS_ANTIGAS = new Set(["#resumo", "#por-canal", "#tendencia", "#por-marca"]);

function PedidosPageInner() {
  const [filters, setFilters, padrao] = useGlobalFilters({ defaultPreset: "30d" });
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
  const [visao, setVisao] = useState<VisaoPedidos>("geral");
  useEffect(() => {
    if (ANCORAS_ANTIGAS.has(window.location.hash)) setVisao("geral");
  }, []);
  const tema = temaDoGrafico(useTema().resolvido);

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

  // Abas: Visao geral + um canal por aba (so' os canais do filtro). Aba de canal fora do filtro volta para a geral.
  const visoes: VisaoDaAba<VisaoPedidos>[] = [
    { id: "geral", rotulo: "Visão geral" },
    ...(showTiktokSel ? [{ id: "tiktok" as const, rotulo: "TikTok Shop", ponto: "bg-canal-tiktok" }] : []),
    ...(showMlSel ? [{ id: "ml" as const, rotulo: "Mercado Livre", ponto: "bg-canal-ml" }] : []),
  ];
  const visaoAtiva: VisaoPedidos = visoes.some((v) => v.id === visao) ? visao : "geral";
  const verTiktok = showTiktokSel && visaoAtiva !== "ml";
  const verMl = showMlSel && visaoAtiva !== "tiktok";

  const chartData = daily.map((r) => ({
    date: shortDate(r.date),
    ...(verTiktok ? { tiktok: r.tiktok_orders } : {}),
    ...(verMl ? { ml: r.ml_orders } : {}),
  }));

  const selecao = { tiktok: showTiktokSel, ml: showMlSel };
  const series = useMemo(() => seriesDoPeriodo(daily, selecao), [daily, showTiktokSel, showMlSel]); // eslint-disable-line react-hooks/exhaustive-deps
  // B1-04: pedidos liquidos (sem cancelados) em toda a tela, como o grafico e o ticket.
  const dadosCartoes = paraPedidosLiquidos({ kpis, tk, ml });

  const canalDados = visaoAtiva === "tiktok" ? tk : visaoAtiva === "ml" ? ml : null;
  const faixa = isErrorState || showShopeeOnly ? null : isLoadingState ? (
    <FaixaCarregando cartoes={4} className={GRADE_PEDIDOS} />
  ) : visaoAtiva === "geral" ? (
    <FaixaTotais dados={dadosCartoes} series={series} onAbrir={setDetalhe} />
  ) : canalDados ? (
    visaoAtiva === "tiktok" ? (
      <GrupoCanal dados={canalDados} serieOrders={series.tkPedidos} serieCancelados={series.tkCancelados} chaveOrders="tk_pedidos" chaveGmv="tk_gmv" chaveCancelados="tk_cancelados" onAbrir={setDetalhe} />
    ) : (
      <GrupoCanal dados={canalDados} serieOrders={series.mlPedidos} serieCancelados={series.mlCancelados} chaveOrders="ml_pedidos" chaveGmv="ml_gmv" chaveCancelados="ml_cancelados" onAbrir={setDetalhe} />
    )
  ) : dataIsFresh ? (
    <StateBlock tipo="vazio" titulo="Sem dados de canais disponíveis." />
  ) : null;

  return (
    <>
      <Aba
        titulo="Pedidos"
        visoes={showShopeeOnly ? undefined : visoes}
        visao={visaoAtiva}
        onVisao={setVisao}
        selo={
          // FINDING 2 (rodada de correcao) — Shopee isolada nunca chama fetch:
          // "API offline" implicaria falha de rede; e' so' uma fonte sem cobertura Shopee.
          dataIsFresh && showShopeeOnly ? (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">Shopee sem cobertura nesta visão</span>
          ) : (
            <SeloAtualizado aoVivo={dataIsFresh ? displayIsLive : null} em={dataIsFresh ? (displayData?.refreshed_at ?? null) : null} carregando={isLoadingState} />
          )
        }
        filtros={<GlobalFilterControls filters={filters} onChange={setFilters} hideCompare loading={isLoadingState} padrao={padrao} />}
        faixa={faixa ? <div aria-busy={isLoadingState}>{faixa}</div> : undefined}
        atencao={
          // Selecao mista: os numeros nunca incluem Shopee.
          showShopeeMixed && visaoAtiva === "geral" ? (
            <p className="w-fit rounded-lg bg-warn-soft px-3 py-1.5 text-xs font-medium text-warn-ink ring-1 ring-inset ring-warn/30">
              {avisoCoberturaShopee({ showTiktok: showTiktokSel, showMl: showMlSel, showShopee: showShopeeSel })}
            </p>
          ) : undefined
        }
      >
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
            <Panel titulo="Volume diário de pedidos">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barSize={chartData.length > 14 ? 8 : 14}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tema.grade} vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: tema.eixo }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis tick={{ fontSize: 12, fill: tema.eixo }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtNumCurto(v)} width={68} />
                    <Tooltip
                      cursor={{ fill: tema.grade, opacity: 0.45 }}
                      contentStyle={{ background: tema.tooltipFundo, border: `1px solid ${tema.tooltipBorda}`, borderRadius: 12, fontSize: 12, color: tema.tooltipTinta }}
                      labelStyle={{ fontWeight: 600, color: tema.tooltipTinta }}
                      formatter={(value: number, name: string) => [fmtNum(value), name === "tiktok" ? "TikTok Shop" : "Mercado Livre"]}
                    />
                    {verTiktok && <Bar dataKey="tiktok" animationDuration={450} animationEasing="ease-out" stackId="orders" fill={tema.canais.tiktok} radius={[0, 0, 0, 0]} />}
                    {verMl && <Bar dataKey="ml" animationDuration={450} animationEasing="ease-out" stackId="orders" fill={tema.canais.ml} radius={[3, 3, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                dataIsFresh && <StateBlock tipo="vazio" compacto titulo="Sem série diária para o período e filtros selecionados." />
              )}
              {chartData.length > 0 && verTiktok && verMl && (
                <ul aria-label="Séries do gráfico" className="m-0 mt-2 flex list-none flex-wrap justify-center gap-x-5 gap-y-1 p-0">
                  <li className="flex items-center gap-1.5 text-xs text-ink-muted"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-canal-tiktok" />TikTok Shop</li>
                  <li className="flex items-center gap-1.5 text-xs text-ink-muted"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-canal-ml" />Mercado Livre</li>
                </ul>
              )}
            </Panel>

            <Panel titulo="Por marca" semPadding ajuda="Cancelamento: abaixo de 2% em verde, de 2% a 5% em âmbar, acima de 5% em vermelho. Pedidos e Total sem os cancelados.">
              <BrandTable rows={brandRows} showTiktok={verTiktok} showMl={verMl} showTotais={visaoAtiva === "geral"} loading={isLoadingState} />
            </Panel>

            {dataIsFresh && !displayData && (
              <StateBlock tipo="indisponivel" titulo="API offline — pedidos indisponíveis." />
            )}
          </>
        )}
      </Aba>
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
    </>
  );
}

export default function PedidosPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <PedidosPageInner />
    </Suspense>
  );
}
