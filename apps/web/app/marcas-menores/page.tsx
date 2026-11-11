"use client";

/**
 * Marcas menores (Denavita, Yenzah, Auá, By Samia) — fonte: API do Bling v3 (a
 * conta da Denavita ainda não foi autorizada: "aguardando", nunca 0). Só ML,
 * Shopee e TikTok. Fica SEPARADA: não entra no GMV total, na meta nem na rosca
 * da Gerencial, e não tem meta.
 */
import { useEffect, useState } from "react";
import { Layers } from "lucide-react";

import DateRangeFilter from "@/components/DateRangeFilter";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import { EsqueletoMarcasMenores, Marcas, Produtos, Topo } from "@/components/marcas-menores/Blocos";
import StateBlock from "@/components/ui/StateBlock";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import { fetchMarcasMenores } from "@/lib/api-client";
import { useProdutosMarcasMenores } from "@/hooks/useProdutosMarcasMenores";
import { fmtPeriodo } from "@/lib/filters/format";
import { toISODate } from "@/lib/filters/presets";
import type { MarcasMenores } from "@/lib/marcas-menores";

const FONTE =
  "Fonte: API do Bling (conta da Rituária), em tempo quase real: o dia de hoje conta. A marca vem do canal do pedido, só Shopee e TikTok; nenhuma tem Mercado Livre. Receita = total do pedido (produtos − descontos + frete), sem cancelados. A Denavita está em outra conta, ainda sem autorização. Estas marcas ficam fora do GMV total, da meta e da rosca da Gerencial e não têm meta.";

export default function MarcasMenoresPage() {
  const [filters, setFilters] = useGlobalFilters({ defaultPreset: "7d", defaultCompare: false });
  const [dados, setDados] = useState<MarcasMenores | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    fetchMarcasMenores(filters.dateFrom, filters.dateTo).then((d) => {
      if (!vivo) return;
      setDados(d);
      setEstado(d ? "ok" : "erro");
    });
    return () => {
      vivo = false;
    };
  }, [filters.dateFrom, filters.dateTo]);
  // Os produtos pedem JUNTO com as marcas (a API recorta o futuro) e falham sozinhos: nada espera nada.
  const { produtos, desistiu, tentar } = useProdutosMarcasMenores(filters.dateFrom, filters.dateTo, true);

  // O dia de hoje ainda está andando: comparar com o período anterior inteiro enganaria. Sem variação.
  const emAndamento = !!dados?.periodo && dados.periodo.fim >= toISODate(new Date());
  const periodo = dados?.periodo ? fmtPeriodo(dados.periodo.inicio, dados.periodo.fim) : fmtPeriodo(filters.dateFrom, filters.dateTo);
  return (
    <PageContainer>
      <PageHeader
        title="Demais marcas"
        icon={Layers}
        meta={
          <>
            <Chip>{periodo}</Chip>
            <InfoDica texto={FONTE} />
          </>
        }
        filters={
          <DateRangeFilter
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            compare={false}
            onChange={(v) => setFilters(v)}
            onCompareChange={() => {}}
            hideCompare
          />
        }
      />
      {estado === "carregando" ? (
        <EsqueletoMarcasMenores />
      ) : estado === "erro" || !dados ? (
        <StateBlock tipo="erro" titulo="Não foi possível contatar a API" />
      ) : !dados.disponivel ? (
        <StateBlock tipo="indisponivel" titulo="Demais marcas indisponíveis" descricao={dados.motivo ?? undefined} />
      ) : (
        <>
          {dados.consolidado && <Topo c={dados.consolidado} marcas={dados.marcas} emAndamento={emAndamento} />}
          <Marcas marcas={dados.marcas} emAndamento={emAndamento} />
          <Produtos r={produtos} desistiu={desistiu} onTentar={tentar} />
        </>
      )}
    </PageContainer>
  );
}
