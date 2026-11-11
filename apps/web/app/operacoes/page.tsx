"use client";

import { useEffect, useState, useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import LiveStatusBadge from "@/components/LiveStatusBadge";
import { GrupoSemDados, GrupoVelocidade } from "@/components/operacoes/VelocidadeMl";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import InfoDica from "@/components/ui/InfoDica";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import {
  fetchOperacoes,
  type OperacoesData,
  type TkDailyRow,
  type CreatorRow,
  type LiveRow,
} from "@/lib/api-client";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples, fmtVezes } from "@/lib/formatters";
import { useSortableTable, type SortColumnType } from "@/lib/use-sortable-table";
import SortableHeader from "@/components/SortableHeader";
import TableScrollHint from "@/components/TableScrollHint";
import { computeRequestStatus } from "@/lib/request-freshness";
import { temaDoGrafico, type MarcaDoGrafico } from "@/lib/chart-theme";
import { useTema } from "@/components/theme/ThemeProvider";

const BRAND_LABELS: Record<string, string> = {
  apice: "ÁPICE",
  barbours: "BARBOURS",
  kokeshi: "KOKESHI",
  lescent: "LESCENT",
  rituaria: "RITUÁRIA",
};

const ML_BRANDS = ["barbours", "kokeshi", "lescent"];
const ALL_BRANDS = ["apice", "barbours", "kokeshi", "lescent", "rituaria"];


function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-6 py-4 border-b border-line">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <TableScrollHint>
      <table className="w-full text-sm">{children}</table>
    </TableScrollHint>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function GpmBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-faint">—</span>;
  const cls =
    v >= 20
      ? "bg-ok-soft text-ok-ink"
      : v >= 10
      ? "bg-warn-soft text-warn-ink"
      : "bg-crit-soft text-crit-ink";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {fmtBrlCurto(v)}
    </span>
  );
}

function PctLiveColor({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-faint">—</span>;
  const cls =
    v >= 15
      ? "text-ok-ink font-semibold"
      : v >= 5
      ? "text-warn-ink font-semibold"
      : "text-crit font-semibold";
  return <span className={`tabular-nums ${cls}`}>{fmtPctSimples(v)}</span>;
}

// Build a pivot table for the trend chart: date → { brand: gmv }
function buildChartData(rows: TkDailyRow[]): Record<string, number | string>[] {
  const byDate: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const label = formatDateLabel(r.ref_date);
    if (!byDate[label]) byDate[label] = {};
    byDate[label][r.brand] = (byDate[label][r.brand] ?? 0) + r.gmv;
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, brands]) => ({ date, ...brands }));
}

