"use client";

/**
 * Financeiro — UX-TORRE-B2B-1.
 *
 * Narrativa da tela, de cima para baixo:
 *   1. Por canal: receita (GMV) e cada componente de custo que a fonte do
 *      canal ENTREGA, em R$ e % do GMV — ou a declaracao de que nao entrega.
 *   2. O que ainda esta FORA da conta (margem nao fechada), nomeado.
 *   3. Taxa do marketplace por marca x canal, em grafico.
 *   4. As tres tabelas por marca, densas, com ordenacao.
 *
 * Nenhuma regra de negocio mudou: mesma requisicao, mesma guarda de frescor,
 * mesmas faixas de cor (ROAS, ACOS, taxas). A unica informacao NOVA na tela
 * e' a tarifa do Mercado Livre (`ml_fees` / `ml_avg_fee_pct`), campo que a API
 * ja' entrega desde o MARGEM-REAL-2 e que a tela ainda declarava ausente.
 * Nada aqui se chama "margem": componentes conhecidos nao fecham margem.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleDollarSign, Megaphone, Percent, Receipt } from "lucide-react";
import {
  fetchFinanceiro,
  fetchTrend,
  type FinanceiroKpis,
  type FinanceiroBrandRow,
} from "@/lib/api-client";
// T-0085: "parcial (N de M marcas)" do % consolidado (helper puro, testavel no node --test).
import { textoCoberturaFinanceiro } from "@/lib/full-visao-geral";
import { isMarketplaceSelected } from "@/lib/marketplace-filter";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import { mergeFilteredHref } from "@/lib/filters/nav-links";
import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import Aba, { type VisaoDaAba } from "@/components/layout/Aba";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import CelulaBarra from "@/components/ui/CelulaBarra";
import Segmented from "@/components/ui/Segmented";
import Note from "@/components/ui/Note";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import FaixaFinanceiro, { GRADE_FINANCEIRO, type PainelCanal } from "@/components/financeiro/FinanceiroCartoes";
import { serieQueConfere } from "@/lib/financeiro-cartoes";
import FinanceiroDrilldownContent from "@/components/financeiro/FinanceiroDrilldownContent";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import FaixaCarregando from "@/components/ui/FaixaCarregando";

import { fmtBrlCurto, fmtPctSimples, fmtVezes } from "@/lib/formatters";
import { fmtPeriodo, mockLimitationNote } from "@/lib/filters/format";
import { detectPreset } from "@/lib/filters/presets";
import { useSortableTable } from "@/lib/use-sortable-table";
import SortHeader from "@/components/ui/SortHeader";
import TableScrollHint from "@/components/TableScrollHint";
import { buildFinanceiroRequestKey } from "@/lib/financeiro-request-key";
import { computeRequestStatus } from "@/lib/request-freshness";

type Canal = PainelCanal["canal"];
type Visao = "geral" | Canal;

const NOME: Record<Canal, string> = { tiktok: "TikTok Shop", ml: "Mercado Livre", shopee: "Shopee" };
const PONTO: Record<Canal, string> = { tiktok: "bg-canal-tiktok", ml: "bg-canal-ml", shopee: "bg-canal-shopee" };
const COR: Record<Canal, string> = {
  tiktok: "rgb(var(--tc-canal-tiktok))",
  ml: "rgb(var(--tc-canal-ml))",
  shopee: "rgb(var(--tc-canal-shopee))",
};
/** Cada canal mede uma taxa propria: o rotulo diz qual, e elas nunca se somam. */
const ROTULO_TAXA: Record<Canal, string> = {
  tiktok: "TikTok · taxas e encargos",
  ml: "Mercado Livre · tarifa",
  shopee: "Shopee · taxas e encargos",
};
/** As ancoras de sempre (#tiktok, #mercado-livre, #shopee) escolhem a aba. */
const ANCORA: Record<Canal, string> = { tiktok: "#tiktok", ml: "#mercado-livre", shopee: "#shopee" };
const FAIXAS_TAXA = "Taxas e encargos / GMV: abaixo de 20% neutro · 20–30% atenção · acima de 30% crítico.";

function fmtPct(v: number | null): string {
  return v == null ? "—" : fmtPctSimples(v);
}

function fmtRoas(v: number | null): string {
  return v == null ? "—" : fmtVezes(v);
}

function roasColor(v: number | null): string {
  if (v == null) return "text-ink-faint";
  if (v >= 10) return "text-ok-ink";
  if (v >= 5) return "text-warn-ink";
  return "text-crit-ink";
}

function acosColor(v: number | null): string {
  if (v == null) return "text-ink-faint";
  if (v <= 15) return "text-ok-ink";
  if (v <= 25) return "text-warn-ink";
  return "text-crit-ink";
}

function totalCostColor(v: number | null): string {
  if (v == null) return "text-ink-faint";
  if (v <= 18) return "text-ok-ink";
  if (v <= 25) return "text-warn-ink";
  return "text-crit-ink";
}

function feePctColor(v: number | null): string {
  if (v == null) return "text-ink-faint";
  if (v < 20) return "text-ink-muted";
  if (v < 30) return "text-warn-ink";
  return "text-crit-ink";
}

