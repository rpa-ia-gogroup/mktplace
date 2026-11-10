"use client";

/**
 * Marcas menores (Denavita, Yenzah, Auá, By Samia) — fonte: API do Avoe, não o
 * Data Mart. Fica SEPARADA: não entra no GMV total, na meta nem na rosca da
 * Gerencial. O Avoe só entrega até ontem (D-1); fonte e D-1 vivem só no ⓘ.
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Layers } from "lucide-react";

import DateRangeFilter from "@/components/DateRangeFilter";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import StateBlock from "@/components/ui/StateBlock";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import { fetchMarcasMenores } from "@/lib/api-client";
import { fmtPeriodo } from "@/lib/filters/format";
import { corDaPlataforma, fatias, nomeDaPlataforma, type MarcaMenor, type MarcasMenores } from "@/lib/marcas-menores";
import { fmtCompacto } from "@/lib/metas";

const SerieDiaria = dynamic(() => import("./SerieDiaria"), { ssr: false, loading: () => <div className="h-36" aria-hidden="true" /> });

const FONTE =
  "Fonte: API do Avoe, não o Data Mart. O Avoe entrega até ontem (D-1), então o dia de hoje não aparece. Estas marcas ficam fora do GMV total, da meta e da rosca da Gerencial.";

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

  const periodo = dados?.periodo ? fmtPeriodo(dados.periodo.inicio, dados.periodo.fim) : fmtPeriodo(filters.dateFrom, filters.dateTo);
  return (
    <PageContainer>
      <PageHeader
        title="Marcas menores"
        icon={Layers}
        meta={
          <>
            <Chip>{periodo}</Chip>
            {dados?.ajustado && <Chip>dado até ontem</Chip>}
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
        <StateBlock tipo="carregando" titulo="Carregando as marcas" />
      ) : estado === "erro" || !dados ? (
        <StateBlock tipo="erro" titulo="Não foi possível contatar a API" />
      ) : !dados.disponivel ? (
        <StateBlock tipo="indisponivel" titulo="Marcas menores indisponíveis" descricao={dados.motivo ?? undefined} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {dados.marcas.map((m) => (
            <li key={m.id}>
              <CartaoMarca m={m} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

function CartaoMarca({ m }: { m: MarcaMenor }) {
  const partes = fatias(m);
  return (
    <section aria-label={m.label} className="flex h-full flex-col gap-3 rounded-xl border border-kpi-gmv/30 bg-surface p-4">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{m.label}</h2>
        <p className="text-2xl font-bold leading-none tabular-nums text-ink">{m.total == null ? "—" : fmtCompacto(m.total)}</p>
      </div>
      {m.total == null ? (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-sm text-ink-muted">
          Sem dado do Avoe no período.
        </p>
      ) : (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
            {partes.map((p) => (
              <span key={p.plataforma} style={{ flex: p.frac, background: corDaPlataforma(p.plataforma) }} />
            ))}
          </div>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {m.por_plataforma.map((p, i) => (
              <li key={p.plataforma} className="flex items-center gap-2 text-xs text-ink-muted tabular-nums">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: corDaPlataforma(p.plataforma) }} aria-hidden="true" />
                <span className="truncate">{nomeDaPlataforma(p.plataforma)}</span>
                <span className="ml-auto w-9 text-right">{Math.round(partes[i].frac * 100)}%</span>
                <span className="w-24 text-right font-semibold text-ink">{fmtCompacto(p.faturamento)}</span>
              </li>
            ))}
          </ul>
          {/* Um dia so': a barra repetiria a lista acima. */}
          {m.serie.length > 1 && <SerieDiaria marca={m} />}
        </>
      )}
    </section>
  );
}