function formatDateLabel(iso: string): string {
  // iso is YYYY-MM-DD
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

export default function OperacoesPage() {
  const [data, setData] = useState<OperacoesData | null>(null);
  const tema = temaDoGrafico(useTema().resolvido);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [creatorBrand, setCreatorBrand] = useState<string>("all");
  // Chave da ultima requisicao resolvida (sucesso ou falha) — comparada com
  // a chave atual para nunca deixar uma resposta obsoleta (de um retry
  // anterior) sobrescrever o retry ATUAL em andamento (mesmo padrao
  // Financeiro/Regioes/Qualidade/Pedidos/Inteligencia, Gate U4/U5). Esta tela
  // nao tem filtros globais — a unica variavel de identidade e o retryKey.
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const requestKey = useMemo(() => String(retryKey), [retryKey]);

  useEffect(() => {
    // Ignora a resposta se um novo retry disparar antes dela chegar.
    let ignore = false;
    setLoading(true);
    setError(null);
    const key = String(retryKey);
    fetchOperacoes()
      .then((res) => {
        if (ignore) return;
        setData(res.data);
        setIsLive(res.live);
        setResolvedKey(key);
        setLoading(false);
      })
      .catch(() => {
        if (ignore) return;
        setError("Falha ao carregar dados de operações. Verifique a conexão.");
        // A chave precisa ser marcada como resolvida MESMO na falha — senao
        // `computeRequestStatus` nunca sai de "loading".
        setResolvedKey(key);
        setLoading(false);
      });
    return () => { ignore = true; };
  }, [retryKey]);

  // FINDING 2 (Gate U4) — loading/error/fresh SEPARADOS.
  const requestStatus = computeRequestStatus({ loading, error: error != null, resolvedKey, requestKey });
  const dataIsFresh = requestStatus.fresh;
  const isLoadingState = requestStatus.loading;
  const isErrorState = requestStatus.error;

  // Versao protegida do estado bruto — `data == null` com sucesso e'
  // indisponibilidade real; nenhum calculo/card/tabela abaixo deve ler
  // `data`/`isLive` brutos diretamente.
  const displayData = dataIsFresh ? data : null;
  const displayIsLive = dataIsFresh ? isLive : false;

  const filteredCreators = useMemo(
    () =>
      (displayData?.creators ?? []).filter(
        (r) => creatorBrand === "all" || r.brand === creatorBrand
      ),
    [displayData, creatorBrand]
  );

  const getCreatorValue = (
    row: CreatorRow,
    column: string
  ): string | number | null | undefined => {
    switch (column) {
      case "creator":
        return row.creator;
      case "gmv":
        return row.gmv;
      case "gmv_video":
        return row.videos > 0 ? row.gmv_video : null;
      case "gmv_live":
        return row.lives > 0 ? row.gmv_live : null;
      case "views":
        return row.views > 0 ? row.views : null;
      case "videos":
        return row.videos > 0 ? row.videos : null;
      case "lives":
        return row.lives > 0 ? row.lives : null;
      case "gpm_video":
        return row.videos > 0 ? row.gpm_video : null;
      default:
        return null;
    }
  };
  const creatorColumnTypes: Record<string, SortColumnType> = {
    creator: "text",
    gmv: "numeric",
    gmv_video: "numeric",
    gmv_live: "numeric",
    views: "numeric",
    videos: "numeric",
    lives: "numeric",
    gpm_video: "numeric",
  };
  const creatorsSort = useSortableTable(
    filteredCreators,
    getCreatorValue,
    creatorColumnTypes
  );

  const getLiveValue = (
    row: LiveRow,
    column: string
  ): string | number | null | undefined => {
    switch (column) {
      case "brand":
        return BRAND_LABELS[row.brand] ?? row.brand;
      case "total_lives":
        return row.total_lives;
      case "total_minutes":
        return row.total_minutes;
      case "live_gmv":
        return row.live_gmv;
      case "pct_live":
        return row.pct_live;
      case "gmv_per_live":
        return row.gmv_per_live;
      case "gmv_per_minute":
        return row.gmv_per_minute;
      default:
        return null;
    }
  };
  const liveColumnTypes: Record<string, SortColumnType> = {
    brand: "text",
    total_lives: "numeric",
    total_minutes: "numeric",
    live_gmv: "numeric",
    pct_live: "numeric",
    gmv_per_live: "numeric",
    gmv_per_minute: "numeric",
  };
  const livesSort = useSortableTable(
    displayData?.lives ?? [],
    getLiveValue,
    liveColumnTypes
  );

  const chartData = useMemo(
    () => buildChartData(displayData?.tk_daily ?? []),
    [displayData]
  );

  // Only show brands that actually appear in tk_daily
  const brandsInChart = useMemo(() => {
    const seen = new Set<string>();
    for (const r of displayData?.tk_daily ?? []) seen.add(r.brand);
    return ALL_BRANDS.filter((b) => seen.has(b));
  }, [displayData]);

  const alertas = displayData?.alertas ?? [];
  const criticos = alertas.filter((a) => a.severidade === "critico");
  const atencoes = alertas.filter((a) => a.severidade === "atencao");

  const hasAnyData = dataIsFresh && displayData != null;

  return (
    <PageContainer>
      {/* Contrato independente dos filtros globais (declarado no "ⓘ" do
          cabecalho): sem barra sticky, para nao sugerir um escopo que a tela
          nao aplica. */}
      <PageHeader
        title="Operações"
        subtitle="Alertas, criadores, lives e velocidade de mídia."
        status={
          <span className="flex items-center gap-2">
            {dataIsFresh ? (
              <LiveStatusBadge live={displayIsLive} />
            ) : isLoadingState ? (
              <span className="text-xs text-ink-muted bg-raised border border-line rounded-lg px-3 py-1.5 font-medium">
                Atualizando dados...
              </span>
            ) : null}
            <InfoDica texto="Os filtros globais de canal, marca e período não se aplicam aqui: cada seção usa o próprio período." />
          </span>
        }
      />

        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {isLoadingState
            ? "Carregando dados de operações..."
            : isErrorState
            ? "Falha ao carregar."
            : "Dados carregados."}
        </span>

      {isErrorState ? (
        <StateBlock
          tipo="erro"
          titulo="Não foi possível carregar os dados de operações."
          descricao={error ?? undefined}
          acao={<RetryButton onClick={() => { setError(null); setRetryKey((k) => k + 1); }} />}
        />
      ) : dataIsFresh && !hasAnyData ? (
        <StateBlock
          tipo="indisponivel"
          titulo="Dados de operações indisponíveis no momento."
          acao={<RetryButton onClick={() => setRetryKey((k) => k + 1)} />}
        />
      ) : (
      <>
        {/* Navegacao interna compacta */}
        <nav aria-label="Navegação interna da página" className="flex flex-wrap gap-1 -mx-2.5">
          <a href="#alertas" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-ink hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Alertas</a>
          <a href="#top-criadores" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-ink hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Top Criadores</a>
          <a href="#lives" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-ink hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Performance de Lives</a>
          <a href="#velocidade-ml" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-ink hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Velocidade ML</a>
          <a href="#trend-tiktok" className="px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-ink hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Trend TikTok</a>
        </nav>

        {/* Seção 1 — Alertas Ativos */}
        <div
          id="alertas"
          className={`scroll-mt-24 transition-opacity duration-200 ${isLoadingState ? "opacity-50 pointer-events-none" : ""}`}
          aria-busy={isLoadingState}
        >
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-widest mb-3">
            Alertas Ativos — Últimos 7 dias
          </h2>

          {alertas.length === 0 && dataIsFresh ? (
            <div className="bg-ok-soft border border-ok/30 rounded-2xl p-5">
              <p className="text-sm font-semibold text-ok-ink">
                Nenhum alerta ativo esta semana.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {criticos.map((a, i) => (
                <div
                  key={i}
                  className="bg-crit-soft border border-crit/30 rounded-2xl px-5 py-4 flex items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-block w-2 h-2 rounded-full bg-crit shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-crit-ink uppercase tracking-wider">
                          Crítico
                        </span>
                        <span className="text-[10px] font-semibold text-crit bg-crit-soft border border-crit/30 rounded px-1.5 py-0.5">
                          {BRAND_LABELS[a.brand] ?? a.brand}
                        </span>
                      </div>
                      <p className="text-sm text-crit-ink">{a.mensagem}</p>
                    </div>
                  </div>
                  {a.ad_spend != null && (
                    <div className="text-right shrink-0">
                      <p className="text-xs text-crit font-medium">Ad Spend</p>
                      <p className="text-sm font-bold text-crit-ink tabular-nums">
                        {fmtBrlCurto(a.ad_spend)}
                      </p>
                    </div>
                  )}
                </div>
              ))}
              {atencoes.map((a, i) => (
                <div
                  key={i}
                  className="bg-warn-soft border border-warn/30 rounded-2xl px-5 py-4 flex items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-block w-2 h-2 rounded-full bg-warn shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-warn-ink uppercase tracking-wider">
                          Atenção
                        </span>
                        <span className="text-[10px] font-semibold text-warn bg-warn-soft border border-warn/30 rounded px-1.5 py-0.5">
                          {BRAND_LABELS[a.brand] ?? a.brand}
                        </span>
                      </div>
                      <p className="text-sm text-warn-ink">{a.mensagem}</p>
                    </div>
                  </div>
                  {a.roas != null && (
                    <div className="text-right shrink-0">
                      <p className="text-xs text-warn font-medium">ROAS</p>
                      <p className="text-sm font-bold text-warn-ink tabular-nums">
                        {fmtVezes(a.roas)}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Seção 2 — Top Criadores */}
        <div
          id="top-criadores"
          className={`scroll-mt-24 bg-surface border border-line rounded-2xl shadow-sm overflow-hidden transition-opacity duration-200 ${
            isLoadingState ? "opacity-50 pointer-events-none" : ""
          }`}
          aria-busy={isLoadingState}
        >
          <SectionHeader title="Top Criadores — Últimos 7 dias" />

          {/* Filtros por marca */}
          <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-wrap">
            {["all", ...ALL_BRANDS].map((b) => (
              <button
                key={b}
                onClick={() => setCreatorBrand(b)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  creatorBrand === b
                    ? "bg-accent text-accent-on border-accent"
                    : "bg-surface text-ink-muted border-line hover:border-accent/40"
                }`}
              >
                {b === "all" ? "Todos" : BRAND_LABELS[b]}
              </button>
            ))}
          </div>

          <TableWrap>
            <thead>
              <tr className="bg-raised text-left">
                <Th>#</Th>
                <Th>Marca</Th>
                <SortableHeader
                  label="Criador"
                  column="creator"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                  align="left"
                />
                <SortableHeader
                  label="GMV Total"
                  column="gmv"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                />
                <SortableHeader
                  label="GMV Vídeo"
                  column="gmv_video"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                />
                <SortableHeader
                  label="GMV Live"
                  column="gmv_live"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                />
                <SortableHeader
                  label="Views"
                  column="views"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                />
                <SortableHeader
                  label="Vídeos"
                  column="videos"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                />
                <SortableHeader
                  label="Lives"
                  column="lives"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                />
                <SortableHeader
                  label="GPM"
                  column="gpm_video"
                  sort={creatorsSort.sort}
                  onSort={creatorsSort.toggleSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {creatorsSort.sortedRows.map((r, i) => (
                <tr key={i} className="hover:bg-raised transition-colors">
                  <td className="px-4 py-3 text-xs font-bold text-ink-faint tabular-nums w-8">
                    {i + 1}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-ink whitespace-nowrap">
                    {BRAND_LABELS[r.brand] ?? r.brand}
                  </td>
                  <td className="px-4 py-3 text-ink max-w-[180px] truncate" title={r.creator}>
                    {r.creator}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink font-semibold text-sm">
                    {fmtBrlCurto(r.gmv)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.videos > 0 ? fmtBrlCurto(r.gmv_video) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.lives > 0 ? fmtBrlCurto(r.gmv_live) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.views > 0 ? fmtNumCurto(r.views) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.videos > 0 ? r.videos : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.lives > 0 ? r.lives : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.videos > 0 ? (
                      <GpmBadge v={r.gpm_video} />
                    ) : (
                      <span className="text-ink-faint text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {creatorsSort.sortedRows.length === 0 && dataIsFresh && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-6 py-8 text-center text-ink-faint text-sm"
                  >
                    Nenhum criador encontrado para o filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </TableWrap>
          <div className="px-6 py-3 border-t border-line flex items-center gap-6 flex-wrap">
            <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest">GPM:</span>
            <span className="flex items-center gap-1.5 text-xs text-ok-ink">
              <span className="w-2 h-2 rounded-full bg-ok inline-block" /> &gt;= R$20
            </span>
            <span className="flex items-center gap-1.5 text-xs text-warn-ink">
              <span className="w-2 h-2 rounded-full bg-warn inline-block" /> R$10–20
            </span>
            <span className="flex items-center gap-1.5 text-xs text-crit">
              <span className="w-2 h-2 rounded-full bg-crit inline-block" /> &lt; R$10
            </span>
          </div>
        </div>

        {/* Seção 3 — Performance de Lives */}
        <div
          id="lives"
          className={`scroll-mt-24 bg-surface border border-line rounded-2xl shadow-sm overflow-hidden transition-opacity duration-200 ${
            isLoadingState ? "opacity-50 pointer-events-none" : ""
          }`}
          aria-busy={isLoadingState}
        >
          <SectionHeader title="Performance de Lives — Últimos 30 dias" />
          <TableWrap>
            <thead>
              <tr className="bg-raised text-left">
                <SortableHeader
                  label="Marca"
                  column="brand"
                  sort={livesSort.sort}
                  onSort={livesSort.toggleSort}
                  align="left"
                />
                <SortableHeader
                  label="Lives"
                  column="total_lives"
                  sort={livesSort.sort}
                  onSort={livesSort.toggleSort}
                />
                <SortableHeader
                  label="Horas ao Vivo"
                  column="total_minutes"
                  sort={livesSort.sort}
                  onSort={livesSort.toggleSort}
                />
                <SortableHeader
                  label="GMV Lives"
                  column="live_gmv"
                  sort={livesSort.sort}
                  onSort={livesSort.toggleSort}
                />
                <SortableHeader
                  label="% GMV via Live"
                  column="pct_live"
                  sort={livesSort.sort}
                  onSort={livesSort.toggleSort}
                />
                <SortableHeader
                  label="GMV/Live"
                  column="gmv_per_live"
                  sort={livesSort.sort}
                  onSort={livesSort.toggleSort}
                />
                <SortableHeader
                  label="GMV/min"
                  column="gmv_per_minute"
                  sort={livesSort.sort}
                  onSort={livesSort.toggleSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {livesSort.sortedRows.map((r) => (
                <tr key={r.brand} className="hover:bg-raised transition-colors">
                  <td className="px-4 py-3 text-xs font-semibold text-ink whitespace-nowrap">
                    {BRAND_LABELS[r.brand] ?? r.brand}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.total_lives}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {(r.total_minutes / 60).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink font-semibold text-sm">
                    {fmtBrlCurto(r.live_gmv)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PctLiveColor v={r.pct_live} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.gmv_per_live != null ? fmtBrlCurto(r.gmv_per_live) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted text-sm">
                    {r.gmv_per_minute != null
                      ? fmtBrlCurto(r.gmv_per_minute)
                      : "—"}
                  </td>
                </tr>
              ))}
              {livesSort.sortedRows.length === 0 && dataIsFresh && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-ink-faint text-sm"
                  >
                    Nenhuma marca realizou lives nos últimos 30 dias.
                  </td>
                </tr>
              )}
            </tbody>
          </TableWrap>
          <div className="px-6 py-3 border-t border-line flex items-center gap-6 flex-wrap">
            <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest">% GMV via Live:</span>
            <span className="flex items-center gap-1.5 text-xs text-ok-ink">
              <span className="w-2 h-2 rounded-full bg-ok inline-block" /> &gt;= 15%
            </span>
            <span className="flex items-center gap-1.5 text-xs text-warn-ink">
              <span className="w-2 h-2 rounded-full bg-warn inline-block" /> 5–15%
            </span>
            <span className="flex items-center gap-1.5 text-xs text-crit">
              <span className="w-2 h-2 rounded-full bg-crit inline-block" /> &lt; 5%
            </span>
          </div>
        </div>

        {/* Seção 4 — Velocidade ML */}
        <div
          id="velocidade-ml"
          className={`scroll-mt-24 transition-opacity duration-200 ${isLoadingState ? "opacity-50 pointer-events-none" : ""}`}
          aria-busy={isLoadingState}
        >
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-widest mb-3">
            Velocidade ML — Últimos 7 dias
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {(displayData?.ml_velocity ?? []).map((r) => (
              <GrupoVelocidade key={r.brand} r={r} rotulo={BRAND_LABELS[r.brand] ?? r.brand} />
            ))}
            {ML_BRANDS.filter(
              (b) => !(displayData?.ml_velocity ?? []).some((r) => r.brand === b)
            ).map((b) => (
              <GrupoSemDados key={b} rotulo={BRAND_LABELS[b]} />
            ))}
          </div>
        </div>

        {/* Seção 5 — Trend TikTok */}
        <div
          id="trend-tiktok"
          className={`scroll-mt-24 bg-surface border border-line rounded-2xl shadow-sm overflow-hidden transition-opacity duration-200 ${
            isLoadingState ? "opacity-50 pointer-events-none" : ""
          }`}
          aria-busy={isLoadingState}
        >
          <SectionHeader
            title="Trend TikTok — Últimos 14 dias"
            subtitle="GMV diário por marca, todos os canais."
          />
          <div className="px-4 py-5">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: tema.eixo }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtBrlCurto(v as number)}
                    tick={{ fontSize: 11, fill: tema.eixo }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      fmtBrlCurto(value),
                      BRAND_LABELS[name] ?? name,
                    ]}
                    contentStyle={{
                      background: tema.tooltipFundo,
                      border: `1px solid ${tema.tooltipBorda}`,
                      borderRadius: "12px",
                      fontSize: "12px",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                    }}
                    labelStyle={{ fontWeight: 600, color: tema.tooltipTinta, marginBottom: 4 }}
                  />
                  <Legend
                    formatter={(value) => BRAND_LABELS[value] ?? value}
                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  />
                  {brandsInChart.map((brand) => (
                    <Line animationDuration={450} animationEasing="ease-out"
                      key={brand}
                      type="monotone"
                      dataKey={brand}
                      stroke={tema.marcas[brand as MarcaDoGrafico] ?? tema.referencia}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              dataIsFresh && (
                <p className="text-sm text-ink-faint text-center py-10">
                  Sem dados TikTok nos últimos 14 dias.
                </p>
              )
            )}
          </div>
        </div>
      </>
      )}
    </PageContainer>
  );
}
