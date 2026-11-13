"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  fetchRegioesSummary, fetchRegioesByUf, fetchRegioesByBrand, fetchRegioesTrend,
  type RegioesSummaryData, type RegiaoUfRow, type RegiaoBrandRow, type RegiaoTrendPoint,
} from "@/lib/api-client";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import FaixaCarregando from "@/components/ui/FaixaCarregando";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import CartoesRegioes, { FreteRegioes, GRADE_REGIOES, TOTAL_DE_CARTOES_REGIOES, VISUAL_REGIOES } from "@/components/regioes/RegioesCartoes";
import RegioesDrilldownContent from "@/components/regioes/RegioesDrilldownContent";
import { TITULO_DETALHE, type ChaveRegioes } from "@/lib/regioes-cartoes";
import Aba from "@/components/layout/Aba";
import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import CelulaBarra from "@/components/ui/CelulaBarra";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "@/lib/formatters";
import { fmtPeriodo, fmtRefreshedAt } from "@/lib/filters/format";
import {
  fmtPctOrNA, coverageLabel, coverageBadgeClass, semCoberturaAviso, fmtShareOfTotalPct,
} from "@/lib/regioes-format";
import { buildRegionalScope } from "@/lib/regioes-scope";
import {
  buildAvisoCobertura, linhaAtualizacao, marcaPontoAusente, fmtDataBr, normalizarCobertura,
  nivelUf,
} from "@/lib/regioes-cobertura";
import { useSortableTable } from "@/lib/use-sortable-table";
import SortableHeader from "@/components/SortableHeader";
import TableScrollHint from "@/components/TableScrollHint";
import InfoDica from "@/components/ui/InfoDica";
import {
  buildRegioesRequestKey, buildRegioesFetchScopes, describeRegioesPartialSections, formatRegioesPartialWarning,
} from "@/lib/regioes-request-key";
import { computeRequestStatus } from "@/lib/request-freshness";

const ALL_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "XX",
];

// Mapa SVG do Brasil — pesado (27 UFs de path + logica de hover/selecao) e
// so usado nesta pagina; carregado sob demanda (Task 5) para nao entrar no
// bundle inicial de outras rotas. Sem SSR: e puramente interativo (hover/
// clique/teclado), nao ha conteudo indexavel perdido no fallback.
const RegioesBrazilMap = dynamic(() => import("@/components/RegioesBrazilMap"), {
  ssr: false,
  loading: () => (
    <div className="h-96 animate-pulse rounded-2xl border border-line bg-surface motion-reduce:animate-none" aria-hidden="true" />
  ),
});

function CoverageBadge({ level }: { level: RegiaoUfRow["coverage_level"] }) {
  return (
    <span className={`inline-block text-xs font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5 whitespace-nowrap ${coverageBadgeClass(level)}`}>
      {coverageLabel(level)}
    </span>
  );
}

