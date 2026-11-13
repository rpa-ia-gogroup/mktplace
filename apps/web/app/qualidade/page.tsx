"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  fetchQuality,
  type QualityKpis,
  type QualityBrandRow,
  type ScopeQuality,
} from "@/lib/api-client";
import { isMarketplaceSelected } from "@/lib/marketplace-filter";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import FaixaCarregando from "@/components/ui/FaixaCarregando";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import FaixaQualidade, { CARTOES_DA_FAIXA, GRADE_QUALIDADE, VISUAL_QUALIDADE } from "@/components/qualidade/QualidadeCartoes";
import QualidadeDrilldownContent from "@/components/qualidade/QualidadeDrilldownContent";
import { DEF_QUALIDADE, fmtDias, linhasPorMarca, textoDoCartao, tituloDoDetalhe, type ChaveQualidade, type LinhaMarca } from "@/lib/qualidade-cartoes";
import { fmtPctBr, fmtPctSimples } from "@/lib/formatters";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import Aba, { type VisaoDaAba } from "@/components/layout/Aba";
import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import CelulaBarra from "@/components/ui/CelulaBarra";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import { fmtPeriodo, mockLimitationNote } from "@/lib/filters/format";
import { detectPreset } from "@/lib/filters/presets";
import { useSortableTable } from "@/lib/use-sortable-table";
import SortableHeader from "@/components/SortableHeader";
import TableScrollHint from "@/components/TableScrollHint";
import { buildQualityRequestKey } from "@/lib/quality-request-key";
import { computeRequestStatus } from "@/lib/request-freshness";
import InfoDica from "@/components/ui/InfoDica";
import ScopeQualityBanner from "@/components/ScopeQualityBanner";
import {
  TIKTOK_QUALITY_UNAVAILABLE_NOTE,
  qualityLoadedAnnouncement,
} from "@/lib/quality-availability";
// T-0088: "—" para taxa nula e "parcial (N de M marcas)" da devolucao Shopee (helper puro, testavel no node --test).
import { avisoCoberturaDevolucao, fmtRate } from "./cobertura-devolucao";

const fmtDays = fmtDias;

function fmtCount(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR");
}

/** Faixas da taxa (regra de negocio: 2% e 5%): pintam so' a TINTA do numero, nunca o fundo da celula. */
function cancelColor(v: number | null): string {
  if (v == null) return "text-ink-faint";
  if (v < 2) return "text-ok-ink";
  if (v < 5) return "text-warn-ink";
  return "text-crit-ink";
}

/** Peso 0..1 de cada linha na escala da coluna (so' desenha a barrinha); `null` sem dado. */
function pesos(valores: (number | null)[]): (number | null)[] {
  const max = Math.max(0, ...valores.map((v) => v ?? 0));
  return valores.map((v) => (v == null || max <= 0 ? null : v / max));
}

type VisaoQualidade = "geral" | "fidelizacao" | "shopee";

/** As ancoras de antes das abas continuam valendo: o link antigo abre a aba certa. */
const VISAO_DA_ANCORA: Record<string, VisaoQualidade> = {
  "#resumo": "geral",
  "#qualidade-marca": "geral",
  "#qualidade-produtos-shopee": "geral",
  "#fidelizacao-ml": "fidelizacao",
  "#qualidade-shopee": "shopee",
};

/** Cor do canal para a barrinha da tabela (token do tema). */
const COR_CANAL = { ml: "rgb(var(--tc-canal-ml))", shopee: "rgb(var(--tc-canal-shopee))" } as const;

/** Paineis da Visao geral: o indicador de cada canal (a Shopee nao publica prazo; o TikTok nao publica cancelamento). */
const PRAZO = [
  { canal: "tiktok", texto: "TikTok Shop", chave: "tk_entrega" },
  { canal: "ml", texto: "Mercado Livre", chave: "ml_entrega" },
] as const satisfies readonly { canal: string; texto: string; chave: ChaveQualidade }[];
const CANCELAMENTO = [
  { canal: "ml", texto: "Mercado Livre", chave: "ml_cancelamento" },
  { canal: "shopee", texto: "Shopee", chave: "sh_cancelamento" },
] as const satisfies readonly { canal: string; texto: string; chave: ChaveQualidade }[];