function CostBar({ adPct, freteP }: { adPct: number | null; freteP: number | null }) {
  if (adPct == null && freteP == null) return null;
  const ad = Math.max(0, adPct ?? 0);
  const frete = Math.max(0, freteP ?? 0);
  const total = Math.min(100, ad + frete);
  const rest = Math.max(0, 100 - total);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-raised flex">
        {/* Composicao, nao estado: cor de serie, nunca ok/warn/crit. */}
        <div className="h-full bg-chart-2" style={{ width: `${ad}%` }} />
        <div className="h-full bg-chart-4" style={{ width: `${frete}%` }} />
        <div className="h-full bg-raised" style={{ width: `${rest}%` }} />
      </div>
      <span className={`text-xs tabular-nums w-11 text-right shrink-0 font-semibold ${totalCostColor(ad + frete)}`}>
        {fmtPctSimples(ad + frete)}
      </span>
    </div>
  );
}

/** Tom da pilula de taxa no cartao: os MESMOS limiares de `feePctColor`. */
function tomTaxa(v: number): "neutro" | "warn" | "crit" {
  return v < 20 ? "neutro" : v < 30 ? "warn" : "crit";
}

/** Classes das celulas: densidade do benchmark com o piso de 13px de dado. */
const TD = "px-4 py-2.5 text-right tabular-nums";
const TD_MARCA = "px-4 py-2.5 font-semibold text-ink whitespace-nowrap";
const TR = "hover:bg-raised/70 transition-colors";
const LINK_MARCA =
  "hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded";