function RegioesPageInner() {
  const [filters, setFilters, padrao] = useGlobalFilters({ defaultPreset: "mes_anterior", defaultCompare: false });
  // Filtro local de UF — nao faz parte do contrato de filtros globais/URL
  // (por design: e' especifico desta tela, ver docs/filtros_globais_contrato.md).
  const [ufFilter, setUfFilter] = useState<string>("");

  const [summary, setSummary] = useState<RegioesSummaryData | null>(null);
  // `null` = secao indisponivel (endpoint individual falhou); `[]` = secao
  // resolvida com sucesso e realmente vazia (FINDING 3 — nunca confundir os
  // dois). `summary == null` continua sendo o unico gatilho de erro TOTAL.
  const [byUf, setByUf] = useState<RegiaoUfRow[] | null>(null);
  const [byBrand, setByBrand] = useState<RegiaoBrandRow[] | null>(null);
  const [trend, setTrend] = useState<RegiaoTrendPoint[] | null>(null);
  const [trendGranularity, setTrendGranularity] = useState<"day" | "month">("day");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Cartao aberto no detalhe (dialogo unico da pagina).
  const [detalhe, setDetalhe] = useState<ChaveRegioes | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [semCobertura, setSemCobertura] = useState<string[]>([]);
  // Chave da ultima requisicao resolvida com sucesso — comparada com a
  // chave atual para decidir se o estado em memoria reflete de fato os
  // filtros exibidos agora.
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);

  const requestKey = useMemo(
    () => buildRegioesRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, uf: ufFilter, retryKey }),
    [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, ufFilter, retryKey],
  );

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    const key = buildRegioesRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, uf: ufFilter, retryKey });
    const { ufScoped, national } = buildRegioesFetchScopes(
      { brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo }, ufFilter,
    );
    Promise.all([
      fetchRegioesSummary(filters.channels, ufScoped),
      fetchRegioesByUf(filters.channels, ufScoped),
      fetchRegioesByBrand(filters.channels, national),
      fetchRegioesTrend(filters.channels, national),
    ]).then(([sm, uf, br, tr]) => {
      if (ignore) return;
      if (sm == null) {
        setError("Falha ao carregar dados regionais. Verifique a conexão e tente novamente.");
        // A chave precisa ser marcada como resolvida MESMO na falha — senao
        // `computeRequestStatus` nunca sai de "loading" (resolvedKey nunca
        // bate com requestKey) e a falha da requisicao atual nunca vira
        // "error" de fato (fica presa em loading para sempre).
        setResolvedKey(key);
        setLoading(false);
        return;
      }
      setSummary(sm);
      setByUf(uf?.data ?? null);
      setByBrand(br?.data ?? null);
      setTrend(tr?.data ?? null);
      setTrendGranularity(tr?.granularity ?? "day");
      setRefreshedAt(sm.refreshed_at);
      setSemCobertura(sm.channels_sem_cobertura_regional);
      setResolvedKey(key);
      setLoading(false);
    }).catch(() => {
      if (ignore) return;
      setError("Falha ao carregar dados regionais. Verifique a conexão e tente novamente.");
      setResolvedKey(key);
      setLoading(false);
    });
    return () => { ignore = true; };
  }, [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, ufFilter, retryKey]);

  // FINDING 2 (rodada de correcao) — loading/error/fresh SEPARADOS: depois
  // de um erro definitivo, `dataIsFresh` fica `false` para sempre, mas
  // `isLoadingState` tambem precisa ficar `false` (senao skeleton/opacidade/
  // aria-busy continuariam ligados como se ainda estivesse buscando).
  const requestStatus = computeRequestStatus({ loading, error: error != null, resolvedKey, requestKey });
  const dataIsFresh = requestStatus.fresh;
  const isLoadingState = requestStatus.loading;
  const isErrorState = requestStatus.error;

  // Versoes protegidas do estado bruto — nenhum calculo/card/tabela/mapa
  // abaixo deve ler summary/byUf/byBrand/trend/refreshedAt/semCobertura
  // diretamente; sempre via estas constantes. byUf/byBrand/trend viram `[]`
  // tanto quando indisponiveis (FINDING 3) quanto quando nao frescos — a
  // distincao "indisponivel" x "vazio real" e feita separadamente abaixo
  // (unavailableSections), nunca no valor exibido nas tabelas/mapa.
  const displaySummary = dataIsFresh ? summary : null;
  const displayByUf = dataIsFresh ? (byUf ?? []) : [];
  const displayByBrand = dataIsFresh ? (byBrand ?? []) : [];
  const displayTrend = dataIsFresh ? (trend ?? []) : [];
  const displayRefreshedAt = dataIsFresh ? refreshedAt : null;
  const displaySemCobertura = dataIsFresh ? semCobertura : [];
  // Cobertura por canal (REGIONAL-SOURCE-RECOVERY-2/3): vem do summary, a
  // mesma resposta que define os totais exibidos. Com canal atrasado (D-2
  // inclusive), o cabecalho mostra "Dados completos até" e nunca so' o
  // `refreshed_at`. `normalizarCobertura` aceita a API antiga (sem os
  // campos), que fica no ar entre a publicacao da Vercel e a do Render.
  const cobertura = normalizarCobertura(dataIsFresh ? summary : null);
  const canaisComAtraso = cobertura.canaisComAtraso;
  const avisoCobertura = buildAvisoCobertura(cobertura.canais);
  // T-0088: o selo "UF preenchida" dos cartoes le' o `coverage_level` da API,
  // que ja' e' o pior entre UF e frescor por canal. O aviso de UF baixa/parcial fala SO' do preenchimento de UF; o frescor ja'
  // tem o quadro proprio (aviso-cobertura-canal).
  const nivelSoUf = displaySummary ? nivelUf(displaySummary) : null;
  const linhaTemporal = dataIsFresh
    ? linhaAtualizacao(
        cobertura.dadosCompletosAte,
        canaisComAtraso,
        displayRefreshedAt ? fmtRefreshedAt(displayRefreshedAt) : null,
      )
    : null;

  // Dados parciais (FINDING 3): `summary == null` ja e' erro TOTAL (acima).
  // Aqui, com `summary` resolvido, cada secao individual que veio `null`
  // (nao `[]`) e' listada — nunca durante loading/erro total.
  const unavailableSections = dataIsFresh ? describeRegioesPartialSections({ byUf, byBrand, trend }) : [];
  const partialWarning = formatRegioesPartialWarning(unavailableSections);

  const periodLabel = fmtPeriodo(filters.dateFrom, filters.dateTo);
  const isEmpty = dataIsFresh && displaySummary != null && displaySummary.orders === 0 && byUf != null && byUf.length === 0;
  const aviso = semCoberturaAviso(displaySemCobertura);
  // Gate DQ2: escopo regional declarado (canal x elegibilidade x preenchimento
  // de UF sao dimensoes distintas) — o total desta tela nunca deve ser lido
  // como o GMV do periodo. So' com dado fresco; nunca durante loading/erro.
  const regionalScope = dataIsFresh
    ? buildRegionalScope(filters.channels, displaySemCobertura, displaySummary?.uf_fill_pct ?? null)
    : null;
  // So' a ressalva NOVA (canal com carga atrasada). O escopo ("Mercado Livre + Shopee · nao comparavel ao GMV
  // total") ja' esta no selo logo acima dos cartoes e nao se repete no ⓘ.
  const notaDoGmv =
    regionalScope && canaisComAtraso.length > 0
      ? cobertura.dadosCompletosAte
        ? `Completo só até ${fmtDataBr(cobertura.dadosCompletosAte)} — ver aviso`
        : "Incompleto no período — ver aviso"
      : undefined;

  const ufColumnTypes = useMemo(() => ({
    uf: "text" as const, gmv: "numeric" as const, orders: "numeric" as const,
    share: "numeric" as const, uf_fill_pct: "numeric" as const,
  }), []);
  const ufGetValue = (row: RegiaoUfRow, column: string): string | number | null => {
    switch (column) {
      case "uf": return row.uf;
      case "gmv": return row.gmv;
      case "orders": return row.orders;
      case "share": return displaySummary ? fmtShareOfTotalPct(row.gmv, displaySummary.gmv) : null;
      case "uf_fill_pct": return row.uf_fill_pct;
      default: return null;
    }
  };
  const ufSort = useSortableTable(displayByUf, ufGetValue, ufColumnTypes);

  const brandColumnTypes = useMemo(() => ({
    brand: "text" as const, marketplace: "text" as const, gmv: "numeric" as const,
    orders: "numeric" as const, uf_fill_pct: "numeric" as const, shipping_pct: "numeric" as const,
  }), []);
  const brandGetValue = (row: RegiaoBrandRow, column: string): string | number | null => {
    switch (column) {
      case "brand": return row.label;
      case "marketplace": return row.marketplace;
      case "gmv": return row.gmv;
      case "orders": return row.orders;
      case "uf_fill_pct": return row.uf_fill_pct;
      case "shipping_pct": return row.shipping_cost_coverage_pct;
      default: return null;
    }
  };
  const brandSort = useSortableTable(displayByBrand, brandGetValue, brandColumnTypes);

  const pesoGmvUf = (() => {
    const max = Math.max(0, ...ufSort.sortedRows.map((r) => r.gmv ?? 0));
    return ufSort.sortedRows.map((r) => (r.gmv == null || max <= 0 ? null : r.gmv / max));
  })();
  const pesoGmvMarca = (() => {
    const max = Math.max(0, ...brandSort.sortedRows.map((r) => r.gmv ?? 0));
    return brandSort.sortedRows.map((r) => (r.gmv == null || max <= 0 ? null : r.gmv / max));
  })();
  const corpoOpaco = `divide-y divide-line transition-opacity duration-200 ${isLoadingState ? "opacity-50" : ""}`;
  const TH = "px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted";
  const TD = "px-4 py-3 text-right tabular-nums text-ink-muted";
  const naoSeAplicaUf = ufFilter ? (
    <span className="rounded-md bg-warn-soft px-2 py-1 text-xs font-medium text-warn-ink ring-1 ring-inset ring-warn/30">
      Nacional · filtro de UF ({ufFilter}) não se aplica
    </span>
  ) : undefined;

  return (
    <>
      <Aba
        titulo="Regiões"
        selo={
          linhaTemporal && canaisComAtraso.length > 0 ? (
            // canal atrasado: "Dados completos até", escrito em tom de alerta (nunca so' o refreshed_at)
            <span data-testid="regioes-linha-atualizacao" className="inline-flex min-h-8 items-center rounded-md bg-warn-soft px-2.5 text-xs font-medium text-warn-ink ring-1 ring-inset ring-warn/30">
              {linhaTemporal}
            </span>
          ) : (
            <span data-testid="regioes-linha-atualizacao">
              <SeloAtualizado aoVivo={displaySummary ? true : null} em={displayRefreshedAt} carregando={isLoadingState} />
            </span>
          )
        }
        filtros={<GlobalFilterControls filters={filters} onChange={setFilters} hideCompare loading={isLoadingState} padrao={padrao} />}
        direita={
          // A UF e' filtro/acao DESTA pagina: entra na identidade da requisicao local e nao vira filtro global.
          <div className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm">
            <label htmlFor="uf-filter" className="text-ink-muted">UF</label>
            <select
              id="uf-filter"
              value={ufFilter}
              onChange={(e) => setUfFilter(e.target.value)}
              className="rounded bg-transparent font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">Todas</option>
              {ALL_UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        }
        faixa={
          isErrorState ? undefined : (
            // A ressalva de escopo e de atraso vai para o ⓘ do GMV; o aviso de canal parado vem ANTES dos cartoes
            // (muda a leitura deles) e fica mesmo sem dado, porque explica o vazio.
            <div className="flex flex-col gap-3" aria-busy={isLoadingState}>
            {/* REGIONAL-SOURCE-RECOVERY-2: canal com fonte regional parado — muda a leitura dos cartoes. */}
            {avisoCobertura && (
              <div
                role="status"
                data-testid="aviso-cobertura-canal"
                className={`rounded-2xl p-4 ring-1 ring-inset ${avisoCobertura.severidade === "critico" ? "bg-crit-soft ring-crit/30" : "bg-warn-soft ring-warn/30"}`}
              >
                <p className={`flex items-center gap-1.5 text-sm font-semibold ${avisoCobertura.severidade === "critico" ? "text-crit-ink" : "text-warn-ink"}`}>
                  {avisoCobertura.titulo}
                  <InfoDica texto={[avisoCobertura.mensagem, ...avisoCobertura.detalhes].join(" ")} />
                </p>
                {/* T-0088: quais canais e ate quando, em TEXTO VISIVEL — antes so' no ⓘ. */}
                <p data-testid="aviso-cobertura-resumo" className={`mt-1 text-sm ${avisoCobertura.severidade === "critico" ? "text-crit-ink" : "text-warn-ink"}`}>
                  {avisoCobertura.resumo}
                </p>
                {avisoCobertura.detalhes.map((d) => (
                  <p key={d} className={`mt-1 text-xs ${avisoCobertura.severidade === "critico" ? "text-crit-ink" : "text-warn-ink"}`}>{d}</p>
                ))}
              </div>
            )}

              {/* Cartoes no padrao da Gerencial. ALVO-GRADE: quatro CartaoIndicador. */}
              {isLoadingState ? (
                <FaixaCarregando cartoes={TOTAL_DE_CARTOES_REGIOES} className={GRADE_REGIOES} />
              ) : isEmpty ? null : (
                <CartoesRegioes resumo={displaySummary} notaDoGmv={notaDoGmv} onAbrir={setDetalhe} />
              )}
            </div>
          )
        }
        atencao={
          regionalScope || (dataIsFresh && displaySummary && (nivelSoUf === "low" || nivelSoUf === "partial")) || partialWarning ? (
            <div className="flex flex-col gap-2">
              {/* Gate DQ2: escopo do que esta sendo medido, SEMPRE visivel com dado fresco. O texto completo fica no ⓘ. */}
              {regionalScope && (
                <p className={`flex w-fit flex-wrap items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${regionalScope.status === "not_applicable" ? "bg-raised text-ink-muted ring-line" : regionalScope.status === "partial_channels" ? "bg-warn-soft text-warn-ink ring-warn/30" : "bg-accent-soft text-accent-ink ring-accent/20"}`}>
                  {regionalScope.status === "not_applicable"
                    ? "Sem cobertura regional na seleção · não é venda zero"
                    : regionalScope.status === "partial_channels"
                      ? `Só ${regionalScope.channelsInScope.join(" + ")} · ${regionalScope.channelsOutOfScope.join(", ")} fora · não comparável ao GMV total`
                      : `Escopo regional: ${regionalScope.channelsInScope.join(" + ")} · não comparável ao GMV total`}
                  {regionalScope.ufFillCaveat && <span className="text-warn-ink">· UF 100% só no escopo regional</span>}
                  <InfoDica texto={[regionalScope.scopeNote, regionalScope.ufFillCaveat, aviso].filter(Boolean).join(" ")} />
                </p>
              )}

              {dataIsFresh && displaySummary && (nivelSoUf === "low" || nivelSoUf === "partial") && (
                <p className={`flex w-fit flex-wrap items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ring-1 ring-inset ${nivelSoUf === "low" ? "bg-crit-soft text-crit-ink ring-crit/30" : "bg-warn-soft text-warn-ink ring-warn/30"}`}>
                  <span className="font-semibold">{nivelSoUf === "low" ? "Cobertura de UF baixa" : "Cobertura de UF parcial"}</span>
                  <span className="tabular-nums">· {fmtPctOrNA(displaySummary.uf_fill_pct)} com UF ({fmtNumCurto(displaySummary.uf_known_orders)} de {fmtNumCurto(displaySummary.uf_eligible_orders)})</span>
                  <InfoDica texto="Os números por UF refletem só os pedidos elegíveis com UF conhecida — limitação da fonte, não erro." />
                </p>
              )}

              {partialWarning && !isErrorState && !isEmpty && (
                <p className="w-fit rounded-lg bg-warn-soft px-3 py-1.5 text-xs text-warn-ink ring-1 ring-inset ring-warn/30">{partialWarning}</p>
              )}
            </div>
          ) : undefined
        }
      >
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {isLoadingState ? "Carregando dados regionais..." : isErrorState ? "Falha ao carregar dados regionais." : "Dados regionais carregados."}
        </span>

        {isErrorState ? (
          // FINDING 2: erro definitivo — nunca skeleton, nunca dado antigo, nunca `aria-busy=true`.
          <StateBlock
            tipo="erro"
            titulo="Não foi possível carregar os dados regionais."
            descricao={error}
            acao={<RetryButton onClick={() => { setError(null); setRetryKey((k) => k + 1); }} />}
          />
        ) : isEmpty ? (
          <StateBlock tipo="vazio" titulo="Sem dados regionais no período e filtros selecionados." />
        ) : (
          <>
            {/* Mapa do Brasil por UF — geometria real (SVG), ver RegioesBrazilMap.tsx. Usa o filtro local de UF. */}
            <RegioesBrazilMap rows={displayByUf} totalGmv={displaySummary?.gmv ?? 0} loading={isLoadingState} />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Ranking por UF — usa o filtro local de UF */}
              <Panel titulo="Ranking por UF" semPadding>
                {/* 27 UFs: rola dentro do painel (cabecalho fixo), como a Tendencia ao lado */}
                <TableScrollHint className="max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-raised">
                      <tr className="bg-raised text-left">
                        <SortableHeader label="UF" column="uf" sort={ufSort.sort} onSort={ufSort.toggleSort} align="left" />
                        <SortableHeader label="GMV" column="gmv" sort={ufSort.sort} onSort={ufSort.toggleSort} />
                        <SortableHeader label="Pedidos" column="orders" sort={ufSort.sort} onSort={ufSort.toggleSort} />
                        <SortableHeader label="Participação" column="share" sort={ufSort.sort} onSort={ufSort.toggleSort} />
                        <th className={TH}>Cobertura</th>
                      </tr>
                    </thead>
                    <tbody className={corpoOpaco}>
                      {displayByUf.length === 0 && dataIsFresh && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-faint">
                            {unavailableSections.includes("byUf")
                              ? "Dados indisponíveis para o Ranking por UF neste momento."
                              : "Sem dados por UF para o período e filtros selecionados."}
                          </td>
                        </tr>
                      )}
                      {ufSort.sortedRows.map((row, i) => {
                        const share = displaySummary ? fmtShareOfTotalPct(row.gmv, displaySummary.gmv) : null;
                        const peso = pesoGmvUf[i];
                        return (
                          <tr key={row.uf} className="transition-colors hover:bg-raised/60">
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">{row.uf}</td>
                            <td className="px-4 py-3 text-right">{peso == null ? <span className="text-ink-faint">{fmtBrlCurto(row.gmv)}</span> : <CelulaBarra valor={fmtBrlCurto(row.gmv)} peso={peso} cor="rgb(var(--tc-kpi-gmv))" />}</td>
                            <td className={TD}>{fmtNumCurto(row.orders)}</td>
                            <td className={TD}>{share != null ? fmtPctSimples(share) : "N/A"}</td>
                            <td className="px-4 py-3 text-right"><CoverageBadge level={row.coverage_level} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScrollHint>
              </Panel>

              {/* Tendencia — escopo NACIONAL dos filtros globais: o endpoint trend nao aceita filtro de UF. */}
              <Panel
                titulo="Tendência"
                semPadding
                acao={
                  <>
                    {naoSeAplicaUf}
                    <span className="text-xs font-semibold uppercase tracking-widest text-ink-faint">
                      Granularidade {trendGranularity === "day" ? "diária" : "mensal"}
                    </span>
                  </>
                }
              >
                <TableScrollHint className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-raised">
                      <tr className="text-left">
                        <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Período</th>
                        <th className={TH}>GMV</th>
                        <th className={TH}>Pedidos</th>
                        <th className={TH}>Cobertura UF</th>
                      </tr>
                    </thead>
                    <tbody className={corpoOpaco}>
                      {displayTrend.length === 0 && dataIsFresh && (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-sm text-ink-faint">
                            {unavailableSections.includes("trend")
                              ? "Dados indisponíveis para a Tendência neste momento."
                              : "Sem série de tendência para o período e filtros selecionados."}
                          </td>
                        </tr>
                      )}
                      {displayTrend.map((p) => {
                        const ausente = marcaPontoAusente(p.canais_ausentes);
                        return (
                          <tr key={p.date} className="transition-colors hover:bg-raised/60">
                            <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                              {p.label}
                              {ausente && (
                                <span data-testid="tendencia-canal-ausente" className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink ring-1 ring-inset ring-warn/30">
                                  {ausente}
                                </span>
                              )}
                            </td>
                            <td className={TD}>{fmtBrlCurto(p.gmv)}</td>
                            <td className={TD}>{fmtNumCurto(p.orders)}</td>
                            <td className={TD}>{fmtPctOrNA(p.uf_fill_pct)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScrollHint>
              </Panel>
            </div>

            {/* Marca x marketplace — escopo NACIONAL: o endpoint by-brand nao aceita filtro de UF. */}
            <Panel
              titulo="Cobertura por Marca × Canal"
              semPadding
              ajuda={displaySemCobertura.length > 0 ? `${displaySemCobertura.map((c) => (c === "tiktok" ? "TikTok Shop" : c)).join(", ")} fora: sem dado regional.` : undefined}
              acao={naoSeAplicaUf}
            >
              <TableScrollHint>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-raised text-left">
                      <SortableHeader label="Marca" column="brand" sort={brandSort.sort} onSort={brandSort.toggleSort} align="left" />
                      <SortableHeader label="Canal" column="marketplace" sort={brandSort.sort} onSort={brandSort.toggleSort} align="left" />
                      <SortableHeader label="GMV" column="gmv" sort={brandSort.sort} onSort={brandSort.toggleSort} />
                      <SortableHeader label="Pedidos" column="orders" sort={brandSort.sort} onSort={brandSort.toggleSort} />
                      <SortableHeader label="Cobertura UF" column="uf_fill_pct" sort={brandSort.sort} onSort={brandSort.toggleSort} />
                      <SortableHeader label="Cobertura Frete" column="shipping_pct" sort={brandSort.sort} onSort={brandSort.toggleSort} />
                      <th className={TH}>Alerta</th>
                    </tr>
                  </thead>
                  <tbody className={corpoOpaco}>
                    {displayByBrand.length === 0 && dataIsFresh && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-faint">
                          {unavailableSections.includes("byBrand")
                            ? "Dados indisponíveis para Cobertura por Marca × Canal neste momento."
                            : "Sem dados por marca/canal para o período e filtros selecionados."}
                        </td>
                      </tr>
                    )}
                    {brandSort.sortedRows.map((row, i) => {
                      const peso = pesoGmvMarca[i];
                      return (
                        <tr key={`${row.brand}-${row.marketplace_id}`} className="transition-colors hover:bg-raised/60">
                          <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">{row.label}</td>
                          <td className="whitespace-nowrap px-4 py-3 capitalize text-ink-muted">{row.marketplace}</td>
                          <td className="px-4 py-3 text-right">{peso == null ? <span className="text-ink-faint">{fmtBrlCurto(row.gmv)}</span> : <CelulaBarra valor={fmtBrlCurto(row.gmv)} peso={peso} cor="rgb(var(--tc-kpi-gmv))" />}</td>
                          <td className={TD}>{fmtNumCurto(row.orders)}</td>
                          <td className={TD}>{fmtPctOrNA(row.uf_fill_pct)}</td>
                          <td className={TD}>{fmtPctOrNA(row.shipping_cost_coverage_pct)}</td>
                          <td className="px-4 py-3 text-right">
                            {row.coverage_warning
                              ? <CoverageBadge level={row.coverage_level} />
                              : <span className="text-xs text-ink-faint">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScrollHint>
            </Panel>

            {/* Frete (antes 5º e 6º cartoes): a faixa tem sempre quatro. */}
            <MaisDetalhes resumo="frete">
              <div className="px-5 pb-3">
                <FreteRegioes resumo={displaySummary} />
              </div>
            </MaisDetalhes>
          </>
        )}
      </Aba>
      <KpiDrilldownDialog
        open={detalhe != null}
        onClose={() => setDetalhe(null)}
        title={detalhe ? TITULO_DETALHE[detalhe] : ""}
        icone={detalhe ? VISUAL_REGIOES[detalhe].icone : undefined}
        identidade={detalhe ? VISUAL_REGIOES[detalhe].identidade : undefined}
      >
        {detalhe && dataIsFresh && (
          <RegioesDrilldownContent
            chave={detalhe}
            resumo={displaySummary}
            ufs={dataIsFresh ? byUf : null}
            marcas={dataIsFresh ? byBrand : null}
            periodLabel={periodLabel}
            refreshedAt={displayRefreshedAt}
            // No detalhe o selo da pagina fica atras do veu: a nota de escopo completa vai no ⓘ do proprio modal.
            notaDoEscopo={[regionalScope?.scopeNote, notaDoGmv].filter(Boolean).join(" ") || undefined}
          />
        )}
      </KpiDrilldownDialog>
    </>
  );
}

export default function RegioesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <RegioesPageInner />
    </Suspense>
  );
}
