"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  fetchProdutosML, fetchProdutosTikTok, fetchProdutosShopee,
  fetchProdutosMLSummary, fetchProdutosTikTokSummary, fetchProdutosShopeeSummary,
  type ProdutosMLResponse, type ProdutosTikTokResponse, type ProdutosShopeeListResponse,
  type ProdutosMLSummary, type ProdutosChannelSummary,
} from "@/lib/api-client";
import { scopeUnavailableReason } from "@/lib/scope-quality-display";
import PageContainer from "@/components/layout/PageContainer";
import Aba from "@/components/layout/Aba";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import { AvisoTopo } from "@/components/full/CategoriasEstoque";
import Segmented from "@/components/ui/Segmented";
import { ProductSelect } from "@/components/ProductFilterBar";
import ProductParetoSummary from "@/components/ProductParetoSummary";
import ScopeQualityBanner from "@/components/ScopeQualityBanner";
import InfoDica from "@/components/ui/InfoDica";
import { useProdutosMarcasMenores } from "@/hooks/useProdutosMarcasMenores";
import { MARCAS_MENORES_KEYS, MARCAS_MENORES_OPTIONS } from "@/lib/filters/brands";
import { toISODate } from "@/lib/filters/presets";
import { linhasDoCanal, listaShopee, listaTikTok, periodoDoMes, resumoDoCanal, type CanalProduto } from "@/lib/produtos-marcas-menores";
import ProductExportButton from "@/components/ProductExportButton";
import MercadoLivreProductTable from "@/components/MercadoLivreProductTable";
import TikTokProductTable from "@/components/TikTokProductTable";
import ShopeeProductTable from "@/components/ShopeeProductTable";
import { useSortableTable, type SortColumnType } from "@/lib/use-sortable-table";
import {
  brandSurvivesTabChange, toggleBucketSelection, marginUnavailableNote,
  lastNMonths, type ProdutosTab,
} from "@/lib/produtos-tab-transition";
import { initialChannelState, startFetch, resolveFetch, resolveFetchError, type ChannelState } from "@/lib/async-channel-state";
import { formatProdutosScope } from "@/lib/produtos-scope";
import { fmtBrlExato } from "@/lib/formatters";
import {
  mlRowToExportRecord, tiktokRowToExportRecord, shopeeRowToExportRecord,
  ML_EXPORT_COLUMNS, TIKTOK_EXPORT_COLUMNS, SHOPEE_EXPORT_COLUMNS,
} from "@/lib/produtos-export";
import {
  buildMlTableKey, buildMlSummaryKey, buildPeriodTableKey, buildPeriodSummaryKey,
  resolveChannelAvailability, describeProdutosPartialWarning, type ProdutosSectionState,
} from "@/lib/produtos-request-key";

type Tab = ProdutosTab;
type ProductStatus = "" | "sells+advertised" | "sells_organic_only" | "ad_spend_no_sales" | "inactive";
type VelocityFilter = "" | "high" | "medium" | "low" | "zero";

const PAGE_SIZE = 25;

const TABS: { value: Tab; label: string }[] = [
  { value: "ml", label: "Mercado Livre" },
  { value: "tiktok", label: "TikTok Shop" },
  { value: "shopee", label: "Shopee" },
];

// Marcas validas por canal — usado para decidir se a marca selecionada
// sobrevive a troca de aba ("preserve a marca se ela existir no canal").
const ML_BRANDS = [
  { value: "barbours", label: "BARBOURS" },
  { value: "kokeshi", label: "KOKESHI" },
  { value: "lescent", label: "LESCENT" },
  { value: "rituaria", label: "RITUARIA" },
];
const TK_SH_BRANDS = [
  { value: "apice", label: "APICE" },
  { value: "barbours", label: "BARBOURS" },
  { value: "kokeshi", label: "KOKESHI" },
  { value: "lescent", label: "LESCENT" },
  { value: "rituaria", label: "RITUARIA" },
  // Marcas menores: dado do Bling, mesmo layout das outras (so' TikTok e Shopee; no ML elas nao vendem).
  ...MARCAS_MENORES_OPTIONS,
];

// Linha curta sob os cards A/B/C/D: so' o que muda a leitura do Pareto.
function paretoLinha(partes: (string | null | undefined)[]): string {
  return partes.filter(Boolean).join(" · ");
}
function semGmv(excluded: number | undefined): string | null {
  return excluded ? `${excluded} produtos sem venda no período (fora das curvas)` : null;
}
function precoMedio(avg: number | null | undefined): string | null {
  return avg == null ? null : `Preço médio ${fmtBrlExato(avg)}`;
}
// Ressalvas de metodologia vao para o ⓘ ao lado da linha.
const DICA_PARETO = "Pareto só com produtos de GMV positivo. Preço médio ponderado por unidade.";
const DICA_BLING_TODAS =
  "Dado do Bling (conta da Rituária): Yenzah, Auá e By Samia, pedidos não cancelados do mês; quantidade e receita pelos itens do pedido (valor × quantidade − desconto). Ficam fora do ranking e do A/B/C/D do Data Mart acima, que é calculado e paginado no servidor. O A/B/C/D deste bloco é feito só entre as demais marcas, neste canal. O que o Bling não traz (vídeo/live/card, avaliações, cancelamentos) fica vazio.";
