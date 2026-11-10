"use client";

/**
 * Gerencial com SO' marcas menores no filtro de marca: o dado inteiro vem do Bling
 * (`/marcas-menores`); nada do Data Mart se aplica. GMV do periodo, rosca por canal, pedidos
 * e ticket (GMV / pedidos), serie diaria e mais vendidos. Ads e ACOS: sem dado. Meta: sem meta.
 * Blocos sem fonte para elas (Full, CX, qualidade...) nao aparecem.
 */
import { useEffect, useMemo, useState } from "react";

import { Marcas, Produtos, Topo } from "@/components/marcas-menores/Blocos";
import GerencialHeader from "@/components/gerencial/GerencialHeader";
import KpiBand from "@/components/gerencial/KpiBand";
import GlobalFilterControls from "@/components/layout/GlobalFilterControls";
import StateBlock from "@/components/ui/StateBlock";
import { useProdutosMarcasMenores } from "@/hooks/useProdutosMarcasMenores";
import { fetchMarcasMenores } from "@/lib/api-client";
import { fmtPeriodo } from "@/lib/filters/format";
import { escopoDeMarcas } from "@/lib/filters/brands";
import { toISODate } from "@/lib/filters/presets";
import type { GlobalFilters } from "@/lib/filters/types";
import { filtrarMarcasMenores, overviewDeMenores } from "@/lib/gerencial/marcas-menores-gerencial";
import { buildKpiBand } from "@/lib/gerencial/kpi-band";
import type { MarcasMenores } from "@/lib/marcas-menores";

export default function GerencialMarcasMenores({
  filters,
  onChange,
}: {
  filters: GlobalFilters;
  onChange: (v: Partial<GlobalFilters>) => void;
}) {
  const escopo = escopoDeMarcas(filters.brands);
  const [dados, setDados] = useState<MarcasMenores | null | undefined>(undefined);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setDados(undefined);
    fetchMarcasMenores(filters.dateFrom, filters.dateTo).then((d) => vivo && setDados(d));
    return () => {
      vivo = false;
    };
  }, [filters.dateFrom, filters.dateTo, recarga]);

  const idsKey = escopo.menores.join(",");
  const f = useMemo(
    () => (dados?.disponivel ? filtrarMarcasMenores(dados, escopo.menores, filters.channels) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey cobre a lista de marcas
    [dados, idsKey, filters.channels],
  );
  // Hoje ainda esta andando: comparar com o periodo anterior inteiro enganaria. Sem variacao.
  const emAndamento = !!dados?.periodo && dados.periodo.fim >= toISODate(new Date());
  const comparar = filters.compare && !emAndamento;
  const kpis = useMemo(() => buildKpiBand(f ? overviewDeMenores(f, filters.channels) : null, filters.channels, comparar), [f, filters.channels, comparar]);
  const periodLabel = dados?.periodo ? fmtPeriodo(dados.periodo.inicio, dados.periodo.fim) : fmtPeriodo(filters.dateFrom, filters.dateTo);
  const carregando = dados === undefined;
  // Filtro so com canal onde elas nao vendem (ML): nao e "zero pedido", e sem dado.
  const semCanalDelas = !filters.channels.some((c) => c === "shopee" || c === "tiktok");
  const comDado = !!f && f.marcas.some((m) => m.total != null);
  // Sem pedido nas marcas e canais escolhidos, os produtos nem sao pedidos (cada pedido custa uma chamada ao Bling).
  const { produtos, desistiu, tentar } = useProdutosMarcasMenores(dados?.periodo?.inicio, dados?.periodo?.fim, comDado, {
    canais: filters.channels,
    marcas: escopo.menores,
  });

  return (
    <div className="flex w-full flex-col gap-3 px-4 py-4">
      <GerencialHeader periodLabel={periodLabel} refreshedAt={null} live={dados?.disponivel ? true : null} loading={carregando}>
        <GlobalFilterControls filters={filters} onChange={onChange} loading={carregando} />
      </GerencialHeader>
      {carregando ? (
        <StateBlock tipo="carregando" titulo="Carregando as marcas" />
      ) : dados === null ? (
        <StateBlock tipo="erro" titulo="Não foi possível contatar a API" />
      ) : !dados.disponivel ? (
        <StateBlock
          tipo="indisponivel"
          titulo="Marcas menores indisponíveis"
          descricao={dados.motivo ?? undefined}
          acao={
            <button type="button" onClick={() => setRecarga((n) => n + 1)} className="min-h-11 text-xs font-semibold text-accent-ink hover:underline">
              Tentar de novo
            </button>
          }
        />
      ) : !f || !comDado ? (
        semCanalDelas ? (
          <StateBlock
            tipo="vazio"
            titulo="Sem dado das marcas menores no canal selecionado"
            descricao="As marcas menores vendem só na Shopee e no TikTok."
          />
        ) : (
          <StateBlock tipo="vazio" titulo="Sem dado no período" descricao="Nenhum pedido das marcas escolhidas chegou do Bling neste recorte." />
        )
      ) : (
        <>
          {f.consolidado && <Topo c={f.consolidado} marcas={f.marcas} emAndamento={emAndamento} titulo="GMV do período" semMeta />}
          <KpiBand kpis={kpis} loading={false} error={false} onOpen={() => {}} onRetry={() => setRecarga((n) => n + 1)} semGmv />
          <Marcas marcas={f.marcas} emAndamento={emAndamento} semMeta />
          <Produtos r={produtos} desistiu={desistiu} onTentar={tentar} titulo="Mais vendidos" ids={escopo.menores} />
        </>
      )}
    </div>
  );
}