function QualityPageInner() {
  const [filters, setFilters, padrao] = useGlobalFilters({ defaultPreset: "mes_anterior", defaultCompare: true });
  const filter = filters.channels; // alias — preserva as referencias existentes abaixo
  const [kpis, setKpis] = useState<QualityKpis | null>(null);
  const [brands, setBrands] = useState<QualityBrandRow[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Cartao aberto no detalhe (dialogo unico da pagina).
  const [detalhe, setDetalhe] = useState<ChaveQualidade | null>(null);
  const [visao, setVisao] = useState<VisaoQualidade>("geral");
  useEffect(() => {
    const daAncora = () => {
      const v = VISAO_DA_ANCORA[window.location.hash];
      if (v) setVisao(v);
    };
    daAncora();
    window.addEventListener("hashchange", daAncora);
    return () => window.removeEventListener("hashchange", daAncora);
  }, []);
  const [canalPrazo, setCanalPrazo] = useState<"tiktok" | "ml">("tiktok");
  const [canalCancelamento, setCanalCancelamento] = useState<"ml" | "shopee">("ml");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  // Chave da ultima requisicao resolvida com sucesso ou falha — comparada
  // com a chave atual para decidir se o estado em memoria reflete de fato
  // os filtros exibidos agora (mesmo padrao Financeiro/Regioes, Gate U4).
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);

  const requestKey = useMemo(
    () => buildQualityRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, compare: filters.compare, retryKey }),
    [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, filters.compare, retryKey],
  );

  // Gate SH-API-2D: qualidade do MART DE PRODUTOS Shopee. E uma fonte
  // diferente da diaria que alimenta o resto desta tela, com ciclo de
  // maturacao proprio — por isso vive num estado separado e nunca herda a
  // conclusao das metricas operacionais.
  const [produtosShQuality, setProdutosShQuality] = useState<ScopeQuality | null>(null);

  useEffect(() => {
    // Ignora a resposta se os filtros mudarem antes dela chegar.
    let ignore = false;
    setLoading(true);
    setError(null);
    const key = buildQualityRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, compare: filters.compare, retryKey });
    const opts = { brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, compare: filters.compare };
    fetchQuality(filters.channels, undefined, opts)
      .then((result) => {
        if (ignore) return;
        setKpis(result.kpis);
        setBrands(result.brands);
        setProdutosShQuality(result.produtosShopeeQuality ?? null);
        setIsLive(result.live);
        setRefreshedAt(result.meta.refreshedAt);
        setResolvedKey(key);
        setLoading(false);
      })
      .catch(() => {
        if (ignore) return;
        setError("Falha ao carregar dados de qualidade. Verifique a conexão.");
        // Falha nao pode deixar na tela um selo antigo descrevendo um escopo
        // que NAO foi medido nesta requisicao.
        setProdutosShQuality(null);
        // A chave precisa ser marcada como resolvida MESMO na falha — senao
        // `computeRequestStatus` nunca sai de "loading" (resolvedKey nunca
        // bate com requestKey) e a falha da requisicao atual nunca vira
        // "error" de fato (fica presa em loading para sempre).
        setResolvedKey(key);
        setLoading(false);
      });
    return () => { ignore = true; };
  }, [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, filters.compare, retryKey]);

  // FINDING 2 (Gate U4) — loading/error/fresh SEPARADOS: depois de um erro
  // definitivo, `dataIsFresh` fica `false` para sempre, mas `isLoadingState`
  // tambem precisa ficar `false` (senao skeleton/opacidade/aria-busy
  // continuariam ligados como se ainda estivesse buscando).
  const requestStatus = computeRequestStatus({ loading, error: error != null, resolvedKey, requestKey });
  const dataIsFresh = requestStatus.fresh;
  const isLoadingState = requestStatus.loading;
  const isErrorState = requestStatus.error;

  // Versoes protegidas do estado bruto — nenhum calculo/card/tabela abaixo
  // deve ler kpis/brands/isLive/refreshedAt diretamente.
  const displayKpis = dataIsFresh ? kpis : null;
  const displayBrands = dataIsFresh ? brands : [];
  const displayIsLive = dataIsFresh ? isLive : false;
  const displayRefreshedAt = dataIsFresh ? refreshedAt : null;

  const periodLabel = fmtPeriodo(filters.dateFrom, filters.dateTo);

  const showTiktok = isMarketplaceSelected(filter, "tiktok");
  const showMl = isMarketplaceSelected(filter, "ml");
  const showShopee = isMarketplaceSelected(filter, "shopee");
  // Coluna sem dado de NENHUMA marca sai da tabela (o motivo fica no ⓘ do painel); com dado parcial, fica com "—".
  const temShDevolucao = displayBrands.some((b) => b.shopee_return_rate_pct != null);
  const qualityColSpan = 1 + (showTiktok ? 1 : 0) + (showMl ? 3 : 0) + (showShopee ? (temShDevolucao ? 2 : 1) : 0);

  const qualityColumnTypes = useMemo(() => ({
    brand: "text" as const, tk_delivery: "numeric" as const, ml_cancel: "numeric" as const,
    ml_not_delivered: "numeric" as const, ml_delivery: "numeric" as const,
    sh_cancel: "numeric" as const, sh_return: "numeric" as const,
  }), []);
  const qualityGetValue = (row: QualityBrandRow, column: string): string | number | null => {
    switch (column) {
      case "brand": return row.label;
      case "tk_delivery": return row.tiktok_avg_delivery_days;
      case "ml_cancel": return row.ml_cancel_rate_pct;
      case "ml_not_delivered": return row.ml_not_delivered_rate_pct;
      case "ml_delivery": return row.ml_avg_delivery_days;
      case "sh_cancel": return row.shopee_cancel_rate_pct ?? null;
      case "sh_return": return row.shopee_return_rate_pct ?? null;
      default: return null;
    }
  };
  const qualitySort = useSortableTable(displayBrands, qualityGetValue, qualityColumnTypes);
  const qualityVisibleColumns = useMemo(() => {
    const cols = ["brand"];
    if (showTiktok) cols.push("tk_delivery");
    if (showMl) cols.push("ml_cancel", "ml_not_delivered", "ml_delivery");
    if (showShopee) cols.push("sh_cancel");
    if (showShopee && temShDevolucao) cols.push("sh_return");
    return cols;
  }, [showTiktok, showMl, showShopee, temShDevolucao]);
  useEffect(() => {
    qualitySort.resetSortIfColumnMissing(qualityVisibleColumns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualityVisibleColumns.join(",")]);

  const mlLoyaltyRows = displayBrands.filter((b) => b.ml_unique_buyers != null || b.ml_repeat_buyer_rate_pct != null);
  const mlLoyaltyColumnTypes = useMemo(() => ({
    brand: "text" as const, buyers: "numeric" as const, new: "numeric" as const,
    repeat_pct: "numeric" as const, gmv_per_buyer: "numeric" as const,
    mom: "numeric" as const, shipping_pct: "numeric" as const,
  }), []);
  const mlLoyaltyGetValue = (row: QualityBrandRow, column: string): string | number | null => {
    switch (column) {
      case "brand": return row.label;
      case "buyers": return row.ml_unique_buyers;
      case "new": return row.ml_new_buyers;
      case "repeat_pct": return row.ml_repeat_buyer_rate_pct;
      case "gmv_per_buyer": return row.ml_gmv_per_buyer;
      case "mom": return row.ml_gmv_mom_pct;
      case "shipping_pct": return row.ml_shipping_pct_of_gmv;
      default: return null;
    }
  };
  const mlLoyaltySort = useSortableTable(mlLoyaltyRows, mlLoyaltyGetValue, mlLoyaltyColumnTypes);

  const shQualityRows = displayBrands.filter((b) => b.shopee_orders != null || b.shopee_cancel_rate_pct != null);
  const shQualityColumnTypes = useMemo(() => ({
    brand: "text" as const, orders: "numeric" as const, canceled: "numeric" as const,
    cancel_pct: "numeric" as const, returned: "numeric" as const, return_pct: "numeric" as const,
  }), []);
  const shQualityGetValue = (row: QualityBrandRow, column: string): string | number | null => {
    switch (column) {
      case "brand": return row.label;
      case "orders": return row.shopee_orders ?? null;
      case "canceled": return row.shopee_canceled_orders ?? null;
      case "cancel_pct": return row.shopee_cancel_rate_pct ?? null;
      case "returned": return row.shopee_returned_orders ?? null;
      case "return_pct": return row.shopee_return_rate_pct ?? null;
      default: return null;
    }
  };
  const shQualitySort = useSortableTable(shQualityRows, shQualityGetValue, shQualityColumnTypes);

  const hasMlLoyalty = showMl && displayBrands.some((b) => b.ml_repeat_buyer_rate_pct != null || b.ml_unique_buyers != null);
  const hasShQuality = showShopee && displayBrands.some((b) => b.shopee_cancel_rate_pct != null || b.shopee_orders != null);

  // Abas sob o titulo (no lugar das ancoras): as de canal so' existem quando ha' dado, como antes.
  const visoes: VisaoDaAba<VisaoQualidade>[] = [
    { id: "geral", rotulo: "Visão geral" },
    ...(hasMlLoyalty ? [{ id: "fidelizacao" as const, rotulo: "Fidelização ML", ponto: "bg-canal-ml" }] : []),
    ...(hasShQuality ? [{ id: "shopee" as const, rotulo: "Shopee", ponto: "bg-canal-shopee" }] : []),
  ];
  // a aba escolhida pode sumir ao trocar de filtro: volta a' Visao geral
  const visaoAtiva = visoes.some((v) => v.id === visao) ? visao : "geral";

  // Paineis da Visao geral: cada um com o seu seletor de canal (so' os canais do filtro).
  const canaisDoPrazo = PRAZO.filter((p) => (p.canal === "tiktok" ? showTiktok : showMl));
  const prazoAtivo = canaisDoPrazo.find((p) => p.canal === canalPrazo) ?? canaisDoPrazo[0];
  const mediaDoPrazo = textoDoCartao(prazoAtivo?.chave ?? "ml_entrega", displayKpis);
  const canaisDoCancelamento = CANCELAMENTO.filter((p) => (p.canal === "ml" ? showMl : showShopee));
  const cancelamentoAtivo = canaisDoCancelamento.find((p) => p.canal === canalCancelamento) ?? canaisDoCancelamento[0];

  const pesoMlCancel = pesos(qualitySort.sortedRows.map((b) => b.ml_cancel_rate_pct));
  const pesoMlNaoEntregue = pesos(qualitySort.sortedRows.map((b) => b.ml_not_delivered_rate_pct));
  const pesoShCancel = pesos(qualitySort.sortedRows.map((b) => b.shopee_cancel_rate_pct ?? null));
  const pesoShDevol = pesos(qualitySort.sortedRows.map((b) => b.shopee_return_rate_pct ?? null));
  const pesoShCancelDetalhe = pesos(shQualitySort.sortedRows.map((b) => b.shopee_cancel_rate_pct ?? null));
  const pesoShDevolDetalhe = pesos(shQualitySort.sortedRows.map((b) => b.shopee_return_rate_pct ?? null));
  const avisoDevolucao = showShopee ? avisoCoberturaDevolucao(displayKpis?.shopee_return_cobertura, displayBrands) : null;
  const isCustomPeriod = detectPreset(filters.dateFrom, filters.dateTo) !== "mes_anterior";
  const notaDemo = dataIsFresh ? mockLimitationNote(displayIsLive, filters.brands, isCustomPeriod) : null;
  const corpoOpaco = `transition-opacity duration-200 ${isLoadingState ? "opacity-50" : ""}`;

  return (
    <>
      <Aba
        titulo="Qualidade"
        visoes={visoes}
        visao={visaoAtiva}
        onVisao={setVisao}
        selo={
          <>
            {notaDemo && (
              <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-warn-soft px-2.5 text-xs font-medium text-warn-ink ring-1 ring-inset ring-warn/30">
                Demonstração · filtros ignorados
                <InfoDica texto={notaDemo} />
              </span>
            )}
            {/* Live/mock so' com dado fresco, nunca o da requisicao anterior. */}
            <SeloAtualizado aoVivo={dataIsFresh ? displayIsLive : null} em={dataIsFresh ? (displayRefreshedAt ?? null) : null} carregando={isLoadingState} />
          </>
        }
        filtros={<GlobalFilterControls filters={filters} onChange={setFilters} loading={isLoadingState} padrao={padrao} />}
        faixa={
          isErrorState ? null : (
            <div aria-busy={isLoadingState}>
              <span className="sr-only" aria-live="polite" aria-atomic="true">
                {isLoadingState ? "Carregando dados de qualidade..." : qualityLoadedAnnouncement(showTiktok)}
              </span>
              {isLoadingState ? (
                <FaixaCarregando cartoes={CARTOES_DA_FAIXA.length} className={GRADE_QUALIDADE} />
              ) : (
                <FaixaQualidade kpis={displayKpis} marcas={displayBrands} canais={{ tiktok: showTiktok, ml: showMl, shopee: showShopee }} onAbrir={setDetalhe} />
              )}
            </div>
          )
        }
      >
        {isErrorState ? (
          // FINDING 2: erro definitivo mostra so cabecalho/filtros e este bloco —
          // nunca skeleton, nunca dado antigo.
          <>
            <span className="sr-only" aria-live="polite" aria-atomic="true">Falha ao carregar.</span>
            <StateBlock
              tipo="erro"
              titulo="Não foi possível carregar os dados de qualidade."
              descricao={error}
              acao={<RetryButton onClick={() => { setError(null); setRetryKey((k) => k + 1); }} />}
            />
          </>
        ) : visaoAtiva === "geral" ? (
          <>
            {/* Dois paineis lado a lado, cada um DENTRO de um canal por vez (Gate P16: nunca canal contra canal). */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Panel
                titulo="Prazo de entrega por marca"
                aria-label="Prazo de entrega por marca"
                className="h-full"
                ajuda={prazoAtivo ? DEF_QUALIDADE[prazoAtivo.chave].dica : undefined}
                acao={canaisDoPrazo.length > 1 ? <Segmented rotulo="Canal do prazo de entrega" opcoes={canaisDoPrazo.map((p) => ({ valor: p.canal, texto: p.texto }))} valor={prazoAtivo.canal} aoEscolher={setCanalPrazo} /> : undefined}
              >
                {prazoAtivo ? (
                  <div className="flex flex-col gap-3">
                    {/* a media do canal (o numero que era cartao) antes das marcas */}
                    <p className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5 text-sm">
                      <span className="text-ink-muted">Média do canal · {prazoAtivo.texto}</span>
                      <span className={`text-xl font-bold tabular-nums ${mediaDoPrazo.ausente ? "text-ink-faint" : "text-ink"}`}>{mediaDoPrazo.valor}</span>
                    </p>
                    <BarrasPorMarca linhas={linhasPorMarca(prazoAtivo.chave, displayBrands)} cor={CHANNEL_DOT[prazoAtivo.canal]} carregando={isLoadingState} />
                  </div>
                ) : (
                  <StateBlock tipo="indisponivel" compacto titulo="A Shopee não publica prazo de entrega nesta fonte" />
                )}
              </Panel>
              <Panel
                titulo="Cancelamento por marca"
                aria-label="Cancelamento por marca"
                className="h-full"
                acao={canaisDoCancelamento.length > 1 ? <Segmented rotulo="Canal do cancelamento" opcoes={canaisDoCancelamento.map((p) => ({ valor: p.canal, texto: p.texto }))} valor={cancelamentoAtivo.canal} aoEscolher={setCanalCancelamento} /> : undefined}
              >
                {cancelamentoAtivo ? (
                  <BarrasPorMarca linhas={linhasPorMarca(cancelamentoAtivo.chave, displayBrands)} cor={CHANNEL_DOT[cancelamentoAtivo.canal]} carregando={isLoadingState} />
                ) : (
                  <StateBlock tipo="indisponivel" compacto titulo="Cancelamento N/D no TikTok Shop" descricao={TIKTOK_QUALITY_UNAVAILABLE_NOTE} />
                )}
              </Panel>
            </div>

            {/* Tabela por marca, em largura total: barrinha na cor do canal no lugar do mapa de calor */}
            <Panel
              titulo="Qualidade por marca"
              aria-label="Qualidade por marca"
              semPadding
              ajuda={`Taxas: abaixo de 2% em verde, de 2% a 5% em âmbar, acima de 5% em vermelho.${showMl ? " ML · Não entregue é proxy: pagos − entregues." : ""}${showTiktok ? " Entrega do TikTok: dados a partir de abr/26." : ""}${showShopee && !temShDevolucao ? " Shopee · Devolução: nenhuma marca com dado no período, por isso a coluna não aparece." : ""}`}
            >
              <TableScrollHint>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-raised text-left">
                      <SortableHeader label="Marca" column="brand" sort={qualitySort.sort} onSort={qualitySort.toggleSort} align="left" />
                      {showTiktok && <SortableHeader label="TikTok · Entrega" column="tk_delivery" sort={qualitySort.sort} onSort={qualitySort.toggleSort} />}
                      {showMl && (
                        <>
                          <SortableHeader label="ML · Cancel." column="ml_cancel" sort={qualitySort.sort} onSort={qualitySort.toggleSort} />
                          <SortableHeader label="ML · Não entregue" column="ml_not_delivered" sort={qualitySort.sort} onSort={qualitySort.toggleSort} />
                          <SortableHeader label="ML · Entrega" column="ml_delivery" sort={qualitySort.sort} onSort={qualitySort.toggleSort} />
                        </>
                      )}
                      {showShopee && (
                        <>
                          <SortableHeader label="Shopee · Cancel." column="sh_cancel" sort={qualitySort.sort} onSort={qualitySort.toggleSort} />
                          {temShDevolucao && <SortableHeader label="Shopee · Devol." column="sh_return" sort={qualitySort.sort} onSort={qualitySort.toggleSort} />}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className={`divide-y divide-line ${corpoOpaco}`}>
                    {displayBrands.length === 0 && dataIsFresh && (
                      <tr>
                        <td colSpan={qualityColSpan} className="px-4 py-8 text-center text-sm text-ink-faint">
                          Sem dados para o período selecionado.
                        </td>
                      </tr>
                    )}
                    {qualitySort.sortedRows.map((b, k) => (
                      <tr key={b.brand} className="transition-colors hover:bg-raised/60">
                        <td className={TD_MARCA}>{b.label}</td>
                        {showTiktok && <td className={TD}>{fmtDays(b.tiktok_avg_delivery_days)}</td>}
                        {showMl && (
                          <>
                            <CelulaTaxa texto={fmtRate(b.ml_cancel_rate_pct)} valor={b.ml_cancel_rate_pct} peso={pesoMlCancel[k]} cor={COR_CANAL.ml} />
                            <CelulaTaxa texto={fmtRate(b.ml_not_delivered_rate_pct)} valor={b.ml_not_delivered_rate_pct} peso={pesoMlNaoEntregue[k]} cor={COR_CANAL.ml} />
                            <td className={TD}>{fmtDays(b.ml_avg_delivery_days)}</td>
                          </>
                        )}
                        {showShopee && (
                          <>
                            <CelulaTaxa texto={fmtRate(b.shopee_cancel_rate_pct ?? null)} valor={b.shopee_cancel_rate_pct ?? null} peso={pesoShCancel[k]} cor={COR_CANAL.shopee} />
                            {temShDevolucao && <CelulaTaxa texto={fmtRate(b.shopee_return_rate_pct ?? null)} valor={b.shopee_return_rate_pct ?? null} peso={pesoShDevol[k]} cor={COR_CANAL.shopee} />}
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollHint>
            </Panel>

            {/* O que a fonte nao traz e a confiabilidade do dado: fora da primeira dobra, nunca apagado */}
            {(showTiktok || avisoDevolucao || produtosShQuality) && (
              <MaisDetalhes>
                {/* Gate DQ2: cancelamento e devolucao do TikTok seguem declarados como
                    indisponiveis ("N/D"), nunca 0%, nunca tom de sucesso. */}
                {showTiktok && (
                  <p className="flex items-center gap-1.5 text-xs text-warn-ink">
                    TikTok: só entrega · cancelamento e devolução N/D
                    <InfoDica texto={TIKTOK_QUALITY_UNAVAILABLE_NOTE} />
                  </p>
                )}
                {/* T-0088: o % de devolucao so' cobre as marcas com o dado; diz quantas. */}
                {avisoDevolucao && (
                  <p className="flex items-center gap-1.5 text-xs text-warn-ink">
                    {avisoDevolucao.texto}
                    <InfoDica texto={avisoDevolucao.dica} />
                  </p>
                )}
                {/* Gate SH-API-2D — confiabilidade do MART DE PRODUTOS Shopee: fonte
                    distinta da diaria, com maturacao propria; nao depende de haver
                    metrica operacional para aparecer. */}
                {produtosShQuality && (
                  <section id="qualidade-produtos-shopee" aria-labelledby="qualidade-produtos-shopee-titulo" className="flex flex-col gap-2">
                    <h3 id="qualidade-produtos-shopee-titulo" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      Produtos Shopee — competência {produtosShQuality.ref_month}
                      <InfoDica texto="Fonte distinta da diária, com maturação própria." />
                    </h3>
                    <ScopeQualityBanner quality={produtosShQuality} />
                  </section>
                )}
              </MaisDetalhes>
            )}
          </>
        ) : visaoAtiva === "fidelizacao" ? (
          <Panel
            titulo="Fidelização — Mercado Livre"
            aria-label="Fidelização — Mercado Livre"
            semPadding
            ajuda="Compradores = soma diária, não comprador único do período. ML é canal de aquisição (~90% novos/mês): recompra abaixo de 10% é esperada. Recompra: acima de 20% em verde, de 10% a 20% em âmbar, abaixo de 10% em vermelho. Frete/GMV: abaixo de 11% em verde, de 11% a 14% em âmbar, acima de 14% em vermelho."
          >
            <TableScrollHint>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-raised text-left">
                    <SortableHeader label="Marca" column="brand" sort={mlLoyaltySort.sort} onSort={mlLoyaltySort.toggleSort} align="left" />
                    <SortableHeader label="Compradores" column="buyers" sort={mlLoyaltySort.sort} onSort={mlLoyaltySort.toggleSort} />
                    <SortableHeader label="Novos" column="new" sort={mlLoyaltySort.sort} onSort={mlLoyaltySort.toggleSort} />
                    <SortableHeader label="Recompra%" column="repeat_pct" sort={mlLoyaltySort.sort} onSort={mlLoyaltySort.toggleSort} />
                    <SortableHeader label="GMV/Buyer" column="gmv_per_buyer" sort={mlLoyaltySort.sort} onSort={mlLoyaltySort.toggleSort} />
                    <SortableHeader label="MoM GMV" column="mom" sort={mlLoyaltySort.sort} onSort={mlLoyaltySort.toggleSort} />
                    <SortableHeader label="Frete/GMV" column="shipping_pct" sort={mlLoyaltySort.sort} onSort={mlLoyaltySort.toggleSort} />
                  </tr>
                </thead>
                <tbody className={`divide-y divide-line ${corpoOpaco}`}>
                  {mlLoyaltySort.sortedRows.map((b) => {
                    const recompra = b.ml_repeat_buyer_rate_pct;
                    const recompraColor = recompra == null ? "text-ink-faint"
                      : recompra > 20 ? "text-ok-ink font-semibold"
                      : recompra > 10 ? "text-warn-ink font-semibold"
                      : "text-crit-ink font-semibold";
                    const freteColor = b.ml_shipping_pct_of_gmv == null ? "text-ink-faint"
                      : b.ml_shipping_pct_of_gmv < 11 ? "text-ok-ink"
                      : b.ml_shipping_pct_of_gmv < 14 ? "text-warn-ink"
                      : "text-crit-ink font-semibold";
                    const momColor = b.ml_gmv_mom_pct == null ? "text-ink-faint"
                      : b.ml_gmv_mom_pct >= 0 ? "text-ok-ink" : "text-crit-ink";
                    return (
                      <tr key={b.brand} className="transition-colors hover:bg-raised/60">
                        <td className={TD_MARCA}>{b.label}</td>
                        <td className={TD}>{b.ml_unique_buyers != null ? fmtCount(b.ml_unique_buyers) : TRACO}</td>
                        <td className={TD}>{b.ml_new_buyers != null ? fmtCount(b.ml_new_buyers) : TRACO}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${recompraColor}`}>{recompra != null ? fmtPctSimples(recompra) : TRACO}</td>
                        <td className={TD}>
                          {b.ml_gmv_per_buyer != null
                            ? `R$ ${b.ml_gmv_per_buyer.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : TRACO}
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums ${momColor}`}>{b.ml_gmv_mom_pct != null ? fmtPctBr(b.ml_gmv_mom_pct) : TRACO}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${freteColor}`}>{b.ml_shipping_pct_of_gmv != null ? fmtPctSimples(b.ml_shipping_pct_of_gmv) : TRACO}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScrollHint>
          </Panel>
        ) : (
          <Panel
            titulo="Qualidade — Shopee"
            aria-label="Qualidade — Shopee"
            semPadding
            ajuda="Cancelamento e devolução: abaixo de 2% em verde, de 2% a 5% em âmbar, acima de 5% em vermelho."
          >
            <TableScrollHint>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-raised text-left">
                    <SortableHeader label="Marca" column="brand" sort={shQualitySort.sort} onSort={shQualitySort.toggleSort} align="left" />
                    <SortableHeader label="Pedidos" column="orders" sort={shQualitySort.sort} onSort={shQualitySort.toggleSort} />
                    <SortableHeader label="Cancelados" column="canceled" sort={shQualitySort.sort} onSort={shQualitySort.toggleSort} />
                    <SortableHeader label="Cancel.%" column="cancel_pct" sort={shQualitySort.sort} onSort={shQualitySort.toggleSort} />
                    <SortableHeader label="Devolvidos" column="returned" sort={shQualitySort.sort} onSort={shQualitySort.toggleSort} />
                    <SortableHeader label="Devol.%" column="return_pct" sort={shQualitySort.sort} onSort={shQualitySort.toggleSort} />
                  </tr>
                </thead>
                <tbody className={`divide-y divide-line ${corpoOpaco}`}>
                  {shQualitySort.sortedRows.map((b, k) => (
                    <tr key={b.brand} className="transition-colors hover:bg-raised/60">
                      <td className={TD_MARCA}>{b.label}</td>
                      <td className={TD}>{b.shopee_orders != null ? fmtCount(b.shopee_orders) : TRACO}</td>
                      <td className={TD}>{b.shopee_canceled_orders != null ? fmtCount(b.shopee_canceled_orders) : TRACO}</td>
                      <CelulaTaxa texto={fmtRate(b.shopee_cancel_rate_pct ?? null)} valor={b.shopee_cancel_rate_pct ?? null} peso={pesoShCancelDetalhe[k]} cor={COR_CANAL.shopee} />
                      <td className={TD}>{b.shopee_returned_orders != null ? fmtCount(b.shopee_returned_orders) : TRACO}</td>
                      <CelulaTaxa texto={fmtRate(b.shopee_return_rate_pct ?? null)} valor={b.shopee_return_rate_pct ?? null} peso={pesoShDevolDetalhe[k]} cor={COR_CANAL.shopee} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollHint>
          </Panel>
        )}
      </Aba>
      <KpiDrilldownDialog
        open={detalhe != null}
        onClose={() => setDetalhe(null)}
        title={detalhe ? tituloDoDetalhe(detalhe) : ""}
        icone={detalhe ? VISUAL_QUALIDADE[detalhe].icone : undefined}
        identidade={detalhe ? VISUAL_QUALIDADE[detalhe].identidade : undefined}
      >
        {detalhe && dataIsFresh && (
          <QualidadeDrilldownContent chave={detalhe} kpis={displayKpis} marcas={displayBrands} periodLabel={periodLabel} refreshedAt={displayRefreshedAt} />
        )}
      </KpiDrilldownDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pecas da pagina
// ---------------------------------------------------------------------------
const TD = "px-4 py-3 text-right tabular-nums text-ink-muted";
const TD_MARCA = "whitespace-nowrap px-4 py-3 font-semibold text-ink";
const TRACO = <span className="text-ink-faint">—</span>;

/** Taxa com a barrinha na cor do canal; a faixa (2% / 5%) pinta so' a tinta do numero. Sem dado: "—", sem barra. */
function CelulaTaxa({ texto, valor, peso, cor }: { texto: string; valor: number | null; peso: number | null; cor: string }) {
  return (
    <td className="px-4 py-3 text-right">
      {valor == null || peso == null ? (
        <span className="text-ink-faint">{texto}</span>
      ) : (
        <CelulaBarra valor={<span className={`font-semibold ${cancelColor(valor)}`}>{texto}</span>} peso={peso} cor={cor} />
      )}
    </td>
  );
}

/** Uma barra por marca (maior -> menor), na cor do canal escolhido no painel; "Sem dado" escrito, sem barra. */
function BarrasPorMarca({ linhas, cor, carregando }: { linhas: LinhaMarca[]; cor: string; carregando: boolean }) {
  if (carregando) return <div role="status" className="h-40 animate-pulse rounded-lg bg-raised motion-reduce:animate-none"><span className="sr-only">Carregando…</span></div>;
  if (!linhas.some((l) => !l.ausente)) return <StateBlock tipo="vazio" compacto titulo="Sem dado no período" />;
  return (
    <ol className="flex flex-col gap-2.5">
      {linhas.map((l) => (
        <li key={l.brand} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{l.label}</span>
            <span className={`shrink-0 tabular-nums ${l.ausente ? "text-ink-faint" : "font-semibold text-ink"}`}>{l.valor}</span>
          </div>
          {l.pct != null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
              <div className={`tc-barra h-full rounded-full ${cor}`} style={{ width: `${Math.max(l.pct, 2)}%` }} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function QualityPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <QualityPageInner />
    </Suspense>
  );
}
