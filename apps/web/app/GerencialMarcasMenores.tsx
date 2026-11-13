"use client";

/**
 * Gerencial com SO' marcas menores no filtro de marca: a MESMA tela das marcas grandes (hero com rosca, faixa
 * de KPIs, "Evolução de GMV" com as abas GMV/Pedidos e Diária/Semanal/Mensal, bloco Marcas em linha e
 * "Mais vendidos por marca"), com os dados do Bling convertidos para as props desses componentes pelo
 * adaptador (`lib/gerencial/marcas-menores-adaptador.ts`). Nada do Data Mart se aplica.
 *
 * Sem campo no Bling = vazio do componente, nunca 0: Ads e ACOS "sem dado", meta "sem meta", sem tendencia
 * do dia, sem "vs periodo" nos produtos, sem Full. Blocos sem fonte (CX, qualidade...) nao aparecem.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import EvolutionCard from "@/components/gerencial/EvolutionCard";
import GerencialHeader from "@/components/gerencial/GerencialHeader";
import KpiBand from "@/components/gerencial/KpiBand";
import MarcasMeta from "@/components/gerencial/MarcasMeta";
import MetaHero from "@/components/gerencial/MetaHero";
import TopProdutosMarca from "@/components/gerencial/TopProdutosMarca";
import { EsqueletoMarcasMenores } from "@/components/marcas-menores/Blocos";
import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import StateBlock from "@/components/ui/StateBlock";
import { useProdutosMarcasMenores } from "@/hooks/useProdutosMarcasMenores";
import { fetchMarcasMenores, type TrendGranularityRequest } from "@/lib/api-client";
import { escopoDeMarcas } from "@/lib/filters/brands";
import { fmtPeriodo } from "@/lib/filters/format";
import { toISODate } from "@/lib/filters/presets";
import type { GlobalFilters } from "@/lib/filters/types";
import { buildKpiBand } from "@/lib/gerencial/kpi-band";
import { linhasDeMarcasMenores, seriesDeMenores, topProdutosDeMenores } from "@/lib/gerencial/marcas-menores-adaptador";
import { filtrarMarcasMenores, menoresNaGerencial, motivoSemBaseDoRecorte, overviewDeMenores } from "@/lib/gerencial/marcas-menores-gerencial";
import type { TrendMetric } from "@/lib/gerencial/request-key";
import { mergeChannelSeries, reconcileSeriesTotal } from "@/lib/gerencial/trend-series";
import { variacaoPct, type MarcasMenores } from "@/lib/marcas-menores";
import type { Marketplace } from "@/lib/mock-data";

const NOTA_FONTE =
  "Dado do Bling (conta da Rituária), em tempo quase real: o dia de hoje conta. Receita = total do pedido (produtos − descontos + frete), sem cancelados; só Shopee e TikTok. Ads, ACOS e meta não existem para estas marcas.";

export default function GerencialMarcasMenores({
  filters,
  onChange,
  padrao,
}: {
  filters: GlobalFilters;
  onChange: (v: Partial<GlobalFilters>) => void;
  padrao?: GlobalFilters;
}) {
  const escopo = escopoDeMarcas(filters.brands);
  const router = useRouter();
  // Cards, "Detalhar" e barras/legenda da Evolucao nao tem detalhe do Data Mart para estas marcas: levam para a aba
  // Marcas menores (o mesmo periodo), nunca a um botao que nao abre nada.
  const abrirAbaMenores = () => router.push(`/marcas-menores?date_from=${filters.dateFrom}&date_to=${filters.dateTo}`);
  const [dados, setDados] = useState<MarcasMenores | null | undefined>(undefined);
  const [recarga, setRecarga] = useState(0);
  const [metric, setMetric] = useState<TrendMetric>("gmv");
  const [granularity, setGranularity] = useState<TrendGranularityRequest>("auto");

  useEffect(() => {
    let vivo = true;
    setDados(undefined);
    fetchMarcasMenores(filters.dateFrom, filters.dateTo).then((d) => vivo && setDados(d));
    return () => {
      vivo = false;
    };
  }, [filters.dateFrom, filters.dateTo, recarga]);

  const idsKey = escopo.menores.join(",");
  const canais = filters.channels as Marketplace[];
  const canaisKey = canais.join(",");
  const f = useMemo(
    () => (dados?.disponivel ? filtrarMarcasMenores(dados, escopo.menores, canais) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey e canaisKey cobrem as listas
    [dados, idsKey, canaisKey],
  );
  const menoresOk = useMemo(() => {
    const m = menoresNaGerencial(dados, canais, true, escopo.menores);
    return m.estado === "ok" ? m : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey e canaisKey cobrem as listas
  }, [dados, idsKey, canaisKey]);

  // Hoje ainda esta andando: comparar com o periodo anterior inteiro enganaria. Sem variacao.
  const emAndamento = !!dados?.periodo && dados.periodo.fim >= toISODate(new Date());
  const comparar = filters.compare && !emAndamento;
  const semCanalDelas = !canais.some((c) => c === "shopee" || c === "tiktok");
  const carregando = dados === undefined;
  const comDado = !!f && f.marcas.some((m) => m.total != null);

  // Produtos pedem JUNTO com as marcas (nada espera nada); so' nao pedem com canal onde elas nao vendem (ML).
  const prod = useProdutosMarcasMenores(filters.dateFrom, filters.dateTo, !semCanalDelas, { canais, marcas: escopo.menores });

  const overview = useMemo(() => (f ? overviewDeMenores(f, canais) : null), [f, canais]);
  // Canal sem receita no anterior (ex.: Shopee no Bling so' desde 22/10): sem percentual, "—" e o motivo visivel.
  const semBase = comparar && f ? motivoSemBaseDoRecorte(f) : null;
  const kpis = useMemo(() => buildKpiBand(overview, canais, comparar), [overview, canais, comparar]);
  // A Evolucao so' tem os canais onde elas vendem (Shopee e TikTok): um canal sem venda possivel (ML) nao e' uma
  // serie "vazia" a reconciliar, e' um canal que nao existe para estas marcas.
  const canaisSerie = useMemo(() => canais.filter((c) => c === "shopee" || c === "tiktok"), [canais]);
  const series = useMemo(() => (f ? seriesDeMenores(f, canaisSerie, granularity) : []), [f, canaisSerie, granularity]);
  const merged = useMemo(() => mergeChannelSeries(series, canaisSerie, metric, granularity), [series, canaisSerie, metric, granularity]);
  const reconciliation = useMemo(
    () => reconcileSeriesTotal(merged, metric, overview ? (metric === "gmv" ? overview.gmv : overview.orders) : null),
    [merged, metric, overview],
  );
  const periodo = dados?.periodo ?? { inicio: filters.dateFrom, fim: filters.dateTo };
  const linhas = useMemo(() => linhasDeMarcasMenores(menoresOk?.marcas ?? [], comparar), [menoresOk, comparar]);
  const periodLabel = fmtPeriodo(periodo.inicio, periodo.fim);

  const canalDe = (c: Marketplace) => {
    const plat = c === "shopee" ? "SHOPEE" : c === "tiktok" ? "TIKTOK" : "MELI";
    const atual = f?.consolidado?.por_plataforma.find((p) => p.plataforma === plat)?.faturamento ?? null;
    const antes = f?.consolidado?.por_plataforma_anterior?.[plat];
    return { atual, variacao: comparar ? variacaoPct(atual, antes ?? null) : null };
  };
  const tk = canalDe("tiktok");
  const ml = canalDe("ml");
  const sh = canalDe("shopee");

  return (
    <div className="flex w-full flex-col gap-3 px-4 py-4">
      <GerencialHeader periodLabel={periodLabel} refreshedAt={null} live={dados?.disponivel ? true : null} loading={carregando}>
        <GlobalFilterControls filters={filters} onChange={onChange} loading={carregando} padrao={padrao} />
      </GerencialHeader>
      {carregando ? (
        <EsqueletoMarcasMenores />
      ) : dados === null ? (
        <StateBlock tipo="erro" titulo="Não foi possível contatar a API" />
      ) : !dados.disponivel ? (
        <StateBlock
          tipo="indisponivel"
          titulo="Demais marcas indisponíveis"
          descricao={dados.motivo ?? undefined}
          acao={
            <button type="button" onClick={() => setRecarga((n) => n + 1)} className="min-h-11 text-xs font-semibold text-accent-ink hover:underline">
              Tentar de novo
            </button>
          }
        />
      ) : !comDado || !overview ? (
        semCanalDelas ? (
          <StateBlock tipo="vazio" titulo="Sem dado das demais marcas no canal selecionado" descricao="As demais marcas vendem só na Shopee e no TikTok." />
        ) : (
          <StateBlock tipo="vazio" titulo="Sem dado no período" descricao="Nenhum pedido das marcas escolhidas chegou do Bling neste recorte." />
        )
      ) : (
        <>
          <MetaHero
            periodLabel={periodLabel}
            loading={false}
            error={false}
            gmv={overview.gmv}
            prevGmv={comparar && overview.prev_gmv > 0 ? overview.prev_gmv : null}
            momPct={comparar ? overview.gmv_mom_pct : null}
            compareActive={comparar}
            channels={canais}
            gmvByChannel={{ tiktok: tk.atual, ml: ml.atual, shopee: sh.atual }}
            varGmvByChannel={{ tiktok: tk.variacao, ml: ml.variacao, shopee: sh.variacao }}
            mesMeta={null}
            diaMeta={null}
            hoje={toISODate(new Date())}
            metasStatus="fresh"
            onRetryMetas={() => {}}
            progresso={null}
            comCurva={false}
            progressoDia={null}
            semDado={[]}
            canaisForaDaMeta={[]}
            ultimoDia={null}
            aviso={null}
            metasHref="/metas"
            onOpenGmv={abrirAbaMenores}
            shareFull={null}
            semMetaDaMarca
            notaMenores={NOTA_FONTE}
            linhaMenores={
              emAndamento
                ? { texto: "inclui hoje, dia em andamento", aviso: false }
                : semBase
                  ? { texto: `Variação: — (${semBase})`, aviso: true }
                  : null
            }
          />
          <KpiBand kpis={kpis} loading={false} error={false} onOpen={abrirAbaMenores} onRetry={() => setRecarga((n) => n + 1)} semGmv />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <EvolutionCard
                merged={merged}
                metric={metric}
                onMetricChange={setMetric}
                granularity={granularity}
                onGranularityChange={setGranularity}
                reconciliation={reconciliation}
                compareActive={false}
                loading={false}
                onSelectBucket={abrirAbaMenores}
                bucketHoje={null}
                onOpenChannelSeries={abrirAbaMenores}
                highlightedChannel={null}
              />
            </div>
            <div className="lg:col-span-5">
              <MarcasMeta
                brands={linhas}
                semMeta={linhas.map((l) => l.brand)}
                channels={canais}
                progressoPorMarca={{}}
                rotuloMeta="da meta"
                compareActive={comparar}
                loading={false}
                error={false}
                brandHref={() => "/marcas-menores"}
                tendenciaDoDia={null}
                tendenciaDoMes={null}
                fullPorMarca={null}
              />
            </div>
          </div>
          {prod.produtos?.disponivel && !prod.produtos.completo && (
            <p className="text-xs font-semibold text-warn-ink" role="status">
              {prod.desistiu ? "Leitura parcial" : "Lendo os itens"}: {prod.produtos.pedidos_lidos} de {prod.produtos.pedidos_total} pedidos. Os
              produtos ainda podem mudar{prod.desistiu ? "." : " até terminar."}
              {prod.desistiu && (
                <button type="button" onClick={prod.tentar} className="ml-2 min-h-11 text-accent-ink hover:underline">
                  Tentar de novo
                </button>
              )}
            </p>
          )}
          <TopProdutosMarca
            channels={canais}
            brands={escopo.menores}
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            compare={false}
            fonte={{ dadosPara: (cs) => topProdutosDeMenores(prod.produtos, cs, escopo.menores, periodo) }}
          />
        </>
      )}
    </div>
  );
}
