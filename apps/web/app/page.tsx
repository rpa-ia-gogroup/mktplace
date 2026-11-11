"use client";

/**
 * Gerencial V2 (Gate V2-1) — pagina flagship da Torre.
 *
 * Responsabilidade DESTE arquivo, e so' dela: filtros, identidade das
 * requisicoes (delegada a `useGerencialSources`), derivacao via helpers puros,
 * composicao dos oito blocos e o estado do unico dialogo aberto. Nenhuma regra
 * de negocio vive aqui — ela mora em `src/lib/gerencial/*`, testavel sem React.
 *
 * Narrativa vertical, uma pergunta por dobra:
 *   1. O que aconteceu?      -> cabecalho + faixa de confianca + 5 KPIs
 *   2. Como evoluiu?         -> Evolucao (dominante) | Pulso+Canais
 *   3. Onde aconteceu?       -> Saude do volume por canal + Matriz Marca x Canal
 *   4. Por que?              -> Movimentos + Concentracao por marca
 *   5. Para onde ir?         -> Fila de atencao
 *
 * INDEPENDENCIA DAS FONTES (Task A da rodada consolidada): a estrutura da pagina
 * fica SEMPRE montada. Nao existe gate global de erro nem de vazio — a versao
 * anterior envolvia quase todos os blocos num ramo de `overviewStatus.error ||
 * isEmpty`, e assim uma falha so' do `/overview` apagava evolucao, Pulso, matriz,
 * movimentos e fila mesmo com as fontes deles frescas. Agora cada bloco responde
 * exclusivamente as fontes de que depende.
 *
 * A lacuna diagnosticada no V2-0 morre por construcao: a grade da segunda dobra
 * nao usa `items-start`, cada card E' o item da grade, e nao existe `row-span`.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import { useGerencialSources } from "@/hooks/useGerencialSources";
import { mergeFilteredHref } from "@/lib/filters/nav-links";
import { fmtPeriodo } from "@/lib/filters/format";
import { toISODate } from "@/lib/filters/presets";
import type { Marketplace } from "@/lib/mock-data";
import { buildPulse } from "@/lib/executive-pulse";
import { findChannelMedian } from "@/lib/canais-channel-metrics";
import { CHANNEL_LABEL, buildKpiBand } from "@/lib/gerencial/kpi-band";
import { tendenciasDosKpis } from "@/lib/gerencial/kpi-trend";
import { buildVolumeHealth } from "@/lib/gerencial/volume-health";
import {
  buildAttentionQueue,
  buildConfidenceStrip,
  type ChannelSeriesState,
  type CommercialAttentionItem,
  type DataConfidenceItem,
} from "@/lib/gerencial/attention";
import {
  buildBrandChannelMatrix,
  buildConcentration,
  buildMovements,
  type ConcentrationEntry,
  type Movement,
} from "@/lib/gerencial/brand-matrix";
import { mergeChannelSeries, reconcileSeriesTotal, type MergedBucket } from "@/lib/gerencial/trend-series";
import { bucketDeHoje } from "@/lib/gerencial/dia-em-andamento";
import type { TrendMetric } from "@/lib/gerencial/request-key";
import { fetchBrands, fetchHojePorHora, fetchMLFulfillment, fetchShopeeFbs, type TrendGranularityRequest } from "@/lib/api-client";
import { buildQuery as queryMlFull, byClass as byClassMl } from "@/lib/ml-fulfillment";
import { buildQuery as queryShopeeFbs } from "@/lib/shopee-fbs";
import type { FullPorMarca } from "@/lib/gerencial/divisao-full";
import { isMarketplaceSelected } from "@/lib/marketplace-filter";
import { comparacaoDeHoje, tendenciaConsolidada, type HojePorHora } from "@/lib/gerencial/hoje-por-hora";
import { canalComMenores, gmvComMenores, menoresNaGerencial, notaMenores } from "@/lib/gerencial/marcas-menores-gerencial";
import { linhasDeMarcasMenores } from "@/lib/gerencial/marcas-menores-adaptador";
import { variacaoPct, type MarcasMenores } from "@/lib/marcas-menores";
import { MARCAS_MENORES_KEYS, escopoDeMarcas } from "@/lib/filters/brands";
import GerencialMarcasMenores from "./GerencialMarcasMenores";
import { Produtos as ProdutosMenores } from "@/components/marcas-menores/Blocos";
import { useProdutosMarcasMenores } from "@/hooks/useProdutosMarcasMenores";
import { fmtCompacto } from "@/lib/metas";
import { fetchMarcasMenores, type BrandRow } from "@/lib/api-client";
import { KPI_META, type KpiKind } from "@/lib/kpi-drilldown";
import { IDENTIDADE_DO_KPI } from "@/lib/gerencial/kpi-identidade";

import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import KpiDrilldownContent from "@/components/KpiDrilldownContent";
import InsightDrilldownContent, { type PulseView } from "@/components/InsightDrilldownContent";
import ChannelComparisonDialogContent from "@/components/ChannelComparisonDialogContent";
import GerencialHeader from "@/components/gerencial/GerencialHeader";
import ConfidenceStrip from "@/components/gerencial/ConfidenceStrip";
import KpiBand from "@/components/gerencial/KpiBand";
import EvolutionCard from "@/components/gerencial/EvolutionCard";
import PulseChannelsColumn from "@/components/gerencial/PulseChannelsColumn";
import VolumeHealthCard from "@/components/gerencial/VolumeHealthCard";
import BrandChannelMatrix, { cellKey, type SignalsState } from "@/components/gerencial/BrandChannelMatrix";
import TopProdutosMarca from "@/components/gerencial/TopProdutosMarca";
import CxResumo, { notasDoTile } from "@/components/gerencial/CxResumo";
import CxDrilldownContent from "@/components/gerencial/CxDrilldown";
import { ROTULO_INDICADOR, hrefCx, type IndicadorCx, type JanelaDias, type ResumoCx } from "@/lib/cx";
import MovementsPanels from "@/components/gerencial/MovementsPanels";
import AttentionQueue from "@/components/gerencial/AttentionQueue";
import MetaHero from "@/components/gerencial/MetaHero";
import MarcasMeta, { type MetaDaMarca } from "@/components/gerencial/MarcasMeta";
import { useMetasDoMes } from "@/hooks/useMetasDoMes";
import {
  avisoQueAfetaOGmv,
  celulasDoEscopo,
  diaDaMeta,
  diasComDadoNoMes,
  mesDaMeta,
  metaDoEscopo,
  progressoMeta,
  realizadoDoEscopo,
  ultimoDiaComDado,
} from "@/lib/gerencial/meta-progress";
import {
  escopoTemCurva,
  fracaoDoEscopo,
  metaDiaNormalDoEscopo,
  progressoDoDia,
  resumoSemDado,
} from "@/lib/metas-curva";
import { MARCAS, hojeBrt } from "@/lib/metas";
import {
  ChannelSeriesDrilldownContent,
  CommercialAttentionDrilldownContent,
  ConcentrationDrilldownContent,
  ConfidenceDrilldownContent,
  DataWarningDrilldownContent,
  MatrixCellUnavailableContent,
  MatrixChannelDrilldownContent,
  MovementDrilldownContent,
  TrendBucketDrilldownContent,
  VolumeHealthDrilldownContent,
} from "@/components/gerencial/GerencialDrilldowns";

/** Rotulo do grao efetivo, usado no contexto do drill-down do ponto. */
const GRAIN_LABEL: Record<"day" | "week" | "month", string> = {
  day: "grão diário",
  week: "grão semanal",
  month: "grão mensal",
};

