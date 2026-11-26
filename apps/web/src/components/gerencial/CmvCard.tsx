"use client";

/**
 * Cartao CMV / RECEITA da Gerencial: CMV pelas notas fiscais NO PERIODO DO
 * FILTRO (de/ate, comparativo e base, os mesmos dos outros cartoes), com
 * estimativa dos dias sem nota completa. Tudo calculado na API
 * (`GET /api/v1/performance/cmv-notas`). O mes fechado da DRE (`fetchDre`)
 * vira a 2a linha e o ⓘ. Clique abre o CMV POR MARCA (detalhe no padrao dos
 * outros cartoes, `KpiDrilldownDialog`), com "Ver DRE" no rodape. Sem CMV =
 * "Sem dado", nunca 0.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";
import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import DrilldownCta from "@/components/drilldown/DrilldownCta";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import { brandLabel } from "@/lib/filters/brands";
import { fmtBrlCurto } from "@/lib/formatters";
import InfoDica from "@/components/ui/InfoDica";
import { fetchDre } from "@/lib/dre-api";
import { dreUrlQuery, type DreResponse } from "@/lib/dre";
import { cartaoCmvNotas, linhaDre, linhasPorMarca, mesDoCmv, periodoCurto, textoDre, type CmvNotas } from "@/lib/gerencial/cmv-card";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import { pilulaPp } from "@/lib/gerencial/kpi-band";
import { toISODate } from "@/lib/filters/presets";
import { torreFetch } from "@/lib/torre-fetch";
import { serializeMarketplaceSelection } from "@/lib/marketplace-filter";
import type { Marketplace } from "@/lib/mock-data";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Props {
  channels: Marketplace[];
  brands: string[];
  dateFrom: string;
  dateTo: string;
  compare: boolean;
  base: string;
}

async function fetchCmvNotas(p: Props, signal: AbortSignal): Promise<CmvNotas> {
  const q = new URLSearchParams({ channels: serializeMarketplaceSelection(p.channels), date_from: p.dateFrom, date_to: p.dateTo });
  if (p.brands.length) q.set("brands", [...p.brands].sort().join(","));
  if (p.compare) q.set("compare", "true");
  if (p.base === "realizados") q.set("base", "realizados");
  const res = await torreFetch(`${API_URL}/api/v1/performance/cmv-notas?${q}`, { signal });
  if (!res.ok) throw new Error(`cmv-notas ${res.status}`);
  return (await res.json()) as CmvNotas;
}

export default function CmvCard(props: Props) {
  const { channels, brands, dateFrom, dateTo, compare, base } = props;
  const router = useRouter();
  const hoje = toISODate(new Date());
  const mesDre = mesDoCmv(dateTo, hoje);
  const filtros = { mes: mesDre, canais: channels, marcas: brands };
  const chave = `${dateFrom}|${dateTo}|${compare}|${base}|${channels.join(",")}|${brands.join(",")}`;
  const [estado, setEstado] = useState<{ chave: string; nf: CmvNotas | null; dre: DreResponse | null } | null>(null);
  const [aberto, setAberto] = useState(false);
  // Outro recorte: o detalhe aberto era do anterior.
  useEffect(() => setAberto(false), [chave]);

  useEffect(() => {
    const ctl = new AbortController();
    // A DRE e' so' a 2a linha e o ⓘ: se ela falhar, o cartao segue com as notas.
    Promise.allSettled([fetchCmvNotas(props, ctl.signal), fetchDre(filtros, ctl.signal)]).then(([nf, dre]) => {
      if (ctl.signal.aborted) return;
      setEstado({
        chave,
        nf: nf.status === "fulfilled" ? nf.value : null,
        dre: dre.status === "fulfilled" ? dre.value : null,
      });
    });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chave cobre o recorte
  }, [chave]);

  // 5o cartao: entre 480 e 1279px (2 colunas) ocupa a linha inteira em vez de ficar sozinho pela metade.
  const W = "last:min-[480px]:max-xl:col-span-2";
  if (estado?.chave !== chave) {
    return (
      <div className={`${W} h-[150px] animate-pulse rounded-2xl border border-line bg-surface p-4`} role="status" aria-busy="true">
        <span className="sr-only">Carregando CMV…</span>
        <div className="h-3 w-24 rounded bg-raised" />
        <div className="mt-3 h-8 w-36 rounded bg-raised" />
      </div>
    );
  }
  const dre = textoDre(estado.dre, mesDre);
  const c = estado.nf ? cartaoCmvNotas(estado.nf, dre, hoje) : null;
  const fechado = linhaDre(estado.dre, mesDre);
  // CMV %: menor e' melhor, como o TACOS (▼ verde, ▲ vermelho). Sem anterior: sem pilula.
  const delta = compare && c?.valor ? pilulaPp(c.deltaPp) : null;
  return (
    <div className={W}>
    <CartaoIndicador
      rotulo="CMV / receita"
      icone={Boxes}
      cor="rgb(var(--tc-kpi-cmv))"
      valor={c?.valor ?? (estado.nf ? "Sem dado" : "—")}
      ausente={!c?.valor}
      pilula={delta ? { texto: `${delta.texto} vs anterior`, tom: delta.tom as TomPilula } : null}
      legenda={
        <>
          <span className="block text-balance">
            {c?.parcial && <span className="mr-1.5 rounded-full bg-warn-soft px-2 py-0.5 font-semibold text-warn-ink">Parcial</span>}
            {c ? c.legenda : "A base de custo das notas não respondeu nesta carga."}
          </span>
          {fechado && <span className="block">{fechado}</span>}
        </>
      }
      ajuda={<InfoDica emControle texto={c?.dica ?? ["CMV pelas notas fiscais do período = CMV ÷ receita com custo.", dre].filter(Boolean).join(" ")} />}
      onAbrir={() => (estado.nf ? setAberto(true) : router.push(`/dre?${dreUrlQuery(filtros)}`))}
    />
    {estado.nf && (
      <KpiDrilldownDialog open={aberto} onClose={() => setAberto(false)} title="CMV / receita por marca" icone={Boxes} identidade="cmv">
        <div className="flex flex-col gap-4 text-sm">
          {/* Topo no padrao do TACOS: o total e o contexto (periodo e ate quando ha nota), sempre visiveis. */}
          <div className="flex flex-col gap-2">
            <NumeroAnimado texto={c?.valor ?? "Sem dado"} className={`text-[32px] font-bold leading-none tracking-tight tabular-nums ${c?.valor ? "text-ink" : "text-ink-faint"}`} />
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              <span className="rounded-full border border-line bg-raised px-2 py-0.5 tabular-nums">{periodoCurto(estado.nf.date_from, estado.nf.date_to)}</span>
              <span className="rounded-full border border-line px-2 py-0.5 tabular-nums">
                {estado.nf.ultima_nf ? `Notas até ${periodoCurto(estado.nf.ultima_nf, estado.nf.ultima_nf)}` : "Sem notas no recorte"}
              </span>
            </p>
          </div>
          <DrilldownSecao titulo="Por marca" acao="por receita">
            {linhasPorMarca(estado.nf, compare).length ? (
              <ul className="flex flex-col">
                {linhasPorMarca(estado.nf, compare).map((l) => (
                  <EvidenceRow
                    key={l.marca}
                    label={brandLabel(l.marca)}
                    value={l.valor ?? "Sem dado"}
                    tone={l.valor ? "value" : "muted"}
                    delta={l.deltaPp != null ? { pct: l.deltaPp, menorMelhor: true, unidade: "pp", apagado: l.basePequena } : null}
                    reference={[
                      l.receita != null ? `Receita ${fmtBrlCurto(l.receita)}` : null,
                      l.estimado ? `${l.estimado} estimado` : null,
                      l.parcial ? "Parcial" : null,
                    ].filter(Boolean).join(" · ")}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-ink-faint">Sem notas no recorte.</p>
            )}
          </DrilldownSecao>
          <DrilldownCta href={`/dre?${dreUrlQuery(filtros)}`}>Ver DRE →</DrilldownCta>
        </div>
      </KpiDrilldownDialog>
    )}
    </div>
  );
}