function FinanceiroPageInner() {
  const [filters, setFilters, padrao] = useGlobalFilters({ defaultPreset: "mes_anterior" });
  const searchParams = useSearchParams();
  const filter = filters.channels; // alias — preserva as referencias existentes abaixo
  const [kpis, setKpis] = useState<FinanceiroKpis | null>(null);
  const [brands, setBrands] = useState<FinanceiroBrandRow[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Canal aberto no detalhe (dialogo unico da pagina).
  const [detalhe, setDetalhe] = useState<PainelCanal["canal"] | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  // Chave da ultima requisicao resolvida com sucesso — comparada com a
  // chave atual para decidir se o estado em memoria reflete de fato os
  // filtros exibidos agora.
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  // GMV por dia do MESMO recorte, para a linha do cartao da soma (uma chamada so': o Data Mart e' em fila).
  const [serie, setSerie] = useState<{ key: string; pontos: number[] } | null>(null);
  const [visao, setVisao] = useState<Visao>("geral");
  const [canalTaxa, setCanalTaxa] = useState<Canal>("tiktok");
  useEffect(() => {
    const aplicar = () => {
      const canal = (Object.keys(ANCORA) as Canal[]).find((c) => ANCORA[c] === window.location.hash);
      if (canal) setVisao(canal);
    };
    aplicar();
    window.addEventListener("hashchange", aplicar);
    return () => window.removeEventListener("hashchange", aplicar);
  }, []);
  const escolherVisao = (v: Visao) => {
    setVisao(v);
    // A aba fica no link (as ancoras antigas continuam valendo), sem rolar a pagina.
    window.history.replaceState(null, "", v === "geral" ? window.location.pathname + window.location.search : ANCORA[v]);
  };

  const requestKey = useMemo(
    () => buildFinanceiroRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, compare: filters.compare, retryKey }),
    [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, filters.compare, retryKey],
  );

  useEffect(() => {
    // Ignora a resposta se os filtros mudarem antes dela chegar.
    let ignore = false;
    setLoading(true);
    setError(null);
    const key = buildFinanceiroRequestKey({ channels: filters.channels, brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, compare: filters.compare, retryKey });
    const opts = { brands: filters.brands, dateFrom: filters.dateFrom, dateTo: filters.dateTo, compare: filters.compare };
    // Falhou ou veio vazia: o cartao fica sem linha, nunca com linha inventada.
    fetchTrend(filters.channels, opts, "day")
      .then((t) => { if (!ignore) setSerie(t.live ? { key, pontos: t.data.map((p) => p.gmv) } : null); })
      .catch(() => { if (!ignore) setSerie(null); });
    fetchFinanceiro(filters.channels, undefined, opts)
      .then((result) => {
        if (ignore) return;
        setKpis(result.kpis);
        setBrands(result.brands);
        setIsLive(result.live);
        setRefreshedAt(result.meta.refreshedAt);
        setResolvedKey(key);
        setLoading(false);
      })
      .catch(() => {
        if (ignore) return;
        setError("Falha ao carregar dados financeiros.");
        // A chave precisa ser marcada como resolvida MESMO na falha — senao
        // `computeRequestStatus` nunca sai de "loading" (resolvedKey nunca
        // bate com requestKey) e a falha da requisicao atual nunca vira
        // "error" de fato (fica presa em loading para sempre).
        setResolvedKey(key);
        setLoading(false);
      });
    return () => { ignore = true; };
  }, [filters.channels, filters.brands, filters.dateFrom, filters.dateTo, filters.compare, retryKey]);

  // FINDING 2 (rodada de correcao) — loading/error/fresh SEPARADOS: depois
  // de um erro definitivo, `dataIsFresh` fica `false` para sempre, mas
  // `isLoadingState` tambem precisa ficar `false` (senao skeleton/opacidade/
  // aria-busy continuariam ligados como se ainda estivesse buscando).
  const requestStatus = computeRequestStatus({ loading, error: error != null, resolvedKey, requestKey });
  const dataIsFresh = requestStatus.fresh;
  const isLoadingState = requestStatus.loading;
  const isErrorState = requestStatus.error;

  // Versoes protegidas do estado bruto — nenhum calculo/card/tabela/link
  // abaixo deve ler kpis/brands/isLive/refreshedAt diretamente.
  const displayKpis = dataIsFresh ? kpis : null;
  const displayBrands = dataIsFresh ? brands : [];
  const displayIsLive = dataIsFresh ? isLive : false;
  const displayRefreshedAt = dataIsFresh ? refreshedAt : null;

  const buildHref = useMemo(() => (href: string) => mergeFilteredHref(href, searchParams), [searchParams]);

  const periodLabel = fmtPeriodo(filters.dateFrom, filters.dateTo);

  const showTiktok = isMarketplaceSelected(filter, "tiktok");
  const showMl = isMarketplaceSelected(filter, "ml");
  const showShopee = isMarketplaceSelected(filter, "shopee");

  const tkBrands = displayBrands.filter((b) => b.tiktok_gmv != null);
  const mlBrands = displayBrands.filter((b) => b.ml_ad_spend != null);
  const shBrands = displayBrands.filter((b) => b.shopee_gmv != null);

  const tkColumnTypes = useMemo(() => ({
    brand: "text" as const, gmv: "numeric" as const, fees: "numeric" as const,
    fee_pct: "numeric" as const, settlement_pct: "numeric" as const, settlement: "numeric" as const,
  }), []);
  const tkGetValue = (row: FinanceiroBrandRow, column: string): string | number | null => {
    switch (column) {
      case "brand": return row.label;
      case "gmv": return row.tiktok_gmv;
      case "fees": return row.tiktok_fees;
      case "fee_pct": return row.tiktok_avg_fee_pct;
      case "settlement_pct": return row.tiktok_avg_settlement_pct;
      case "settlement": return row.tiktok_settlement;
      default: return null;
    }
  };
  const tkSort = useSortableTable(tkBrands, tkGetValue, tkColumnTypes);

  const mlColumnTypes = useMemo(() => ({
    brand: "text" as const, gmv: "numeric" as const, fees: "numeric" as const, fee_pct: "numeric" as const,
    ad_spend: "numeric" as const, ad_revenue: "numeric" as const, roas: "numeric" as const, acos: "numeric" as const,
    frete: "numeric" as const, cost_pct: "numeric" as const,
  }), []);
  const mlGetValue = (row: FinanceiroBrandRow, column: string): string | number | null => {
    switch (column) {
      case "brand": return row.label;
      case "gmv": return row.ml_gmv;
      // UX-TORRE-B2B-1: tarifa ML, campo ja' entregue pela API (MARGEM-REAL-2).
      case "fees": return row.ml_fees ?? null;
      case "fee_pct": return row.ml_avg_fee_pct ?? null;
      case "ad_spend": return row.ml_ad_spend;
      case "ad_revenue": return row.ml_ad_revenue;
      case "roas": return row.ml_roas;
      case "acos": return row.ml_acos_pct;
      case "frete": return row.ml_seller_shipping_cost;
      case "cost_pct": return (row.ml_ad_spend != null && row.ml_gmv != null && row.ml_gmv > 0)
        ? (row.ml_ad_spend / row.ml_gmv) * 100 + (row.ml_shipping_pct_of_gmv ?? 0)
        : null;
      default: return null;
    }
  };
  const mlSort = useSortableTable(mlBrands, mlGetValue, mlColumnTypes);

  const shColumnTypes = useMemo(() => ({
    brand: "text" as const, gmv: "numeric" as const, fees: "numeric" as const,
    fee_pct: "numeric" as const, settlement: "numeric" as const, ad_spend: "numeric" as const,
    roas: "numeric" as const, frete: "numeric" as const,
  }), []);
  const shGetValue = (row: FinanceiroBrandRow, column: string): string | number | null => {
    switch (column) {
      case "brand": return row.label;
      case "gmv": return row.shopee_gmv ?? null;
      case "fees": return row.shopee_fees ?? null;
      case "fee_pct": return row.shopee_avg_fee_pct ?? null;
      case "settlement": return row.shopee_settlement ?? null;
      case "ad_spend": return row.shopee_ad_spend ?? null;
      case "roas": return row.shopee_roas ?? null;
      case "frete": return row.shopee_shipping_cost ?? null;
      default: return null;
    }
  };
  const shSort = useSortableTable(shBrands, shGetValue, shColumnTypes);

  const canais: Canal[] = [
    ...(showTiktok ? (["tiktok"] as const) : []),
    ...(showMl ? (["ml"] as const) : []),
    ...(showShopee ? (["shopee"] as const) : []),
  ];
  // Taxa por marca: so' os canais selecionados e so' o que a API entrega por linha.
  // Marca sem nenhum valor nos canais visiveis sai.
  const linhasTaxa = displayBrands
    .map((b) => ({
      brand: b.brand,
      marca: b.label,
      tiktok: showTiktok ? b.tiktok_avg_fee_pct : null,
      ml: showMl ? b.ml_avg_fee_pct ?? null : null,
      shopee: showShopee ? b.shopee_avg_fee_pct ?? null : null,
    }))
    .filter((l) => l.tiktok != null || l.ml != null || l.shopee != null);
  const maior = (xs: (number | null | undefined)[]) => Math.max(0, ...xs.map((x) => x ?? 0));
  // Uma escala so' para as barrinhas: 33% no TikTok e 16% no ML se comparam no olho.
  const maiorTaxa = maior(linhasTaxa.flatMap((l) => canais.map((c) => l[c])));
  const canalDoRanking: Canal = canais.includes(canalTaxa) ? canalTaxa : canais[0] ?? "tiktok";
  const ranking = linhasTaxa
    .flatMap((l) => { const v = l[canalDoRanking]; return v != null ? [{ marca: l.marca, v }] : []; })
    .sort((a, b) => b.v - a.v);
  const maiorGmv = {
    tiktok: maior(tkBrands.map((b) => b.tiktok_gmv)),
    ml: maior(mlBrands.map((b) => b.ml_gmv)),
    shopee: maior(shBrands.map((b) => b.shopee_gmv)),
  };

  const k = displayKpis;
  // Marcas com venda no ML no recorte mas sem tarifa carregada.
  const mlSemTarifa = displayBrands.filter((b) => b.ml_gmv != null && b.ml_gmv > 0 && b.ml_fees == null).length;
  // Um painel por canal selecionado: o cartao de GMV mostra o numero e o detalhe (clique) traz os
  // componentes de custo CONHECIDOS. Nada e' somado: fontes e denominadores diferentes.
  const paineis: PainelCanal[] = [];
  if (showTiktok) {
    paineis.push({
      canal: "tiktok", titulo: "TikTok Shop", ponto: "bg-canal-tiktok", gmv: k?.tiktok_gmv ?? null,
      pilula: k?.tiktok_avg_fee_pct != null ? { texto: `taxas ${fmtPct(k.tiktok_avg_fee_pct)}`, tom: tomTaxa(k.tiktok_avg_fee_pct) } : null,
      linhas: [
        {
          rotulo: "Taxas e encargos",
          valor: k?.tiktok_fees != null ? fmtBrlCurto(k.tiktok_fees) : null,
          pct: k?.tiktok_avg_fee_pct ?? null,
          pctTexto: k?.tiktok_avg_fee_pct != null ? fmtPct(k.tiktok_avg_fee_pct) : "—",
          // T-0085: o % so' cobre as marcas com o dado; diz quantas.
          detalhe: textoCoberturaFinanceiro(k?.tiktok_fee_cobertura) ?? undefined,
        },
        {
          rotulo: "Repasse recebido",
          valor: k?.tiktok_settlement != null ? fmtBrlCurto(k.tiktok_settlement) : "—",
          pct: k?.tiktok_avg_settlement_pct ?? null,
          pctTexto: k?.tiktok_avg_settlement_pct != null ? `${fmtPct(k.tiktok_avg_settlement_pct)} do GMV` : null,
          detalhe: [textoCoberturaFinanceiro(k?.tiktok_settlement_cobertura), "Competências podem divergir."].filter(Boolean).join(". "),
        },
        { rotulo: "Ads (mídia)", ausente: "Sem fonte" },
        { rotulo: "Frete do seller", ausente: "Sem fonte" },
      ],
    });
  }
  if (showMl) {
    paineis.push({
      canal: "ml", titulo: "Mercado Livre", ponto: "bg-canal-ml", gmv: k?.ml_gmv ?? null,
      // A tarifa do ML nao tem faixa de negocio: pilula neutra.
      pilula: k?.ml_avg_fee_pct != null ? { texto: `tarifa ${fmtPct(k.ml_avg_fee_pct)}`, tom: "neutro" } : null,
      // T-0085: o % consolidado ja' divide so' pelo GMV das marcas com tarifa; o aviso diz que o total e' parcial.
      // O ⓘ fica ao lado do GMV: diz DE QUAL numero fala (os custos), para nao ser lido como ressalva do GMV.
      aviso: mlSemTarifa > 0 ? `Custos: tarifa parcial, ${mlSemTarifa} ${mlSemTarifa === 1 ? "marca sem tarifa" : "marcas sem tarifa"}. Veja no detalhe.` : undefined,
      linhas: [
        k?.ml_fees != null
          ? {
              rotulo: "Tarifa ML",
              valor: fmtBrlCurto(k.ml_fees),
              pct: k.ml_avg_fee_pct ?? null,
              pctTexto: fmtPct(k.ml_avg_fee_pct ?? null),
              detalhe:
                textoCoberturaFinanceiro(k.ml_fee_cobertura)
                  ? `${textoCoberturaFinanceiro(k.ml_fee_cobertura)}. Só a tarifa; sem Ads e frete.`
                  : mlSemTarifa > 0
                    ? `Parcial: ${mlSemTarifa} ${mlSemTarifa === 1 ? "marca sem tarifa" : "marcas sem tarifa"}. Só a tarifa; sem Ads e frete.`
                    : "Só a tarifa; sem Ads e frete.",
            }
          : { rotulo: "Tarifa ML", ausente: "Não carregada neste período" },
        {
          rotulo: "Ads (mídia)",
          valor: k?.ml_ad_spend != null ? fmtBrlCurto(k.ml_ad_spend) : "—",
          // Sem barra de proposito: Ads/GMV do canal nao e' campo da API, e uma barra sem numero seria uma razao nova muda.
          detalhe: (
            <>
              ROAS <span className={`font-semibold ${roasColor(k?.ml_roas ?? null)}`}>{fmtRoas(k?.ml_roas ?? null)}</span>
              {k?.ml_acos_pct != null && <> · ACOS {fmtPct(k.ml_acos_pct)}</>}
            </>
          ),
        },
        {
          rotulo: "Ads + frete / GMV",
          pct: k?.ml_total_cost_pct ?? null,
          pctTexto: k?.ml_total_cost_pct != null ? fmtPct(k.ml_total_cost_pct) : "—",
          detalhe: "Não inclui a tarifa ML.",
        },
      ],
    });
  }
  if (showShopee) {
    paineis.push({
      canal: "shopee", titulo: "Shopee", ponto: "bg-canal-shopee", gmv: k?.shopee_gmv ?? null,
      pilula: k?.shopee_avg_fee_pct != null
        ? { texto: `taxas ${fmtPct(k.shopee_avg_fee_pct)}`, tom: tomTaxa(k.shopee_avg_fee_pct) }
        : { texto: "sem dado de taxa", tom: "neutro" },
      linhas: [
        {
          rotulo: "Taxas e encargos",
          valor: k?.shopee_fees != null ? fmtBrlCurto(k.shopee_fees) : null,
          pct: k?.shopee_avg_fee_pct ?? null,
          pctTexto: k?.shopee_avg_fee_pct != null ? fmtPct(k.shopee_avg_fee_pct) : "—",
          // T-0085: sem isto, 25% de uma marca so' lia como taxa do canal inteiro.
          detalhe: textoCoberturaFinanceiro(k?.shopee_fee_cobertura) ?? undefined,
        },
        {
          rotulo: "Ads (mídia)",
          valor: k?.shopee_ad_spend != null ? fmtBrlCurto(k.shopee_ad_spend) : "—",
          detalhe: (
            <>
              ROAS{" "}
              <span className={`font-semibold ${roasColor(k?.shopee_roas ?? null)}`}>
                {k?.shopee_roas != null ? fmtRoas(k.shopee_roas) : "—"}
              </span>
            </>
          ),
        },
        { rotulo: "Frete do seller", ausente: "Só por marca" },
      ],
    });
  }
  const painelAberto = paineis.find((x) => x.canal === detalhe) ?? null;
  const vazio = dataIsFresh && displayBrands.length === 0;
  // So' o GMV soma entre canais; custos nunca.
  const comGmv = paineis.filter((p) => p.gmv != null);
  const receita = comGmv.length > 0 ? comGmv.reduce((s, p) => s + (p.gmv ?? 0), 0) : null;
  const serieReceita = dataIsFresh && serie?.key === requestKey ? serieQueConfere(serie.pontos, receita) : null;
  const visoes: VisaoDaAba<Visao>[] = [
    { id: "geral", rotulo: "Visão geral" },
    ...canais.map((c) => ({ id: c, rotulo: NOME[c], ponto: PONTO[c] })),
  ];
  const visaoAtiva: Visao = visao !== "geral" && canais.includes(visao) ? visao : "geral";

  return (
    <Aba<Visao>
      titulo="Financeiro"
      selo={
        // Selo so' com dado fresco — nunca o estado da requisicao ANTERIOR
        // durante a transicao de filtro.
        <SeloAtualizado em={displayRefreshedAt} aoVivo={dataIsFresh ? displayIsLive : null} carregando={isLoadingState} />
      }
      visoes={visoes}
      visao={visaoAtiva}
      onVisao={escolherVisao}
      filtros={<GlobalFilterControls filters={filters} onChange={setFilters} hideCompare loading={isLoadingState} padrao={padrao} />}
      faixa={
        isErrorState || vazio ? null : isLoadingState ? (
          <FaixaCarregando cartoes={4} className={GRADE_FINANCEIRO} />
        ) : (
          <FaixaFinanceiro
            paineis={paineis}
            total={receita}
            serieTotal={serieReceita}
            foraDaConta={`Margem ainda não fechada. Fora da conta: CMV, impostos, devoluções${showTiktok ? ", frete e afiliados do TikTok" : ""}.`}
            onAbrir={setDetalhe}
          />
        )
      }
    >
      {dataIsFresh && (() => {
        const isCustomPeriod = detectPreset(filters.dateFrom, filters.dateTo) !== "mes_anterior";
        const note = mockLimitationNote(displayIsLive, filters.brands, isCustomPeriod);
        return note && <Note tom="atencao">{note}</Note>;
      })()}

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {isLoadingState ? "Carregando dados financeiros..." : isErrorState ? "Falha ao carregar." : "Dados financeiros carregados."}
      </span>

      {isErrorState ? (
        // FINDING 2: erro definitivo mostra so cabecalho/filtros e o estado de
        // erro — nunca skeleton, nunca dado antigo, nunca `aria-busy=true`.
        <StateBlock
          tipo="erro"
          titulo="Não foi possível carregar os dados financeiros."
          descricao={error ?? undefined}
          acao={<RetryButton onClick={() => { setError(null); setRetryKey((n) => n + 1); }} />}
        />
      ) : vazio ? (
        <StateBlock
          tipo="vazio"
          titulo="Sem dados financeiros no período e filtros selecionados."
          descricao="Tente ampliar o intervalo de datas ou revisar canal/marca."
        />
      ) : (
      <>
        {visaoAtiva === "geral" && (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* ── Taxa do marketplace por marca: um canal por vez, nunca somados ── */}
              <Panel
                titulo="Taxa do marketplace sobre o GMV"
                ajuda={`Cada canal mede uma taxa própria, nunca somadas. ${canais.map((c) => ROTULO_TAXA[c]).join("; ")}.`}
                acao={
                  canais.length > 1 ? (
                    <Segmented rotulo="Canal da taxa" valor={canalDoRanking} aoEscolher={setCanalTaxa} opcoes={canais.map((c) => ({ valor: c, texto: NOME[c] }))} />
                  ) : undefined
                }
              >
                {!dataIsFresh ? (
                  <div className="h-[180px] animate-pulse rounded-lg bg-raised" aria-hidden="true" />
                ) : ranking.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-faint">Sem taxa carregada neste canal no período.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {ranking.map((r) => (
                      <li key={r.marca} className="grid grid-cols-[minmax(0,6.5rem)_1fr_3.5rem] items-center gap-3 text-sm">
                        <span className="truncate font-medium text-ink">{r.marca}</span>
                        <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-raised">
                          <span className={`tc-barra block h-full rounded-full ${PONTO[canalDoRanking]}`} style={{ width: `${(r.v / ranking[0].v) * 100}%` }} />
                        </span>
                        <span className="text-right font-semibold tabular-nums text-ink">{fmtPct(r.v)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* ── Receita por canal: composicao (identidade do canal, nunca estado) ── */}
              <Panel
                titulo="Receita por canal"
                acao={
                  showTiktok ? (
                    <Link href={buildHref("/canais#afiliados")} className="inline-flex min-h-11 items-center rounded text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      Afiliados em Canais →
                    </Link>
                  ) : undefined
                }
              >
                {!dataIsFresh ? (
                  <div className="h-[180px] animate-pulse rounded-lg bg-raised" aria-hidden="true" />
                ) : receita == null ? (
                  <p className="py-6 text-center text-sm text-ink-faint">Sem receita no período.</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div aria-hidden="true" className="tc-barra flex h-3 gap-0.5 overflow-hidden rounded-full">
                      {comGmv.map((p) => (
                        <span key={p.canal} className={`h-full ${p.ponto}`} style={{ flexGrow: p.gmv ?? 0 }} />
                      ))}
                    </div>
                    <ul className="flex flex-col gap-2.5">
                      {paineis.map((p) => (
                        <li key={p.canal} className="flex items-center gap-2 text-sm">
                          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${p.ponto}`} />
                          <span className="min-w-0 flex-1 truncate text-ink-muted">{p.titulo}</span>
                          <span className="font-semibold tabular-nums text-ink">{p.gmv != null ? fmtBrlCurto(p.gmv) : "—"}</span>
                          <span className="w-14 text-right tabular-nums text-ink-faint">{p.gmv != null ? fmtPct((p.gmv / receita) * 100) : ""}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            </div>

            {/* ── Taxas por marca x canal: barrinha na cor do canal, sem mapa de calor ── */}
            {(dataIsFresh ? linhasTaxa.length > 0 : true) && (
              <Panel titulo="Taxas por marca" semPadding>
                <TableScrollHint>
                  <table className="w-full text-data" aria-label="Taxa do marketplace sobre o GMV, por marca e canal">
                    <thead>
                      <tr className="bg-raised text-left">
                        <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Marca</th>
                        {canais.map((c) => (
                          <th key={c} scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted">{ROTULO_TAXA[c]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className={`divide-y divide-line transition-opacity duration-200 ${isLoadingState ? "opacity-50" : ""}`}>
                      {linhasTaxa.map((l) => (
                        <tr key={l.brand} className={TR}>
                          <td className={TD_MARCA}>
                            <Link href={buildHref(`/brand/${l.brand}?brands=${l.brand}`)} className={LINK_MARCA}>{l.marca}</Link>
                          </td>
                          {canais.map((c) => {
                            const v = l[c];
                            return (
                              <td key={c} className={TD}>
                                {v != null ? <CelulaBarra valor={fmtPct(v)} peso={maiorTaxa > 0 ? v / maiorTaxa : 0} cor={COR[c]} /> : <span className="text-ink-faint">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollHint>
              </Panel>
            )}
          </>
        )}

        {/* ── 4a. Tabela: Repasses TikTok ── */}
        {visaoAtiva === "tiktok" && (
          <Panel
            id="tiktok"
            titulo="Repasses TikTok"
            ajuda={`Repasse e GMV podem ter competências diferentes: o repasse pode incluir pedidos de outros meses.\n${FAIXAS_TAXA}`}
            icone={Receipt}
            semPadding
          >
            <TableScrollHint>
              <table className="w-full text-data" aria-label="Repasses TikTok por marca">
                <thead>
                  <tr className="bg-raised text-left">
                    <SortHeader rotulo="Marca" coluna="brand" sort={tkSort.sort} aoOrdenar={tkSort.toggleSort} alinhamento="left" />
                    <SortHeader rotulo="GMV" coluna="gmv" sort={tkSort.sort} aoOrdenar={tkSort.toggleSort} />
                    <SortHeader rotulo="Taxas (R$)" coluna="fees" sort={tkSort.sort} aoOrdenar={tkSort.toggleSort} />
                    <SortHeader rotulo="Taxas e encargos %" coluna="fee_pct" sort={tkSort.sort} aoOrdenar={tkSort.toggleSort} />
                    <SortHeader rotulo="Repasse %" coluna="settlement_pct" sort={tkSort.sort} aoOrdenar={tkSort.toggleSort} />
                    <SortHeader rotulo="Repasse Recebido" coluna="settlement" sort={tkSort.sort} aoOrdenar={tkSort.toggleSort} />
                  </tr>
                </thead>
                <tbody className={`divide-y divide-line transition-opacity duration-200 ${isLoadingState ? "opacity-50" : ""}`}>
                  {tkBrands.length === 0 && dataIsFresh && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-ink-faint text-sm">
                        Sem dados para o periodo selecionado.
                      </td>
                    </tr>
                  )}
                  {tkSort.sortedRows.map((b) => (
                    <tr key={b.brand} className={TR}>
                      <td className={TD_MARCA}>
                        <Link href={buildHref(`/brand/${b.brand}?brands=${b.brand}&channels=tiktok`)} className={LINK_MARCA}>
                          {b.label}
                        </Link>
                      </td>
                      <td className={TD}><CelulaBarra valor={fmtBrlCurto(b.tiktok_gmv!)} peso={maiorGmv.tiktok > 0 ? b.tiktok_gmv! / maiorGmv.tiktok : 0} cor={COR.tiktok} /></td>
                      <td className={`${TD} text-ink-muted`}>{fmtBrlCurto(b.tiktok_fees!)}</td>
                      <td className={`${TD} font-semibold ${feePctColor(b.tiktok_avg_fee_pct)}`}>
                        {fmtPct(b.tiktok_avg_fee_pct)}
                      </td>
                      <td className={`${TD} text-ink-muted`}>{fmtPct(b.tiktok_avg_settlement_pct)}</td>
                      <td className={`${TD} text-ink font-bold`}>{fmtBrlCurto(b.tiktok_settlement!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollHint>
          </Panel>
        )}

        {/* ── 4b. Tabela: Tarifa, publicidade e custos ML ── */}
        {visaoAtiva === "ml" && (
          <Panel
            id="mercado-livre"
            titulo="Tarifa, publicidade e custos ML"
            ajuda={`Ads + Frete / GMV não inclui a tarifa do Mercado Livre. Tarifa ML = só a comissão do marketplace; não é margem. Receita Ads = GMV atribuído a anúncios.\nROAS: acima de 10x bom · 5x–10x atenção · abaixo de 5x crítico.\nBarra de Ads + Frete / GMV: primeiro trecho Ads, segundo frete.`}
            icone={Megaphone}
            semPadding
          >
            <TableScrollHint>
              <table className="w-full text-data" aria-label="Tarifa, publicidade e custos ML por marca">
                <thead>
                  <tr className="bg-raised text-left">
                    <SortHeader rotulo="Marca" coluna="brand" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} alinhamento="left" />
                    <SortHeader rotulo="GMV ML" coluna="gmv" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="Tarifa ML" coluna="fees" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="Tarifa %" coluna="fee_pct" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="Ad Spend" coluna="ad_spend" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="Receita Ads" coluna="ad_revenue" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="ROAS" coluna="roas" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="ACOS" coluna="acos" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="Frete" coluna="frete" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} />
                    <SortHeader rotulo="Ads + Frete / GMV" coluna="cost_pct" sort={mlSort.sort} aoOrdenar={mlSort.toggleSort} alinhamento="left" />
                  </tr>
                </thead>
                <tbody className={`divide-y divide-line transition-opacity duration-200 ${isLoadingState ? "opacity-50" : ""}`}>
                  {mlBrands.length === 0 && dataIsFresh && (
                    <tr>
                      <td colSpan={10} className="px-6 py-8 text-center text-ink-faint text-sm">
                        Sem dados de anuncios ML para o periodo selecionado.
                      </td>
                    </tr>
                  )}
                  {mlSort.sortedRows.map((b) => {
                    const adPct = b.ml_ad_spend != null && b.ml_gmv != null && b.ml_gmv > 0
                      ? b.ml_ad_spend / b.ml_gmv * 100
                      : null;
                    return (
                      <tr key={b.brand} className={TR}>
                        <td className={TD_MARCA}>
                          <Link href={buildHref(`/brand/${b.brand}?brands=${b.brand}&channels=ml`)} className={LINK_MARCA}>
                            {b.label}
                          </Link>
                        </td>
                        <td className={TD}><CelulaBarra valor={fmtBrlCurto(b.ml_gmv!)} peso={maiorGmv.ml > 0 ? b.ml_gmv! / maiorGmv.ml : 0} cor={COR.ml} /></td>
                        <td className={`${TD} text-ink-muted`}>{b.ml_fees != null ? fmtBrlCurto(b.ml_fees) : "—"}</td>
                        <td className={`${TD} text-ink-muted`}>{fmtPct(b.ml_avg_fee_pct ?? null)}</td>
                        <td className={`${TD} text-ink-muted`}>{fmtBrlCurto(b.ml_ad_spend!)}</td>
                        <td className={`${TD} text-ink-muted font-medium`}>
                          {b.ml_ad_revenue != null ? fmtBrlCurto(b.ml_ad_revenue) : "—"}
                        </td>
                        <td className={`${TD} font-semibold ${roasColor(b.ml_roas)}`}>{fmtRoas(b.ml_roas)}</td>
                        <td className={`${TD} font-semibold ${acosColor(b.ml_acos_pct)}`}>{fmtPct(b.ml_acos_pct)}</td>
                        <td className={`${TD} text-ink-muted`}>
                          {b.ml_seller_shipping_cost != null ? fmtBrlCurto(b.ml_seller_shipping_cost) : "—"}
                        </td>
                        <td className="px-4 py-2.5 min-w-[160px]">
                          <CostBar adPct={adPct} freteP={b.ml_shipping_pct_of_gmv} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScrollHint>
          </Panel>
        )}

        {/* ── 4c. Tabela: Taxas e Custos Shopee ── */}
        {visaoAtiva === "shopee" && (
          <Panel
            id="shopee"
            titulo="Taxas e Custos Shopee"
            ajuda={`Total Global (pedidos) não é repasse líquido. Taxas e encargos = comissão + taxa de serviço líquidas, sobre o GMV.\n${FAIXAS_TAXA}`}
            icone={Percent}
            semPadding
          >
            <TableScrollHint>
              <table className="w-full text-data" aria-label="Taxas e custos Shopee por marca">
                <thead>
                  <tr className="bg-raised text-left">
                    <SortHeader rotulo="Marca" coluna="brand" sort={shSort.sort} aoOrdenar={shSort.toggleSort} alinhamento="left" />
                    <SortHeader rotulo="GMV" coluna="gmv" sort={shSort.sort} aoOrdenar={shSort.toggleSort} />
                    <SortHeader rotulo="Taxas (R$)" coluna="fees" sort={shSort.sort} aoOrdenar={shSort.toggleSort} />
                    <SortHeader rotulo="Taxas e encargos %" coluna="fee_pct" sort={shSort.sort} aoOrdenar={shSort.toggleSort} />
                    <SortHeader rotulo="Total Global (pedidos)" coluna="settlement" sort={shSort.sort} aoOrdenar={shSort.toggleSort} />
                    <SortHeader rotulo="Ad Spend" coluna="ad_spend" sort={shSort.sort} aoOrdenar={shSort.toggleSort} />
                    <SortHeader rotulo="ROAS" coluna="roas" sort={shSort.sort} aoOrdenar={shSort.toggleSort} />
                    <SortHeader rotulo="Frete" coluna="frete" sort={shSort.sort} aoOrdenar={shSort.toggleSort} />
                  </tr>
                </thead>
                <tbody className={`divide-y divide-line transition-opacity duration-200 ${isLoadingState ? "opacity-50" : ""}`}>
                  {shBrands.length === 0 && dataIsFresh && (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-ink-faint text-sm">
                        Sem dados Shopee para o periodo selecionado.
                      </td>
                    </tr>
                  )}
                  {shSort.sortedRows.map((b) => (
                    <tr key={b.brand} className={TR}>
                      <td className={TD_MARCA}>
                        <Link href={buildHref(`/brand/${b.brand}?brands=${b.brand}&channels=shopee`)} className={LINK_MARCA}>
                          {b.label}
                        </Link>
                      </td>
                      <td className={TD}><CelulaBarra valor={fmtBrlCurto(b.shopee_gmv!)} peso={maiorGmv.shopee > 0 ? b.shopee_gmv! / maiorGmv.shopee : 0} cor={COR.shopee} /></td>
                      <td className={`${TD} text-ink-muted`}>{b.shopee_fees != null ? fmtBrlCurto(b.shopee_fees) : "—"}</td>
                      <td className={`${TD} font-semibold ${feePctColor(b.shopee_avg_fee_pct ?? null)}`}>
                        {fmtPct(b.shopee_avg_fee_pct ?? null)}
                      </td>
                      <td className={`${TD} text-ink font-bold`}>
                        {b.shopee_settlement != null ? fmtBrlCurto(b.shopee_settlement) : "—"}
                      </td>
                      <td className={`${TD} text-ink-muted`}>{b.shopee_ad_spend != null ? fmtBrlCurto(b.shopee_ad_spend) : "—"}</td>
                      <td className={`${TD} font-semibold ${roasColor(b.shopee_roas ?? null)}`}>
                        {fmtRoas(b.shopee_roas ?? null)}
                      </td>
                      <td className={`${TD} text-ink-muted`}>
                        {b.shopee_shipping_cost != null ? fmtBrlCurto(b.shopee_shipping_cost) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollHint>
          </Panel>
        )}
      </>
      )}
    <KpiDrilldownDialog
      open={detalhe != null && painelAberto != null}
      onClose={() => setDetalhe(null)}
      title={painelAberto ? `GMV · ${painelAberto.titulo}` : ""}
      icone={CircleDollarSign}
      identidade="gmv"
    >
      {painelAberto && dataIsFresh && (
        <FinanceiroDrilldownContent painel={painelAberto} periodLabel={periodLabel} refreshedAt={displayRefreshedAt} />
      )}
    </KpiDrilldownDialog>
    </Aba>
  );
}

export default function FinanceiroPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <FinanceiroPageInner />
    </Suspense>
  );
}