const DICA_BLING =
  "Demais marcas: dado do Bling (conta da Rituária), pedidos não cancelados do mês; quantidade e receita pelos itens do pedido (valor × quantidade − desconto). O A/B/C/D é feito só entre os produtos desta marca neste canal. O que o Bling não traz (vídeo/live/card, avaliações, cancelamentos) fica vazio.";

import {
  brandParamForEndpoint, buildProdutosQuery, parseProdutosUrl, type ParetoBucket,
} from "@/lib/produtos-url";

const PERIOD_MONTHS_BACK = 7;

function ProdutosPageInner() {
  // Contrato canonico de querystring (Gate V3-1A, §9.2 do plano V3):
  //   /produtos?channels=ml&brands=<marca>&pareto_bucket=<bucket>
  // Todo parsing passa por `parseProdutosUrl`, que e' allowlisted e degrada
  // com seguranca — nao existe leitura ad hoc de searchParams nesta pagina.
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = useMemo(() => parseProdutosUrl(searchParams), [searchParams]);

  const [tab, setTab] = useState<Tab>(fromUrl.tab ?? "ml");
  // Gerado a partir da data atual em vez de uma lista fixa hardcoded (Gate 2,
  // produtos_audit.md secao 10.4) — calculado uma vez por montagem da pagina.
  const monthOptions = useMemo(() => lastNMonths(PERIOD_MONTHS_BACK, new Date()), []);
  const [period, setPeriod] = useState(() => monthOptions[0].value);

  // Filtros padronizados (marca + bucket) — marca e compartilhada entre
  // abas (preservada quando existe no canal); bucket e sempre por aba,
  // porque cada canal calcula seu proprio ranking Pareto.
  const [brand, setBrand] = useState(fromUrl.brand ?? "");
  const [mlBucket, setMlBucket] = useState<string | null>(
    fromUrl.tab === "ml" ? fromUrl.bucket : null,
  );
  const [tkBucket, setTkBucket] = useState<string | null>(
    fromUrl.tab === "tiktok" ? fromUrl.bucket : null,
  );
  const [shBucket, setShBucket] = useState<string | null>(
    fromUrl.tab === "shopee" ? fromUrl.bucket : null,
  );

  // Filtros especificos do ML (nao existem em TikTok/Shopee)
  const [mlSignal, setMlSignal] = useState("");
  const [mlStatus, setMlStatus] = useState<ProductStatus>("");
  const [mlVelocity, setMlVelocity] = useState<VelocityFilter>("");

  const [mlOffset, setMlOffset] = useState(0);
  const [tkOffset, setTkOffset] = useState(0);
  const [shOffset, setShOffset] = useState(0);

  const [menoresOffset, setMenoresOffset] = useState(0);
  // Marcas menores (Bling): MESMO layout das outras marcas, com os dados adaptados para as props existentes
  // (`lib/produtos-marcas-menores.ts`). Os itens do Bling vem por canal e marca, do cache persistente.
  const ehMenor = MARCAS_MENORES_KEYS.includes(brand);
  const canalBling: CanalProduto | null = tab === "ml" ? null : tab;
  const periodoBling = useMemo(() => periodoDoMes(period, toISODate(new Date())), [period]);
  const blingMarca = useProdutosMarcasMenores(periodoBling.inicio, periodoBling.fim, ehMenor && canalBling != null, {
    canais: canalBling ? [canalBling] : [],
    marcas: [brand],
  });
  // "Todas as marcas": as menores entram num bloco proprio logo abaixo (o ranking e o Pareto acima sao do Data Mart).
  const blingTodas = useProdutosMarcasMenores(periodoBling.inicio, periodoBling.fim, brand === "" && canalBling != null, {
    canais: canalBling ? [canalBling] : [],
  });

  // Estado assincrono por canal (dados + loading + "ao vivo") centralizado em
  // async-channel-state.ts: cada resolucao so e aplicada se ainda for a
  // requisicao mais recente daquele canal (guarda contra resposta obsoleta
  // sobrescrever uma mais nova — ex: troca rapida de marca/periodo). Uma
  // falha nunca deixa dados antigos exibidos como se pertencessem ao filtro
  // atual: volta para data=null (mesmo estado de "API offline").
  const [mlState, setMlState] = useState<ChannelState<ProdutosMLResponse>>(initialChannelState);
  const [tkState, setTkState] = useState<ChannelState<ProdutosTikTokResponse>>(initialChannelState);
  const [shState, setShState] = useState<ChannelState<ProdutosShopeeListResponse>>(initialChannelState);
  const mlReqId = useRef(0);
  const tkReqId = useRef(0);
  const shReqId = useRef(0);

  const [mlSummaryState, setMlSummaryState] = useState<ChannelState<ProdutosMLSummary>>(initialChannelState);
  const [tkSummaryState, setTkSummaryState] = useState<ChannelState<ProdutosChannelSummary>>(initialChannelState);
  const [shSummaryState, setShSummaryState] = useState<ChannelState<ProdutosChannelSummary>>(initialChannelState);
  const mlSummaryReqId = useRef(0);
  const tkSummaryReqId = useRef(0);
  const shSummaryReqId = useRef(0);

  // Ordenacao e server-side (cada pagina ja vem ordenada pela API); usamos
  // apenas sort/toggleSort do hook para dirigir a query.
  const mlColumnTypes: Record<string, SortColumnType> = { title: "text" };
  const mlGetValue = (row: NonNullable<ProdutosMLResponse["items"]>[number], column: string) => (row as unknown as Record<string, string | number | null | undefined>)[column];
  const mlSort = useSortableTable(mlState.data?.items ?? [], mlGetValue, mlColumnTypes);

  const tkColumnTypes: Record<string, SortColumnType> = { product_name: "text" };
  const tkGetValue = (row: NonNullable<ProdutosTikTokResponse["items"]>[number], column: string) => (row as unknown as Record<string, string | number | null | undefined>)[column];
  const tkSort = useSortableTable(tkState.data?.items ?? [], tkGetValue, tkColumnTypes);

  const shColumnTypes: Record<string, SortColumnType> = { product_name: "text" };
  const shGetValue = (row: NonNullable<ProdutosShopeeListResponse["items"]>[number], column: string) => (row as unknown as Record<string, string | number | null | undefined>)[column];
  const shSort = useSortableTable(shState.data?.items ?? [], shGetValue, shColumnTypes);

  // Identidade de requisicao por tabela/resumo (FINDING 1, rodada de
  // correcao) — cada uma guarda a chave da ULTIMA resolucao aplicada
  // (`xxxResolvedKey`), comparada a cada render contra a chave ATUAL
  // (`xxxTableKey`/`xxxSummaryKey`, recalculada sincronamente). Enquanto as
  // duas nao baterem — inclusive no frame de render ANTES do useEffect
  // rodar, ex.: troca de aba/marca/periodo/bucket/pagina/ordenacao — os
  // dados daquele canal sao tratados como potencialmente antigos.
  const [mlResolvedKey, setMlResolvedKey] = useState<string | null>(null);
  const [tkResolvedKey, setTkResolvedKey] = useState<string | null>(null);
  const [shResolvedKey, setShResolvedKey] = useState<string | null>(null);
  const [mlSummaryResolvedKey, setMlSummaryResolvedKey] = useState<string | null>(null);
  const [tkSummaryResolvedKey, setTkSummaryResolvedKey] = useState<string | null>(null);
  const [shSummaryResolvedKey, setShSummaryResolvedKey] = useState<string | null>(null);

  const mlTableKey = useMemo(
    () => buildMlTableKey({ brand, bucket: mlBucket, signal: mlSignal, status: mlStatus, velocity: mlVelocity, offset: mlOffset, sortColumn: mlSort.sort.column, sortDirection: mlSort.sort.direction }),
    [brand, mlBucket, mlSignal, mlStatus, mlVelocity, mlOffset, mlSort.sort.column, mlSort.sort.direction],
  );
  const tkTableKey = useMemo(
    () => buildPeriodTableKey({ brand, period, bucket: tkBucket, offset: tkOffset, sortColumn: tkSort.sort.column, sortDirection: tkSort.sort.direction }),
    [brand, period, tkBucket, tkOffset, tkSort.sort.column, tkSort.sort.direction],
  );
  const shTableKey = useMemo(
    () => buildPeriodTableKey({ brand, period, bucket: shBucket, offset: shOffset, sortColumn: shSort.sort.column, sortDirection: shSort.sort.direction }),
    [brand, period, shBucket, shOffset, shSort.sort.column, shSort.sort.direction],
  );
  const mlSummaryKey = useMemo(
    () => buildMlSummaryKey({ brand, signal: mlSignal, status: mlStatus, velocity: mlVelocity }),
    [brand, mlSignal, mlStatus, mlVelocity],
  );
  const tkSummaryKey = useMemo(() => buildPeriodSummaryKey({ brand, period }), [brand, period]);
  const shSummaryKey = useMemo(() => buildPeriodSummaryKey({ brand, period }), [brand, period]);

  const mlTableAvail = resolveChannelAvailability({ resolvedKey: mlResolvedKey, requestKey: mlTableKey, loading: mlState.loading, hasData: mlState.data !== null });
  const tkTableAvailDM = resolveChannelAvailability({ resolvedKey: tkResolvedKey, requestKey: tkTableKey, loading: tkState.loading, hasData: tkState.data !== null });
  const shTableAvailDM = resolveChannelAvailability({ resolvedKey: shResolvedKey, requestKey: shTableKey, loading: shState.loading, hasData: shState.data !== null });
  const mlSummaryAvail = resolveChannelAvailability({ resolvedKey: mlSummaryResolvedKey, requestKey: mlSummaryKey, loading: mlSummaryState.loading, hasData: mlSummaryState.data !== null });
  const tkSummaryAvailDM = resolveChannelAvailability({ resolvedKey: tkSummaryResolvedKey, requestKey: tkSummaryKey, loading: tkSummaryState.loading, hasData: tkSummaryState.data !== null });
  const shSummaryAvailDM = resolveChannelAvailability({ resolvedKey: shSummaryResolvedKey, requestKey: shSummaryKey, loading: shSummaryState.loading, hasData: shSummaryState.data !== null });

  const blingAvail: ProdutosSectionState =
    blingMarca.produtos === undefined ? "loading" : blingMarca.produtos === null || !blingMarca.produtos.disponivel ? "unavailable" : "available";
  const tkTableAvail = ehMenor ? blingAvail : tkTableAvailDM;
  const shTableAvail = ehMenor ? blingAvail : shTableAvailDM;
  const tkSummaryAvail = ehMenor ? blingAvail : tkSummaryAvailDM;
  const shSummaryAvail = ehMenor ? blingAvail : shSummaryAvailDM;

  const activeTableAvail: ProdutosSectionState = tab === "ml" ? mlTableAvail : tab === "tiktok" ? tkTableAvail : shTableAvail;
  const activeSummaryAvail: ProdutosSectionState = tab === "ml" ? mlSummaryAvail : tab === "tiktok" ? tkSummaryAvail : shSummaryAvail;
  const activePartialWarning = describeProdutosPartialWarning(activeTableAvail, activeSummaryAvail);

  // Dados exibidos — SEMPRE via estas constantes (nunca `xxState.data`/
  // `xxSummaryState.data` diretamente) para que troca de aba/filtro nunca
  // mostre tabela, resumo, badge, escopo ou linhas de exportacao de uma
  // identidade antiga.
  const mlDisplayData = mlTableAvail === "available" ? mlState.data : null;
  const refMes = period;
  const textoProgresso = (b: typeof blingMarca) =>
    b.produtos?.disponivel && !b.produtos.completo
      ? `${b.desistiu ? "Leitura parcial" : "Lendo os itens"}: ${b.produtos.pedidos_lidos} de ${b.produtos.pedidos_total} pedidos. O A/B/C/D e os totais ainda podem mudar${b.desistiu ? "." : " até terminar."}`
      : null;
  const progressoBling = ehMenor ? textoProgresso(blingMarca) : null;
  const progressoTodas = brand === "" && canalBling != null ? textoProgresso(blingTodas) : null;
  // Ordenacao propria do bloco "Todas as marcas" (as setas dos cabecalhos funcionam, como na marca unica).
  const menoresSort = useSortableTable([] as never[], () => null, { product_name: "text" });
  const linhasBling = useMemo(
    () => (canalBling && ehMenor ? linhasDoCanal(blingMarca.produtos, canalBling, [brand]) : []),
    [blingMarca.produtos, canalBling, ehMenor, brand],
  );
  const linhasTodasMenores = useMemo(
    () => (canalBling && brand === "" ? linhasDoCanal(blingTodas.produtos, canalBling) : []),
    [blingTodas.produtos, canalBling, brand],
  );
  const opcoesBling = (sort: { sort: { column: string | null; direction: "asc" | "desc" | null } }, bucket: string | null, offset: number) => ({
    refMonth: refMes, sortColumn: sort.sort.column, sortDirection: sort.sort.direction, bucket, offset, limit: PAGE_SIZE,
  });
  const tkDisplayData = ehMenor
    ? (tkTableAvail === "available" ? listaTikTok(linhasBling, opcoesBling(tkSort, tkBucket, tkOffset)) : null)
    : tkTableAvail === "available" ? tkState.data : null;
  const shDisplayData = ehMenor
    ? (shTableAvail === "available" ? listaShopee(linhasBling, opcoesBling(shSort, shBucket, shOffset)) : null)
    : shTableAvail === "available" ? shState.data : null;
  const mlDisplaySummary = mlSummaryAvail === "available" ? mlSummaryState.data : null;
  const tkDisplaySummary = ehMenor
    ? (tkSummaryAvail === "available" ? resumoDoCanal(linhasBling, refMes, brand) : null)
    : tkSummaryAvail === "available" ? tkSummaryState.data : null;
  const shDisplaySummary = ehMenor
    ? (shSummaryAvail === "available" ? resumoDoCanal(linhasBling, refMes, brand) : null)
    : shSummaryAvail === "available" ? shSummaryState.data : null;
  // Lidos do selo, nunca recalculados aqui: a tela nao decide sozinha o que e
  // ausencia.
  const shUnavailable = scopeUnavailableReason(shDisplaySummary?.quality);

  // "Ao vivo" reflete exclusivamente o ultimo resultado do PROPRIO canal, e
  // somente quando a tabela da aba ativa esta "available" para a identidade
  // ATUAL — nunca fica true so porque outra aba/identidade teve sucesso
  // antes (cobre inclusive o frame de render anterior ao efeito rodar).
  const isLive = activeTableAvail === "available" && (ehMenor ? true : tab === "ml" ? mlState.live : tab === "tiktok" ? tkState.live : shState.live);
  // Enquanto a tabela OU o resumo Pareto da aba ativa ainda estao "loading"
  // (busca em andamento OU chave resolvida desatualizada), o badge de fonte
  // mostra um estado neutro — nunca o `live`/mock de uma identidade antiga.
  const activeLoading = activeTableAvail === "loading" || activeSummaryAvail === "loading";

  const loadML = useCallback(() => {
    const id = ++mlReqId.current;
    setMlState(startFetch);
    (async () => {
      let result: ProdutosMLResponse | null = null;
      let failed = false;
      try {
        result = await fetchProdutosML({
          brand: brandParamForEndpoint(brand),
          pareto_bucket: mlBucket || undefined,
          action_signal: mlSignal || undefined,
          product_status: mlStatus || undefined,
          revenue_velocity: mlVelocity || undefined,
          limit: PAGE_SIZE,
          offset: mlOffset,
          sort_by: mlSort.sort.column ?? undefined,
          sort_dir: mlSort.sort.direction ?? undefined,
        });
      } catch {
        failed = true;
      } finally {
        const isCurrent = id === mlReqId.current;
        setMlState((s) => (failed ? resolveFetchError(s, isCurrent) : resolveFetch(s, isCurrent, result)));
        if (isCurrent) setMlResolvedKey(mlTableKey);
      }
    })();
  }, [brand, mlBucket, mlSignal, mlStatus, mlVelocity, mlOffset, mlSort.sort.column, mlSort.sort.direction, mlTableKey]);

  const loadTK = useCallback(() => {
    const id = ++tkReqId.current;
    setTkState(startFetch);
    (async () => {
      let result: ProdutosTikTokResponse | null = null;
      let failed = false;
      try {
        result = await fetchProdutosTikTok({
          brand: brandParamForEndpoint(brand),
          period,
          pareto_bucket: tkBucket || undefined,
          limit: PAGE_SIZE,
          offset: tkOffset,
          sort_by: tkSort.sort.column ?? undefined,
          sort_dir: tkSort.sort.direction ?? undefined,
        });
      } catch {
        failed = true;
      } finally {
        const isCurrent = id === tkReqId.current;
        setTkState((s) => (failed ? resolveFetchError(s, isCurrent) : resolveFetch(s, isCurrent, result)));
        if (isCurrent) setTkResolvedKey(tkTableKey);
      }
    })();
  }, [brand, period, tkBucket, tkOffset, tkSort.sort.column, tkSort.sort.direction, tkTableKey]);

  const loadSH = useCallback(() => {
    const id = ++shReqId.current;
    setShState(startFetch);
    (async () => {
      let result: ProdutosShopeeListResponse | null = null;
      let failed = false;
      try {
        result = await fetchProdutosShopee({
          brand: brandParamForEndpoint(brand),
          period,
          pareto_bucket: shBucket || undefined,
          limit: PAGE_SIZE,
          offset: shOffset,
          sort_by: shSort.sort.column ?? undefined,
          sort_dir: shSort.sort.direction ?? undefined,
        });
      } catch {
        failed = true;
      } finally {
        const isCurrent = id === shReqId.current;
        setShState((s) => (failed ? resolveFetchError(s, isCurrent) : resolveFetch(s, isCurrent, result)));
        if (isCurrent) setShResolvedKey(shTableKey);
      }
    })();
  }, [brand, period, shBucket, shOffset, shSort.sort.column, shSort.sort.direction, shTableKey]);

  useEffect(() => { if (tab === "ml") loadML(); }, [tab, loadML]);
  useEffect(() => { if (tab === "tiktok" && !ehMenor) loadTK(); }, [tab, loadTK, ehMenor]);
  useEffect(() => { if (tab === "shopee" && !ehMenor) loadSH(); }, [tab, loadSH, ehMenor]);

  // Summary (cards A/B/C/D) — mesmos filtros da tabela, exceto o proprio bucket.
  useEffect(() => {
    if (tab !== "ml") return;
    const id = ++mlSummaryReqId.current;
    setMlSummaryState(startFetch);
    (async () => {
      let result: ProdutosMLSummary | null = null;
      let failed = false;
      try {
        result = await fetchProdutosMLSummary({
          brand: brandParamForEndpoint(brand), action_signal: mlSignal || undefined,
          product_status: mlStatus || undefined, revenue_velocity: mlVelocity || undefined,
        });
      } catch {
        failed = true;
      } finally {
        const isCurrent = id === mlSummaryReqId.current;
        setMlSummaryState((s) => (failed ? resolveFetchError(s, isCurrent) : resolveFetch(s, isCurrent, result)));
        if (isCurrent) setMlSummaryResolvedKey(mlSummaryKey);
      }
    })();
  }, [tab, brand, mlSignal, mlStatus, mlVelocity, mlSummaryKey]);

  useEffect(() => {
    if (tab !== "tiktok" || ehMenor) return;
    const id = ++tkSummaryReqId.current;
    setTkSummaryState(startFetch);
    (async () => {
      let result: ProdutosChannelSummary | null = null;
      let failed = false;
      try {
        result = await fetchProdutosTikTokSummary({ brand: brandParamForEndpoint(brand), period });
      } catch {
        failed = true;
      } finally {
        const isCurrent = id === tkSummaryReqId.current;
        setTkSummaryState((s) => (failed ? resolveFetchError(s, isCurrent) : resolveFetch(s, isCurrent, result)));
        if (isCurrent) setTkSummaryResolvedKey(tkSummaryKey);
      }
    })();
  }, [tab, brand, period, tkSummaryKey, ehMenor]);

  useEffect(() => {
    if (tab !== "shopee" || ehMenor) return;
    const id = ++shSummaryReqId.current;
    setShSummaryState(startFetch);
    (async () => {
      let result: ProdutosChannelSummary | null = null;
      let failed = false;
      try {
        result = await fetchProdutosShopeeSummary({ brand: brandParamForEndpoint(brand), period });
      } catch {
        failed = true;
      } finally {
        const isCurrent = id === shSummaryReqId.current;
        setShSummaryState((s) => (failed ? resolveFetchError(s, isCurrent) : resolveFetch(s, isCurrent, result)));
        if (isCurrent) setShSummaryResolvedKey(shSummaryKey);
      }
    })();
  }, [tab, brand, period, shSummaryKey, ehMenor]);

  // Reset offset quando filtros mudam (nunca usa a pagina visivel como base)
  useEffect(() => { setMlOffset(0); }, [brand, mlBucket, mlSignal, mlStatus, mlVelocity]);
  useEffect(() => { setTkOffset(0); }, [brand, tkBucket, period]);
  useEffect(() => { setShOffset(0); }, [brand, shBucket, period]);

  // Reset offset quando a ordenacao muda
  useEffect(() => { setMlOffset(0); }, [mlSort.sort.column, mlSort.sort.direction]);
  useEffect(() => { setTkOffset(0); }, [tkSort.sort.column, tkSort.sort.direction]);
  useEffect(() => { setShOffset(0); }, [shSort.sort.column, shSort.sort.direction]);

  // Reset de paginacao ao ENTRAR em cada aba (nao herda a pagina da ultima visita)
  useEffect(() => { if (tab === "ml") setMlOffset(0); }, [tab]);
  useEffect(() => { if (tab === "tiktok") setTkOffset(0); }, [tab]);
  useEffect(() => { if (tab === "shopee") setShOffset(0); }, [tab]);

  // Sincroniza a URL com o estado atual, sem navegar e sem empilhar
  // historico. `pareto_bucket` fica FORA de FILTER_QUERY_KEYS e `/produtos`
  // nao e' filter-aware — a sidebar nunca transporta esses parametros para
  // outra tela. Nenhuma metrica viaja: so' canal, marca e bucket.
  const activeBucket = tab === "ml" ? mlBucket : tab === "tiktok" ? tkBucket : shBucket;
  useEffect(() => {
    const next = buildProdutosQuery({
      tab,
      brand,
      bucket: (activeBucket as ParetoBucket | null) ?? null,
    });
    if (next !== searchParams.toString()) {
      router.replace(`/produtos?${next}`, { scroll: false });
    }
  }, [tab, brand, activeBucket, router, searchParams]);

  function handleTabChange(next: Tab) {
    setTab(next);
    // preserva a marca somente se ela existir no novo canal
    if (!brandSurvivesTabChange(brand, next)) {
      setBrand("");
    }
    // bucket e especifico de cada ranking (marketplace+periodo+marca) — nunca
    // atravessa a troca de aba, mesmo que o nome do bucket coincida (A_top50
    // do ML nao corresponde ao mesmo conjunto de produtos do A_top50 do TikTok)
    setMlBucket(null);
    setTkBucket(null);
    setShBucket(null);
  }

  const periodLabel = monthOptions.find((m) => m.value === period)?.label ?? period;
  const activeChannelLabel = TABS.find((t) => t.value === tab)?.label ?? tab;
  const brandOptionsForTab = tab === "ml" ? ML_BRANDS : TK_SH_BRANDS;
  const activeBrandLabel = brand ? (brandOptionsForTab.find((b) => b.value === brand)?.label ?? brand) : "Todas as marcas";
  const mlPageNumber = Math.floor(mlOffset / PAGE_SIZE) + 1;
  const tkPageNumber = Math.floor(tkOffset / PAGE_SIZE) + 1;
  const shPageNumber = Math.floor(shOffset / PAGE_SIZE) + 1;

  // ALVO-GRADE: um esqueleto so' para os tres canais. Filtros, faixa A/B/C/D e
  // tabela mudam com a aba; a regra de cada canal (ML sem competencia mensal,
  // Shopee com selo de maturacao ANTES dos cartoes, marcas menores do Bling) fica igual.
  const marcaSelect = (
    <ProductSelect value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca">
      <option value="">Todas as marcas</option>
      {brandOptionsForTab.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
    </ProductSelect>
  );
  const filtros = (
    <div className="flex flex-wrap items-center gap-2">
      {marcaSelect}
      {tab === "ml" ? (
        <>
          <ProductSelect value={mlStatus} onChange={(e) => setMlStatus(e.target.value as ProductStatus)} aria-label="Status">
            <option value="">Todos os status</option>
            <option value="sells+advertised">Vende + anunciado</option>
            <option value="sells_organic_only">Vende orgânico</option>
            <option value="ad_spend_no_sales">Gasta ads, sem venda</option>
            <option value="inactive">Inativo</option>
          </ProductSelect>
          <ProductSelect value={mlVelocity} onChange={(e) => setMlVelocity(e.target.value as VelocityFilter)} aria-label="Velocidade">
            <option value="">Toda velocidade</option>
            <option value="high">Alta velocidade</option>
            <option value="medium">Média velocidade</option>
            <option value="low">Baixa velocidade</option>
            <option value="zero">Sem vendas</option>
          </ProductSelect>
          <ProductSelect value={mlSignal} onChange={(e) => setMlSignal(e.target.value)} aria-label="Sinal de ação">
            <option value="">Todos os sinais</option>
            <option value="ACAO: aumentar investimento (ROAS > 15x)">Aumentar investimento</option>
            <option value="ACAO: considerar pausar ads (ROAS &lt; 3x)">Considerar pausar ads</option>
            <option value="ALERTA: taxa cancelamento alta (> 10%)">Cancelamento alto</option>
            <option value="OPORTUNIDADE: produto vende organico, considerar ads">Oportunidade orgânica</option>
            <option value="REVIEW: spend sem vendas no período de orders">Investe sem vender</option>
            <option value="ATENCAO: grande variacao de preco">Variação de preço</option>
          </ProductSelect>
        </>
      ) : (
        // 390: a trilha rola sozinha; a pagina nao ganha rolagem lateral.
        <div className="max-w-[calc(100vw-2.5rem)] overflow-x-auto">
          <Segmented rotulo="Período" opcoes={monthOptions.map((m) => ({ valor: m.value, texto: m.label }))} valor={period} aoEscolher={setPeriod} className="whitespace-nowrap" />
        </div>
      )}
    </div>
  );
  // Selo: a hora publicada no resumo do canal ativo (nunca a de uma identidade antiga); sem hora, o estado da fonte.
  const refreshed = (tab === "ml" ? mlDisplaySummary : tab === "tiktok" ? tkDisplaySummary : shDisplaySummary)?.refreshed_at ?? null;
  const selo = (
    <SeloAtualizado
      em={activeLoading ? null : refreshed}
      carregando={activeLoading}
      aoVivo={activeLoading ? null : isLive}
      detalhe={!activeLoading && !refreshed ? "A fonte deste canal não publica a hora da atualização" : undefined}
    />
  );

  const faixa =
    tab === "ml" ? (
      <ProductParetoSummary
        buckets={mlDisplaySummary?.buckets ?? null}
        loading={mlSummaryAvail === "loading"}
        activeBucket={mlBucket}
        onSelectBucket={setMlBucket}
        scopeNote={
          mlDisplaySummary
            ? paretoLinha([
                semGmv(mlDisplaySummary.excluded_zero_gmv_count),
                precoMedio(mlDisplaySummary.avg_price_weighted),
              ])
            : undefined
        }
        dica={`Sem competência mensal na fonte: ranking acumulado atual. ${DICA_PARETO} ${marginUnavailableNote("ml")}`}
      />
    ) : tab === "tiktok" ? (
      <>
        {progressoBling && <p className="px-1 text-xs font-semibold text-warn-ink" role="status">{progressoBling}</p>}
        <ProductParetoSummary
          buckets={tkDisplaySummary?.buckets ?? null}
          loading={tkSummaryAvail === "loading"}
          activeBucket={tkBucket}
          onSelectBucket={setTkBucket}
          scopeNote={paretoLinha([
            semGmv(tkDisplaySummary?.excluded_zero_gmv_count),
            precoMedio(tkDisplaySummary?.avg_price_weighted),
          ])}
          dica={`${ehMenor ? `${DICA_BLING} ` : ""}${DICA_PARETO} ${marginUnavailableNote("tiktok")}`}
        />
      </>
    ) : (
      <>
        {/* Gate SH-API-2D: o selo vem ANTES dos cards A/B/C/D de proposito.
            Quem le a tela de cima para baixo tem de saber que a competencia
            esta em maturacao antes de olhar o Pareto, nao depois de ja ter
            tirado conclusao dos numeros. */}
        <ScopeQualityBanner
          quality={shDisplaySummary?.quality}
          loading={shSummaryAvail === "loading"}
          naGrade
        />
        {progressoBling && <p className="px-1 text-xs font-semibold text-warn-ink" role="status">{progressoBling}</p>}
        <ProductParetoSummary
          buckets={shDisplaySummary?.buckets ?? null}
          loading={shSummaryAvail === "loading"}
          activeBucket={shBucket}
          onSelectBucket={setShBucket}
          unavailableReason={shUnavailable}
          scopeNote={paretoLinha([
            shUnavailable ? null : semGmv(shDisplaySummary?.excluded_zero_gmv_count),
            precoMedio(shDisplaySummary?.avg_price_weighted),
          ])}
          dica={`${ehMenor ? `${DICA_BLING} ` : ""}${DICA_PARETO} ${marginUnavailableNote("shopee")}`}
        />
      </>
    );

  const escopo =
    tab === "ml"
      ? formatProdutosScope({
          channelLabel: activeChannelLabel, brandLabel: activeBrandLabel, periodLabel: null,
          total: mlDisplayData?.total ?? null, offset: mlOffset, limit: PAGE_SIZE,
        })
      : tab === "tiktok"
        ? formatProdutosScope({
            channelLabel: activeChannelLabel, brandLabel: activeBrandLabel, periodLabel,
            total: tkDisplayData?.total ?? null, offset: tkOffset, limit: PAGE_SIZE,
          })
        : formatProdutosScope({
            channelLabel: activeChannelLabel, brandLabel: activeBrandLabel, periodLabel,
            total: shUnavailable ? null : shDisplayData?.total ?? null, offset: shOffset, limit: PAGE_SIZE,
          });

  const exportar =
    tab === "ml" ? (
      <ProductExportButton rows={mlDisplayData?.items ?? null} loading={mlTableAvail !== "available"} columns={ML_EXPORT_COLUMNS} toRecord={mlRowToExportRecord} scope={{ channel: "ml", brand, period: null, pageNumber: mlPageNumber }} />
    ) : tab === "tiktok" ? (
      <ProductExportButton rows={tkDisplayData?.items ?? null} loading={tkTableAvail !== "available"} columns={TIKTOK_EXPORT_COLUMNS} toRecord={tiktokRowToExportRecord} scope={{ channel: "tiktok", brand, period, pageNumber: tkPageNumber }} />
    ) : (
      <ProductExportButton rows={shDisplayData?.items ?? null} loading={shTableAvail !== "available"} columns={SHOPEE_EXPORT_COLUMNS} toRecord={shopeeRowToExportRecord} scope={{ channel: "shopee", brand, period, pageNumber: shPageNumber }} />
    );

  return (
    <Aba
      titulo="Produtos"
      selo={selo}
      visoes={TABS.map((t) => ({ id: t.value, rotulo: t.label, ponto: `bg-canal-${t.value}` }))}
      visao={tab}
      onVisao={handleTabChange}
      filtros={filtros}
      faixa={
        <>
          {/* Dados parciais (FINDING 3): so' quando exatamente UM dos dois (tabela, resumo) da aba falhou. */}
          {activePartialWarning && <AvisoTopo texto={activePartialWarning} />}
          {faixa}
        </>
      }
    >
      <Panel titulo={`Produtos · ${activeChannelLabel}`} descricao={escopo} acao={exportar} semPadding>
        {tab === "ml" && (
          <MercadoLivreProductTable
            items={mlDisplayData}
            loading={mlTableAvail === "loading"}
            sort={mlSort.sort}
            onSort={mlSort.toggleSort}
            pagination={{ limit: PAGE_SIZE, offset: mlOffset, onChange: setMlOffset }}
          />
        )}
        {tab === "tiktok" && (
          <TikTokProductTable
            items={tkDisplayData}
            loading={tkTableAvail === "loading"}
            sort={tkSort.sort}
            onSort={tkSort.toggleSort}
            pagination={{ limit: PAGE_SIZE, offset: tkOffset, onChange: setTkOffset }}
          />
        )}
        {tab === "shopee" && (
          <ShopeeProductTable
            items={shDisplayData}
            loading={shTableAvail === "loading"}
            sort={shSort.sort}
            onSort={shSort.toggleSort}
            pagination={{ limit: PAGE_SIZE, offset: shOffset, onChange: setShOffset }}
          />
        )}
      </Panel>

      {/* "Todas as marcas": as menores (Bling) entram aqui, no MESMO layout, abaixo do ranking do Data Mart.
          Nao entram no ranking nem no A/B/C/D de cima: aquele e' calculado e paginado no servidor. */}
      {brand === "" && canalBling != null && blingTodas.produtos !== undefined && (blingTodas.produtos === null || !blingTodas.produtos.disponivel) && (
        <AvisoTopo texto="Demais marcas indisponíveis agora (Bling)." />
      )}
      {brand === "" && canalBling != null && linhasTodasMenores.length > 0 && (
        <Panel titulo={`Demais marcas · ${activeChannelLabel}`} ajuda={DICA_BLING_TODAS} semPadding>
          {progressoTodas && <p className="px-4 pb-2 text-xs font-semibold text-warn-ink" role="status">{progressoTodas}</p>}
          {canalBling === "tiktok" ? (
            <TikTokProductTable
              items={listaTikTok(linhasTodasMenores, { refMonth: refMes, sortColumn: menoresSort.sort.column, sortDirection: menoresSort.sort.direction, offset: menoresOffset, limit: PAGE_SIZE })}
              loading={false}
              sort={menoresSort.sort}
              onSort={menoresSort.toggleSort}
              pagination={{ limit: PAGE_SIZE, offset: menoresOffset, onChange: setMenoresOffset }}
            />
          ) : (
            <ShopeeProductTable
              items={listaShopee(linhasTodasMenores, { refMonth: refMes, sortColumn: menoresSort.sort.column, sortDirection: menoresSort.sort.direction, offset: menoresOffset, limit: PAGE_SIZE })}
              loading={false}
              sort={menoresSort.sort}
              onSort={menoresSort.toggleSort}
              pagination={{ limit: PAGE_SIZE, offset: menoresOffset, onChange: setMenoresOffset }}
            />
          )}
        </Panel>
      )}
    </Aba>
  );
}

export default function ProdutosPage() {
  // `useSearchParams` exige limite de Suspense no App Router.
  return (
    <Suspense fallback={<PageContainer><p className="text-sm text-ink-muted">Carregando produtos…</p></PageContainer>}>
      <ProdutosPageInner />
    </Suspense>
  );
}