/** Todo drill-down da pagina passa por UM shell. `view` decide o conteudo. */
type DialogView =
  | { kind: "kpi"; key: KpiKind }
  | { kind: "confidence" }
  | { kind: "pulse"; view: PulseView }
  | { kind: "bucket"; date: string }
  | { kind: "channelSeries"; channel: Marketplace }
  | { kind: "volume"; channel: Marketplace }
  | { kind: "matrix"; brand: string; channel: Marketplace }
  | { kind: "matrixChannel"; channel: Marketplace }
  | { kind: "movement"; movement: Movement }
  | { kind: "concentration"; entry: ConcentrationEntry }
  | { kind: "commercial"; item: CommercialAttentionItem }
  | { kind: "dataWarning"; item: DataConfidenceItem }
  | { kind: "cx"; indicador: IndicadorCx; resumo: ResumoCx; geradoEm: string; dias: JanelaDias };

function GerencialComGrandes() {
  // GERENCIAL-METAS-1: abre no mes corrente, porque e' nele que a meta ainda
  // pode ser decidida (ritmo, projecao e quanto falta por dia). O mes fechado
  // continua a um clique no seletor de periodo.
  const [filtersRaw, setFilters] = useGlobalFilters({ defaultPreset: "mes_atual", defaultCompare: true });
  // Marcas grandes (Data Mart) e menores (Bling) vem no mesmo filtro; o resto da pagina so' ve as grandes
  // (`filters.brands` vazio = todas as grandes) e as menores entram por `menores`, sem meta.
  const escopo = escopoDeMarcas(filtersRaw.brands);
  const grandesKey = escopo.grandes.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- grandesKey cobre a lista
  const filters = useMemo(() => ({ ...filtersRaw, brands: escopo.grandes }), [filtersRaw, grandesKey]);
  const searchParams = useSearchParams();

  // Metrica do grafico: estado LOCAL. `/trend` entrega GMV e Pedidos na mesma
  // resposta, entao alternar nao dispara requisicao alguma nem fecha o dialogo.
  const [metric, setMetric] = useState<TrendMetric>("gmv");
  // Granularidade PEDIDA (Gate V2-2): estado local que entra SOMENTE na
  // identidade das series de `/trend`. Trocar o grao refaz as chamadas de
  // serie dos canais selecionados e nao toca as outras cinco fontes.
  const [granularity, setGranularity] = useState<TrendGranularityRequest>("auto");
  const [dialog, setDialog] = useState<DialogView | null>(null);

  const sources = useGerencialSources({
    channels: filters.channels,
    brands: filters.brands,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    compare: filters.compare,
    granularity,
  });

  /**
   * Task G — identidade dos filtros EFETIVOS. O dialogo fecha por efeito quando
   * ela muda, seja a mudanca vinda dos controles da pagina, do back/forward do
   * navegador ou de uma URL colada. `applyFilters` sozinho nao cobria esses dois
   * ultimos casos, e um detalhe do escopo anterior podia sobreviver.
   */
  const filterIdentity = [
    filters.channels.join(","),
    filtersRaw.brands.join(","),
    filters.dateFrom,
    filters.dateTo,
    String(filters.compare),
  ].join("|");

  useEffect(() => {
    setDialog(null);
  }, [filterIdentity]);

  // Retry inicia uma nova resolucao de todas as fontes: o detalhe aberto era do
  // ciclo anterior.
  useEffect(() => {
    setDialog(null);
  }, [sources.retryKey]);

  const periodLabel = fmtPeriodo(filters.dateFrom, filters.dateTo);
  // POPUPS-1 — o dia em andamento contra o dia anterior INTEIRO nao e'
  // comparacao: 1.494 pedidos ate' as 21h contra 4,4 mil de um dia fechado
  // dariam "-66%" por causa do relogio, nao do negocio. Sem base justa, sem
  // variacao — em cards, meta e detalhe.
  const diaEmAndamento = filters.dateFrom === filters.dateTo && filters.dateTo === toISODate(new Date());
  const comparar = filters.compare && !diaEmAndamento;
  const buildHref = useMemo(() => (href: string) => mergeFilteredHref(href, searchParams), [searchParams]);
  const brandHref = useCallback((brand: string) => buildHref(`/brand/${brand}`), [buildHref]);

  // ---- derivacoes puras -------------------------------------------------
  const overview = sources.overview.data;
  const kpis = useMemo(
    () => buildKpiBand(overview, filters.channels, comparar),
    [overview, filters.channels, comparar],
  );

  const merged = useMemo(
    // A granularidade PEDIDA entra no merge para que um grao explicito ignorado
    // pela API seja tratado como contrato incompativel, e nao como sucesso.
    () => mergeChannelSeries(sources.series, filters.channels, metric, granularity),
    [sources.series, filters.channels, metric, granularity],
  );
  // KPIS-COMPARACAO-1 — tendencia dos cards: GMV e Pedidos SEMPRE, independente
  // da metrica escolhida no grafico. `/trend` ja' traz as duas na mesma
  // resposta, entao isto nao dispara requisicao nenhuma.
  const tendencias = useMemo(
    () =>
      tendenciasDosKpis(
        mergeChannelSeries(sources.series, filters.channels, "gmv", granularity),
        mergeChannelSeries(sources.series, filters.channels, "orders", granularity),
      ),
    [sources.series, filters.channels, granularity],
  );
  // GERENCIAL-D0 — hoje no grafico, com o numero do filtro "Hoje". Fica FORA de
  // `merged`: nao entra na soma, na reconciliacao, nas tendencias nem na meta.
  const hojeNoGrafico = useMemo(
    () => bucketDeHoje(sources.seriesHoje, filters.channels, metric, sources.hoje),
    [sources.seriesHoje, filters.channels, metric, sources.hoje],
  );
  const reconciliation = useMemo(
    () =>
      reconcileSeriesTotal(
        merged,
        metric,
        overview ? (metric === "gmv" ? overview.gmv : overview.orders) : null,
      ),
    [merged, metric, overview],
  );

  const pulse = useMemo(() => buildPulse(sources.executiveSummary.data), [sources.executiveSummary.data]);
  const queue = useMemo(() => buildAttentionQueue(sources.executiveSummary.data), [sources.executiveSummary.data]);

  // Task F — a faixa afirma DISPONIBILIDADE DE SERIE, derivada das series por
  // canal, nunca "cobertura" inferida de `gmv != null`.
  const seriesStates = useMemo<ChannelSeriesState[]>(
    () => sources.series.map((s) => ({ channel: s.channel, status: s.status, pointCount: s.points.length })),
    [sources.series],
  );
  const confidence = useMemo(
    () => buildConfidenceStrip(seriesStates, queue, filters.channels, sources.executiveSummary.status.fresh),
    [seriesStates, queue, filters.channels, sources.executiveSummary.status.fresh],
  );

  const volumeRows = useMemo(
    () =>
      buildVolumeHealth({
        kpis: sources.quality.data?.kpis ?? null,
        brands: sources.quality.data?.brands ?? [],
        channels: filters.channels,
        gmvByChannel: {
          tiktok: overview?.tiktok_gmv ?? null,
          ml: overview?.ml_gmv ?? null,
          shopee: overview?.shopee_gmv ?? null,
        },
      }),
    [sources.quality.data, filters.channels, overview],
  );

  const brands = sources.brands.data ?? [];
  const movements = useMemo(() => buildMovements(brands, filters.channels), [brands, filters.channels]);
  const concentration = useMemo(() => buildConcentration(brands), [brands]);

  // Task B.4 / C — sinais vem de `/canais`, com estado PROPRIO: a matriz de GMV
  // (que vem de `/brands`) nao depende deles para existir.
  const signalsByCell = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of sources.canais.data?.channelRows ?? []) {
      if (row.signals.length > 0) map[cellKey(row.brand, row.channel)] = row.signals;
    }
    return map;
  }, [sources.canais.data]);

  // ---- metas (GERENCIAL-METAS-1 + METAS-DIARIAS-1) -----------------------
  // Fonte PROPRIA (`useMetasDoMes`), fora do hook das fontes do Data Mart: a
  // meta falhar nao apaga nenhum outro bloco. Periodo de um dia so' ("Hoje")
  // compara com a META DO DIA; mes inteiro ou mes corrente ate' ontem, com a
  // meta do mes. O realizado so' conta marca x canal que tem meta, e precisa
  // de `/brands` fresco: sem ele, "sem linha" nao quer dizer "sem venda".
  const hoje = useMemo(() => hojeBrt(), []);

  // Receita Full x normal: so' a PROPORCAO vem das fatos de modalidade; o valor
  // e' o GMV do overview (barra unica por canal no MetaHero). Falha em qualquer uma = sem divisao.
  const [shareFull, setShareFull] = useState<{ ml: number | null; shopee: number | null } | null>(null);
  useEffect(() => {
    setShareFull(null);
    if (sources.demoMode) return;
    const ac = new AbortController();
    const { dateFrom: from, dateTo, brands: marcas, channels } = filters;
    const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
    // A fato da Shopee so' publica dia fechado (D-1): a proporcao vem ate' ontem.
    const toShopee = dateTo < ontem ? dateTo : ontem;
    const ml = isMarketplaceSelected(channels, "ml")
      ? fetchMLFulfillment(queryMlFull({ from, to: dateTo, brands: marcas }), ac.signal).then((r) => r.share_full_gmv)
      : null;
    const shopee =
      isMarketplaceSelected(channels, "shopee") && from <= toShopee
        ? fetchShopeeFbs(queryShopeeFbs({ from, to: toShopee, brands: marcas }), ac.signal).then((r) =>
            "shares" in r ? r.shares.share_fbs_gmv : null,
          )
        : null;
    Promise.all([ml, shopee])
      .then(([m, sh]) => setShareFull({ ml: m, shopee: sh }))
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterIdentity cobre os filtros
  }, [filterIdentity, hoje, sources.demoMode, sources.retryKey]);
  // A mesma proporcao Full, POR MARCA, para o card de Marcas e os detalhes de GMV e
  // Pedidos. A rota do ML nao abre por marca: uma consulta por marca. Shopee vem do
  // `by_brand` (Kokeshi fora da esteira = sem dado). As fatos so' tem dia fechado:
  // periodo que passa de ontem (ou so' hoje) usa a medida ate' ontem (`aproximado`);
  // so' hoje o card de Marcas segue com uma barra so', como antes.
  const [fullPorMarca, setFullPorMarca] = useState<FullPorMarca | null>(null);
  const [fullJanela, setFullJanela] = useState({ aproximado: false, soHoje: false });
  useEffect(() => {
    setFullPorMarca(null);
    const { dateFrom, dateTo, brands: marcas, channels } = filters;
    const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
    const ate = dateTo < ontem ? dateTo : ontem;
    const soHoje = dateFrom > ate;
    const from = soHoje ? ate : dateFrom;
    const aproximado = from !== dateFrom || ate !== dateTo;
    // So' TikTok selecionado: nao ha Full a mostrar, fica a barra unica.
    const temFull = isMarketplaceSelected(channels, "ml") || isMarketplaceSelected(channels, "shopee");
    if (sources.demoMode || !temFull) return;
    const ac = new AbortController();
    const ids = marcas.length > 0 ? marcas : MARCAS.map((m) => m.id);
    const ml = isMarketplaceSelected(channels, "ml")
      ? Promise.all(
          ids.map((b) =>
            fetchMLFulfillment(queryMlFull({ from, to: ate, brands: [b] }), ac.signal).then(
              (r) =>
                [b, r.share_full_gmv, r.share_full_orders == null ? null : (byClassMl(r, "full")?.paid_orders ?? 0)] as const,
            ),
          ),
        )
      : Promise.resolve([] as (readonly [string, number | null, number | null])[]);
    const shopee = isMarketplaceSelected(channels, "shopee")
      ? fetchShopeeFbs(queryShopeeFbs({ from, to: ate }), ac.signal).then((r) => ("by_brand" in r ? r.by_brand : []))
      : Promise.resolve([]);
    // Pedidos da marca na janela da medida (so' quando ela nao e' o periodo todo).
    const base = aproximado
      ? fetchBrands(channels, undefined, { brands: marcas, dateFrom: from, dateTo: ate, compare: false }).then((r) =>
          r.live ? r.data : null,
        )
      : Promise.resolve(null);
    Promise.all([ml, shopee, base])
      .then(([m, sh, bs]) => {
        const mapa: FullPorMarca = {};
        for (const [b, s, n] of m) {
          const e = (mapa[b] ??= {});
          e.ml = s;
          if (n != null) e.pedFull = (e.pedFull ?? 0) + n;
        }
        for (const r of sh) {
          const e = (mapa[r.brand] ??= {});
          e.shopee = r.share_fbs_gmv;
          if (r.share_fbs_orders != null) e.pedFull = (e.pedFull ?? 0) + Math.round(r.eligible_orders * r.share_fbs_orders);
        }
        for (const b of bs ?? []) if (mapa[b.brand]) mapa[b.brand].pedBase = b.orders;
        setFullJanela({ aproximado, soHoje });
        setFullPorMarca(mapa);
      })
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterIdentity cobre os filtros
  }, [filterIdentity, hoje, sources.demoMode, sources.retryKey]);
  // "Hoje" (VENDAS-POR-HORA-1): a comparacao justa e' com ontem ATE' A MESMA
  // HORA, nos cards de sempre, e a tendencia de fechamento por marca. Sem a
  // tabela por hora publicada, os cards seguem sem comparacao, como antes.
  const [hojePorHora, setHojePorHora] = useState<HojePorHora | null>(null);
  useEffect(() => {
    setHojePorHora(null);
    if (!diaEmAndamento || sources.demoMode) return;
    let vivo = true;
    fetchHojePorHora(filters.channels, filters.brands).then((d) => {
      if (vivo) setHojePorHora(d);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterIdentity cobre os filtros
  }, [filterIdentity, diaEmAndamento, sources.demoMode, sources.retryKey]);
  const compHoje = filters.compare ? comparacaoDeHoje(hojePorHora) : null;
  const tendenciaDoDia = useMemo(
    () => (hojePorHora?.disponivel ? Object.fromEntries((hojePorHora.por_marca ?? []).map((m) => [m.brand, m])) : null),
    [hojePorHora],
  );
  const variacaoDoCanal = (atual: number | null | undefined, antes: number | null | undefined) =>
    atual != null && antes != null && antes > 0 ? ((atual - antes) / antes) * 100 : null;
  // Marcas menores (Bling): somam no GMV do topo, na rosca e nas marcas, sem meta. Carregam EM PARALELO e
  // sozinhas: Bling lento ou fora nao atrasa nem apaga o resto (so o aviso no (i)). So a lista de pedidos.
  const querMenores = escopo.temMenores && !sources.demoMode && filters.channels.some((c) => c === "shopee" || c === "tiktok");
  const [menoresBruto, setMenoresBruto] = useState<MarcasMenores | null | undefined>(undefined);
  useEffect(() => {
    setMenoresBruto(undefined);
    if (!querMenores) return;
    let vivo = true;
    fetchMarcasMenores(filters.dateFrom, filters.dateTo).then((d) => vivo && setMenoresBruto(d));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as datas e o filtro de canal/marca cobrem o recorte
  }, [filters.dateFrom, filters.dateTo, querMenores, sources.retryKey]);
  const menores = useMemo(
    () => menoresNaGerencial(menoresBruto, filters.channels, querMenores, escopo.menores),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a lista de menores vem do filtro (filtersRaw.brands)
    [menoresBruto, filters.channels, querMenores, filtersRaw.brands.join(",")],
  );
  const menoresOk = menores.estado === "ok" ? menores : null;
  const topo = gmvComMenores(
    {
      gmv: overview?.gmv ?? null,
      prevGmv: compHoje ? null : overview?.prev_gmv ?? null,
      momPct: compHoje ? compHoje.gmvPct : overview?.gmv_mom_pct ?? null,
    },
    menoresOk,
    comparar,
  );
  const canalMenores = (c: "tiktok" | "ml" | "shopee") =>
    canalComMenores(
      c,
      overview?.[`${c}_gmv`],
      overview?.[`prev_${c}_gmv`],
      compHoje ? compHoje.porCanal[c] ?? null : variacaoDoCanal(overview?.[`${c}_gmv`], overview?.[`prev_${c}_gmv`]),
      menoresOk,
      comparar,
    );
  const canaisComMenores = { tiktok: canalMenores("tiktok"), ml: canalMenores("ml"), shopee: canalMenores("shopee") };
  const notaDasMenores = notaMenores(menores, topo.variacaoInclui, diaEmAndamento, fmtCompacto);
  // Linha VISIVEL sob o GMV: o topo (com menores) e a barra da meta (so marcas com meta) mostram numeros diferentes,
  // e Bling fora deixa o GMV menor: aviso de dado incompleto nunca fica so no (i).
  const linhaMenores =
    menores.estado === "ok" && menores.total > 0
      ? { texto: `inclui ${fmtCompacto(menores.total)} de marcas menores, sem meta`, aviso: false }
      : menores.estado === "indisponivel"
        ? { texto: "sem marcas menores (Bling indisponível)", aviso: true }
        : menores.estado === "carregando"
          ? { texto: "somando marcas menores…", aviso: false }
          : null;
  const brandsComMenores = useMemo<BrandRow[]>(
    () => [
      ...brands,
      ...linhasDeMarcasMenores(menoresOk?.marcas ?? [], comparar),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- menoresOk muda so com menores
    [brands, menores, comparar],
  );
  // Marca x Canal: as menores (Bling) entram nas colunas TikTok e Shopee (ML fica sem dado) e no total, na mesma
  // matriz das grandes. Sem meta, sem sinais; a celula delas nao abre o detalhe do Data Mart.
  const matrix = useMemo(
    () => buildBrandChannelMatrix(brandsComMenores, filters.channels, comparar),
    [brandsComMenores, filters.channels, comparar],
  );
  // Mais vendidos das menores (Bling): so' com marca escolhida no filtro (em "Todas" nao pesa nem lota a tela).
  const produtosMenoresAtivo = filtersRaw.brands.length > 0 && escopo.temMenores && menoresOk != null;
  const prodMenores = useProdutosMarcasMenores(filters.dateFrom, filters.dateTo, produtosMenoresAtivo, {
    canais: filters.channels,
    marcas: escopo.menores,
  });
  const kpisDaTela = useMemo(() => {
    if (!compHoje) return kpis;
    const ref = (pct: number | null) =>
      pct != null ? { deltaPct: pct, deltaTone: "higher_is_better" as const, reference: compHoje.rotuloCurto } : {};
    return kpis.map((k) =>
      k.key === "orders" ? { ...k, ...ref(compHoje.pedidosPct) } : k.key === "avg_ticket" ? { ...k, ...ref(compHoje.ticketPct) } : k,
    );
  }, [kpis, compHoje]);
  // Pedidos e Ticket vem so' das marcas grandes (o overview); com as menores no GMV do topo, GMV / Pedidos nao daria o
  // Ticket. O aviso fica VISIVEL logo sob a faixa, em cor de aviso, nao so' no (i).
  const avisoKpisSoGrandes = menoresOk != null && menoresOk.total > 0;
  const diaMeta = diaDaMeta(filters.dateFrom, filters.dateTo, hoje);
  const mesMeta = diaMeta ? null : mesDaMeta(filters.dateFrom, filters.dateTo, hoje);
  const metas = useMetasDoMes(mesMeta ?? diaMeta?.slice(0, 7) ?? null);
  const celulasEscopo = useMemo(
    () => celulasDoEscopo(metas.celulas, filters.channels, filters.brands),
    [metas.celulas, filters.channels, filters.brands],
  );
  const metaEscopo = useMemo(
    () => metaDoEscopo(metas.celulas, filters.channels, filters.brands),
    [metas.celulas, filters.channels, filters.brands],
  );
  const realizadoEscopo = useMemo(() => realizadoDoEscopo(brands, celulasEscopo), [brands, celulasEscopo]);
  const canaisForaDaMeta = filters.channels.filter((c) => !celulasEscopo.some((x) => x.channel === c));
  const comCurva = mesMeta ? escopoTemCurva(celulasEscopo, mesMeta) : false;
  const ultimoDia = useMemo(
    () => ultimoDiaComDado(merged.buckets, merged.granularity),
    [merged.buckets, merged.granularity],
  );
  // Em modo demonstracao o GMV e' exemplo: atingimento contra meta real seria
  // um numero falso com cara de decisao.
  const metaAplicavel = metas.status === "fresh" && !sources.demoMode && sources.brands.status.fresh;
  const progresso = useMemo(
    () =>
      metaAplicavel && mesMeta
        ? progressoMeta({
            meta: metaEscopo.total,
            realizado: realizadoEscopo.total,
            mes: mesMeta,
            hoje,
            ultimoDia,
            fracaoAte: fracaoDoEscopo(celulasEscopo, mesMeta),
            metaDiaNormal: metaDiaNormalDoEscopo(celulasEscopo, mesMeta),
          })
        : null,
    [metaAplicavel, mesMeta, metaEscopo.total, realizadoEscopo.total, celulasEscopo, hoje, ultimoDia],
  );
  const progressoDia = useMemo(
    () =>
      metaAplicavel && diaMeta ? progressoDoDia({ celulas: celulasEscopo, linhas: brands, dia: diaMeta, hoje }) : null,
    [metaAplicavel, diaMeta, celulasEscopo, brands, hoje],
  );
  const progressoPorMarca = useMemo(() => {
    const mapa: Record<string, MetaDaMarca | null> = {};
    if (progressoDia) return progressoDia.porMarca;
    if (!metaAplicavel || !mesMeta) return mapa;
    // Marca com meta e SEM linha em `/brands` (nada vendido no recorte) entra
    // com realizado zero: e' o caso mais urgente, nao pode sumir.
    for (const [id, meta] of Object.entries(metaEscopo.porMarca)) {
      const p = progressoMeta({
        meta,
        realizado: realizadoEscopo.porMarca[id] ?? 0,
        mes: mesMeta,
        hoje,
        ultimoDia,
        fracaoAte: fracaoDoEscopo(
          celulasEscopo.filter((c) => c.brand === id),
          mesMeta,
        ),
        metaDiaNormal: metaDiaNormalDoEscopo(
          celulasEscopo.filter((c) => c.brand === id),
          mesMeta,
        ),
      });
      mapa[id] = p && { ...p, canais: realizadoEscopo.canaisPorMarca[id] ?? [] };
    }
    return mapa;
  }, [progressoDia, metaAplicavel, mesMeta, metaEscopo.porMarca, realizadoEscopo, celulasEscopo, hoje, ultimoDia]);
  // Topo: a soma das tendencias dos cards, so' no "Hoje" com a meta do dia.
  const tendenciaTopo = useMemo(
    () => (diaEmAndamento && progressoDia ? tendenciaConsolidada(tendenciaDoDia, progressoPorMarca) : null),
    [diaEmAndamento, progressoDia, tendenciaDoDia, progressoPorMarca],
  );
  // Mes atual: o fechamento de cada marca pela MESMA projecao do heroi (com
  // meta). Marca sem meta: o GMV dos canais filtrados no ritmo linear, sem %.
  const tendenciaDoMes = useMemo(() => {
    if (!metaAplicavel || !mesMeta || mesMeta !== hoje.slice(0, 7)) return null;
    const mapa: Record<string, number> = {};
    const linear = fracaoDoEscopo([], mesMeta)(diasComDadoNoMes(mesMeta, hoje, ultimoDia));
    for (const b of brands) {
      if (linear > 0 && b.total_gmv > 0 && !(b.brand in metaEscopo.porMarca)) mapa[b.brand] = b.total_gmv / linear;
    }
    for (const [id, p] of Object.entries(progressoPorMarca)) if (p?.projecao != null) mapa[id] = p.projecao;
    return mapa;
  }, [metaAplicavel, mesMeta, hoje, ultimoDia, brands, metaEscopo.porMarca, progressoPorMarca]);
  // A meta so' e' lida com `/brands`: enquanto ele carrega (ou falha), o bloco
  // diz isso em vez de "nenhuma meta definida".
  const metasStatusTela: "loading" | "error" | "fresh" =
    metas.status === "idle"
      ? "fresh"
      : metas.status !== "fresh"
        ? metas.status
        : sources.brands.status.fresh || sources.demoMode
          ? "fresh"
          : sources.brands.status.error
            ? "error"
            : "loading";
  const mesDasMetas = mesMeta ?? diaMeta?.slice(0, 7) ?? null;
  const avisoDeDado = avisoQueAfetaOGmv(queue.dataConfidence);


  const signalsState: SignalsState = sources.canais.status.loading
    ? "loading"
    : sources.canais.status.error
      ? "error"
      : "fresh";

  // ---- estados por bloco --------------------------------------------------
  const overviewStatus = sources.overview.status;
  // `live` so' existe quando o overview esta fresco; enquanto nao estiver, o
  // cabecalho nao afirma nem live nem demonstracao.
  const headerLive = overviewStatus.fresh ? sources.overview.live : null;

  // Task A, item 7 — o anuncio nao pode dizer "Dados carregados" havendo fonte
  // em erro. Nomear quais falharam e' mais util que um estado binario.
  const failedSources = [
    overviewStatus.error && "indicadores do período",
    sources.brands.status.error && "desempenho por marca",
    sources.executiveSummary.status.error && "resumo executivo",
    sources.quality.status.error && "qualidade",
    sources.canais.status.error && "sinais de canal",
    merged.failedChannels.length > 0 &&
      `série de ${merged.failedChannels.map((c) => CHANNEL_LABEL[c]).join(", ")}`,
  ].filter(Boolean) as string[];

  const liveAnnouncement = sources.anyLoading
    ? "Carregando dados da Visão Gerencial."
    : failedSources.length > 0
      ? `Dados carregados parcialmente. Indisponível: ${failedSources.join("; ")}.`
      : "Dados carregados.";

  const openBucket = useCallback((date: string) => setDialog({ kind: "bucket", date }), []);
  // GERENCIAL-D0: o dia em andamento nao tem detalhe de bucket (esta' fora do
  // periodo); clicar nele abre a propria visao "Hoje".
  const selecionarBucket = useCallback(
    (date: string) => {
      if (date === sources.hoje) {
        setDialog(null);
        setFilters({ dateFrom: date, dateTo: date });
        return;
      }
      openBucket(date);
    },
    [openBucket, setFilters, sources.hoje],
  );
  const pinRange = useCallback(
    (dateFrom: string, dateTo: string) => {
      setDialog(null);
      // Somente o intervalo muda; canais, marcas e comparacao seguem preservados.
      setFilters({ dateFrom, dateTo });
    },
    [setFilters],
  );

  // ---- titulo e conteudo do dialogo unico --------------------------------
  const dialogTitle = (() => {
    if (!dialog) return "";
    switch (dialog.kind) {
      case "kpi":
        return KPI_META[dialog.key].label;
      case "confidence":
        return "Confiança no dado";
      case "bucket": {
        const b = merged.buckets.find((x) => x.date === dialog.date);
        return b ? `Detalhe de ${b.label}` : "Detalhe do período";
      }
      case "channelSeries":
        return `Série — ${CHANNEL_LABEL[dialog.channel]}`;
      case "volume":
        return `Saúde do volume — ${CHANNEL_LABEL[dialog.channel]}`;
      case "matrix":
        return `${dialog.brand.toUpperCase()} em ${CHANNEL_LABEL[dialog.channel]}`;
      case "matrixChannel":
        return `${CHANNEL_LABEL[dialog.channel]} — distribuição por marca`;
      case "movement":
        return `${dialog.movement.brandLabel} — ${CHANNEL_LABEL[dialog.movement.channel]}`;
      case "concentration":
        return `${dialog.entry.label} — concentração`;
      case "commercial":
        return dialog.item.title;
      case "dataWarning":
        return "Aviso de confiança no dado";
      case "cx":
        return `${ROTULO_INDICADOR[dialog.indicador]} por marca · Shopee`;
      case "pulse": {
        if (dialog.view.key) {
          const g =
            pulse.commercial.find((x) => x.key === dialog.view.key) ??
            pulse.dataConfidence.groups.find((x) => x.key === dialog.view.key);
          if (g) return g.title;
        }
        return "Todos os sinais do período";
      }
    }
  })();

  const matrixRow =
    dialog?.kind === "matrix"
      ? sources.canais.data?.channelRows.find(
          (r) => r.brand === dialog.brand && r.channel === dialog.channel,
        ) ?? null
      : null;

  const bucket: MergedBucket | null =
    dialog?.kind === "bucket" ? merged.buckets.find((b) => b.date === dialog.date) ?? null : null;

  // Canal realcado no grafico enquanto o detalhe da serie esta aberto.
  const highlightedChannel = dialog?.kind === "channelSeries" ? dialog.channel : null;

  // O detalhe de um KPI herda o icone e a cor do cartao que o abriu.
  const kpiDoDialogo = dialog?.kind === "kpi" ? IDENTIDADE_DO_KPI[dialog.key] : undefined;

  return (
    <div className="w-full px-4 py-4 flex flex-col gap-3">
      <GerencialHeader
        periodLabel={periodLabel}
        refreshedAt={sources.overview.refreshedAt}
        live={headerLive}
        loading={sources.anyLoading}
      >
        <GlobalFilterControls filters={filtersRaw} onChange={setFilters} loading={sources.anyLoading} />
      </GerencialHeader>

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </span>

      {/* ---- Dobra 1: vamos bater a meta? (GERENCIAL-METAS-1) ----
          Nenhum gate global daqui para baixo: cada bloco decide sozinho. */}
      <MetaHero
        periodLabel={periodLabel}
        loading={overviewStatus.loading}
        error={overviewStatus.error}
        gmv={topo.gmv}
        prevGmv={topo.prevGmv}
        momPct={topo.momPct}
        notaMenores={notaDasMenores}
        linhaMenores={linhaMenores}
        compareActive={comparar || compHoje != null}
        rotuloComparacao={compHoje?.rotulo ?? null}
        detalheComparacao={compHoje?.detalhe ?? null}
        channels={filters.channels}
        gmvByChannel={{
          tiktok: canaisComMenores.tiktok.gmv,
          ml: canaisComMenores.ml.gmv,
          shopee: canaisComMenores.shopee.gmv,
        }}
        varGmvByChannel={{
          tiktok: canaisComMenores.tiktok.variacao,
          ml: canaisComMenores.ml.variacao,
          shopee: canaisComMenores.shopee.variacao,
        }}
        mesMeta={mesMeta}
        diaMeta={diaMeta}
        hoje={hoje}
        metasStatus={metasStatusTela}
        onRetryMetas={metas.status === "error" ? metas.tentarDeNovo : sources.retry}
        progresso={progresso}
        comCurva={comCurva}
        progressoDia={progressoDia}
        semDado={progressoDia ? resumoSemDado(progressoDia.semDado, celulasEscopo) : []}
        canaisForaDaMeta={celulasEscopo.length > 0 ? canaisForaDaMeta : []}
        ultimoDia={ultimoDia}
        aviso={avisoDeDado ? { texto: avisoDeDado.message, onOpen: () => setDialog({ kind: "confidence" }) } : null}
        metasHref={mesDasMetas ? `/metas?mes=${mesDasMetas}` : "/metas"}
        onOpenGmv={() => setDialog({ kind: "kpi", key: "gmv" })}
        shareFull={shareFull}
        tendenciaDoDia={tendenciaTopo}
      />

      <KpiBand
        kpis={kpisDaTela}
        loading={overviewStatus.loading}
        error={overviewStatus.error}
        onOpen={(key) => setDialog({ kind: "kpi", key })}
        onRetry={sources.retry}
        semGmv
        tendencias={tendencias}
      />
      {avisoKpisSoGrandes && (
        <p className="-mt-1 text-xs font-semibold text-warn-ink" role="status">
          Pedidos e Ticket: só marcas grandes (sem as menores).
        </p>
      )}

      {/* ---- Dobra 2: como evoluiu / onde ----
          12 colunas: 7/5 a partir de `lg`. SEM `items-start` e SEM `row-span`:
          os dois itens esticam juntos. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7">
          <EvolutionCard
            merged={merged}
            metric={metric}
            onMetricChange={setMetric}
            granularity={granularity}
            onGranularityChange={setGranularity}
            reconciliation={reconciliation}
            compareActive={comparar}
            loading={merged.loadingChannels.length > 0 && merged.availableChannels.length === 0}
            onSelectBucket={selecionarBucket}
            bucketHoje={hojeNoGrafico}
            onOpenChannelSeries={(channel) => setDialog({ kind: "channelSeries", channel })}
            highlightedChannel={highlightedChannel}
          />
        </div>
        <div className="lg:col-span-5">
          <MarcasMeta
            brands={brandsComMenores}
            semMeta={menoresOk?.marcas.map((m) => m.brand)}
            channels={filters.channels}
            progressoPorMarca={progressoPorMarca}
            rotuloMeta={progressoDia ? "da meta do dia" : "da meta"}
            compareActive={comparar}
            loading={sources.brands.status.loading}
            error={sources.brands.status.error}
            brandHref={brandHref}
            tendenciaDoDia={tendenciaDoDia}
            tendenciaDoMes={tendenciaDoMes}
            fullPorMarca={fullJanela.soHoje ? null : fullPorMarca}
          />
        </div>
      </div>

      {/* CX so' existe para a Shopee: sem ela no filtro de canal, a secao some. */}
      {isMarketplaceSelected(filters.channels, "shopee") && (
        <CxResumo
          brands={filters.brands}
          // o CX segue o periodo quando ele e' 7, 30 ou 90 dias fechados; senao, 30 (o subtitulo avisa)
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onOpen={(indicador, resumo, geradoEm, dias) => setDialog({ kind: "cx", indicador, resumo, geradoEm, dias })}
        />
      )}

      {/* ---- Dobra 3: marca x canal ---- */}
      <BrandChannelMatrix
        matrix={matrix}
        loading={sources.brands.status.loading}
        error={sources.brands.status.error}
        signalsByCell={signalsByCell}
        signalsState={signalsState}
        onOpenCell={(brand, channel) => {
          if (!MARCAS_MENORES_KEYS.includes(brand)) setDialog({ kind: "matrix", brand, channel });
        }}
        onOpenChannelHeader={(channel) => setDialog({ kind: "matrixChannel", channel })}
        brandHref={(b) => (MARCAS_MENORES_KEYS.includes(b) ? "/marcas-menores" : brandHref(b))}
        onRetry={sources.retry}
      />

      <TopProdutosMarca
        channels={filters.channels}
        brands={filters.brands}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        compare={filters.compare}
      />

      {produtosMenoresAtivo && (
        <ProdutosMenores
          r={prodMenores.produtos}
          desistiu={prodMenores.desistiu}
          onTentar={prodMenores.tentar}
          titulo="Mais vendidos · marcas menores"
          ids={escopo.menores}
        />
      )}

      {/* ---- Mais detalhes (GERENCIAL-METAS-1) ----
          Profundidade sob demanda: tudo o que a V2 mostrava continua aqui,
          cada bloco com a propria fonte e o proprio erro. Fechado por padrao
          para a primeira dobra responder sozinha. */}
      <details className="group rounded-xl border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span>
            Mais detalhes
            <span className="ml-2 font-normal text-ink-faint">
              confiança no dado, pulso e canais, saúde do volume, movimentos e fila completa
            </span>
          </span>
          <span aria-hidden="true" className="text-ink-faint transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <ConfidenceStrip
            data={confidence}
            loading={confidence.checkingCount === confidence.selectedCount && confidence.selectedCount > 0}
            onOpen={() => setDialog({ kind: "confidence" })}
          />

          <PulseChannelsColumn
            pulse={pulse}
            health={sources.executiveSummary.data?.health ?? null}
            pulseLoading={sources.executiveSummary.status.loading}
            pulseUnavailable={sources.executiveSummary.status.error}
            onOpenInsight={(key) => setDialog({ kind: "pulse", view: { mode: "insight", key } })}
            onOpenAllInsights={() => setDialog({ kind: "pulse", view: { mode: "all", key: null } })}
            overview={overview}
            channels={filters.channels}
            channelsLoading={overviewStatus.loading}
            channelsUnavailable={overviewStatus.error}
            onOpenChannel={(channel) => setDialog({ kind: "volume", channel })}
            channelsHref={buildHref("/canais")}
          />

          <VolumeHealthCard
            rows={volumeRows}
            loading={sources.quality.status.loading}
            error={sources.quality.status.error}
            onOpenChannel={(channel) => setDialog({ kind: "volume", channel })}
            onRetry={sources.retry}
          />

          <MovementsPanels
            movements={movements}
            concentration={concentration}
            loading={sources.brands.status.loading}
            error={sources.brands.status.error}
            onOpenMovement={(movement) => setDialog({ kind: "movement", movement })}
            onOpenConcentration={(entry) => setDialog({ kind: "concentration", entry })}
            produtosHref={buildHref("/produtos")}
            onRetry={sources.retry}
          />

          <AttentionQueue
            commercial={queue.commercial}
            dataConfidence={queue.dataConfidence}
            commercialLoading={sources.executiveSummary.status.loading}
            commercialError={sources.executiveSummary.status.error}
            onOpenCommercial={(item) => setDialog({ kind: "commercial", item })}
            onOpenDataWarning={(item) => setDialog({ kind: "dataWarning", item })}
            onRetry={sources.retry}
          />
        </div>
      </details>

      {/* ---- Shell UNICO de dialogo, para todos os drill-downs ---- */}
      <KpiDrilldownDialog
        open={dialog != null}
        onClose={() => setDialog(null)}
        title={dialogTitle}
        icone={kpiDoDialogo?.icone}
        identidade={kpiDoDialogo?.identidade}
      >
        {dialog?.kind === "kpi" && overview && (
          <KpiDrilldownContent
            kind={dialog.key}
            identidade={kpiDoDialogo?.identidade}
            // O detalhe mostra o valor EXATO; o card, o curto (UI-DENSIDADE-1).
            value={(() => {
              const k = kpis.find((x) => x.key === dialog.key);
              return k?.exactValue ?? k?.value ?? "—";
            })()}
            comparacao={kpis.find((k) => k.key === dialog.key)}
            comparar={comparar}
            diaEmAndamento={diaEmAndamento}
            tendencia={dialog.key === "orders" || dialog.key === "avg_ticket" ? tendencias[dialog.key] : null}
            periodLabel={periodLabel}
            refreshedAt={sources.overview.refreshedAt}
            overview={overview}
            brands={brands}
            channels={filters.channels}
            full={fullPorMarca ? { por: fullPorMarca, aproximado: fullJanela.aproximado } : null}
            buildHref={buildHref}
          />
        )}

        {dialog?.kind === "confidence" && (
          <ConfidenceDrilldownContent
            data={confidence}
            items={queue.dataConfidence}
            periodLabel={periodLabel}
            refreshedAt={sources.executiveSummary.refreshedAt}
            regioesHref={buildHref("/regioes")}
          />
        )}

        {dialog?.kind === "pulse" && (
          <InsightDrilldownContent
            pulse={pulse}
            view={dialog.view}
            periodLabel={periodLabel}
            refreshedAt={sources.executiveSummary.refreshedAt}
            onSelectGroup={(key) => setDialog({ kind: "pulse", view: { mode: "all", key } })}
            onBackToAll={() => setDialog({ kind: "pulse", view: { mode: "all", key: null } })}
            buildHref={buildHref}
          />
        )}

        {dialog?.kind === "bucket" && bucket && (
          <TrendBucketDrilldownContent
            bucket={bucket}
            merged={merged}
            metric={metric}
            channels={filters.channels}
            granularityLabel={GRAIN_LABEL[merged.granularity]}
            bounds={{ dateFrom: filters.dateFrom, dateTo: filters.dateTo }}
            periodLabel={periodLabel}
            brandsFilter={filters.brands}
            demoMode={sources.demoMode}
            onPinRange={pinRange}
          />
        )}

        {dialog?.kind === "channelSeries" && (
          <ChannelSeriesDrilldownContent
            channel={dialog.channel}
            merged={merged}
            metric={metric}
            periodLabel={periodLabel}
            canaisHref={buildHref(`/canais?channels=${dialog.channel}`)}
          />
        )}

        {dialog?.kind === "volume" && (() => {
          const row = volumeRows.find((r) => r.channel === dialog.channel);
          if (!row) {
            return (
              <p className="text-sm text-ink-faint">
                Sem dados de qualidade para {CHANNEL_LABEL[dialog.channel]} no período e filtros selecionados.
              </p>
            );
          }
          return (
            <VolumeHealthDrilldownContent
              row={row}
              periodLabel={periodLabel}
              refreshedAt={sources.quality.refreshedAt}
              qualidadeHref={buildHref("/qualidade")}
            />
          );
        })()}

        {dialog?.kind === "matrix" &&
          (matrixRow ? (
            <ChannelComparisonDialogContent
              row={matrixRow}
              median={findChannelMedian(sources.canais.data?.channelMedians ?? [], matrixRow.channel)}
              periodLabel={periodLabel}
              refreshedAt={sources.canais.refreshedAt}
              buildHref={buildHref}
            />
          ) : (
            // Quatro causas distintas para a linha comparativa faltar — a
            // mensagem diz qual, em vez de sempre culpar a carga.
            <MatrixCellUnavailableContent
              status={signalsState}
              demoMode={sources.demoMode}
              brandLabel={matrix.rows.find((r) => r.brand === dialog.brand)?.label ?? dialog.brand.toUpperCase()}
              channelLabel={CHANNEL_LABEL[dialog.channel]}
            />
          ))}

        {dialog?.kind === "matrixChannel" && (
          <MatrixChannelDrilldownContent
            channel={dialog.channel}
            matrix={matrix}
            periodLabel={periodLabel}
            refreshedAt={sources.brands.refreshedAt}
            canaisHref={buildHref(`/canais?channels=${dialog.channel}`)}
          />
        )}

        {dialog?.kind === "movement" && (
          <MovementDrilldownContent
            movement={dialog.movement}
            marca={matrix.rows.find((r) => r.brand === dialog.movement.brand) ?? null}
            periodLabel={periodLabel}
            refreshedAt={sources.brands.refreshedAt}
            brandHref={brandHref(dialog.movement.brand)}
          />
        )}

        {dialog?.kind === "concentration" && (
          <ConcentrationDrilldownContent
            entry={dialog.entry}
            position={concentration.entries.findIndex((e) => e.brand === dialog.entry.brand) + 1}
            top1Pct={concentration.top1Pct}
            top3Pct={concentration.top3Pct}
            positiveBrands={concentration.positiveBrands}
            ranking={concentration.entries}
            periodLabel={periodLabel}
            refreshedAt={sources.brands.refreshedAt}
            brandHref={brandHref(dialog.entry.brand)}
            produtosHref={buildHref("/produtos")}
          />
        )}

        {dialog?.kind === "commercial" && (
          <CommercialAttentionDrilldownContent
            item={dialog.item}
            periodLabel={periodLabel}
            refreshedAt={sources.executiveSummary.refreshedAt}
            href={buildHref(dialog.item.href)}
          />
        )}

        {dialog?.kind === "cx" && (
          <CxDrilldownContent
            indicador={dialog.indicador}
            resumo={dialog.resumo}
            notas={notasDoTile(dialog.resumo, dialog.indicador, dialog.dias)}
            geradoEm={dialog.geradoEm}
            periodo={`Últimos ${dialog.dias} dias até ontem`}
            dias={dialog.dias}
            // a /cx so' le' uma marca na URL; com varias, abre em "Todas"; o mesmo periodo do card
            cxHref={hrefCx({ marca: filters.brands.length === 1 ? filters.brands[0] : null, dias: dialog.dias })}
          />
        )}

        {dialog?.kind === "dataWarning" && (
          <DataWarningDrilldownContent
            item={dialog.item}
            periodLabel={periodLabel}
            refreshedAt={sources.executiveSummary.refreshedAt}
            href={dialog.item.href ? buildHref(dialog.item.href) : null}
          />
        )}
      </KpiDrilldownDialog>
    </div>
  );
}

/** So' marcas menores no filtro: a Gerencial inteira sai do Bling, sem chamar nenhuma fonte do Data Mart. */
function GerencialInner() {
  const [filters, setFilters] = useGlobalFilters({ defaultPreset: "mes_atual", defaultCompare: true });
  if (escopoDeMarcas(filters.brands).soMenores) return <GerencialMarcasMenores filters={filters} onChange={setFilters} />;
  return <GerencialComGrandes />;
}

export default function Gerencial() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <GerencialInner />
    </Suspense>
  );
}
