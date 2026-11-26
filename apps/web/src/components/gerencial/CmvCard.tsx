"use client";

/**
 * Cartao CMV / RECEITA da Gerencial: CMV do mes ate ontem pelas notas fiscais
 * (`GET /api/v1/performance/cmv-notas`, calculado na API), no recorte de canal
 * e marca do filtro. O mes fechado da DRE (`fetchDre`) vai so' para o ⓘ. Clique
 * abre a DRE. Sem CMV = "Sem dado", nunca 0.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";
import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";
import type { Tom } from "@/components/ui/tone";
import { fetchDre } from "@/lib/dre-api";
import { dreUrlQuery, type DreResponse } from "@/lib/dre";
import { cartaoCmvNotas, mesDoCmv, textoDre, type CmvNotas } from "@/lib/gerencial/cmv-card";
import { toISODate } from "@/lib/filters/presets";
import { torreFetch } from "@/lib/torre-fetch";
import { serializeMarketplaceSelection } from "@/lib/marketplace-filter";
import type { Marketplace } from "@/lib/mock-data";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const TOM: Record<Tom, TomPilula> = { bom: "ok", atencao: "warn", critico: "crit", neutro: "neutro", ausente: "neutro" };

async function fetchCmvNotas(channels: Marketplace[], brands: string[], dateTo: string, signal: AbortSignal): Promise<CmvNotas> {
  const q = new URLSearchParams({ channels: serializeMarketplaceSelection(channels), date_to: dateTo });
  if (brands.length) q.set("brands", brands.join(","));
  const res = await torreFetch(`${API_URL}/api/v1/performance/cmv-notas?${q}`, { signal });
  if (!res.ok) throw new Error(`cmv-notas ${res.status}`);
  return (await res.json()) as CmvNotas;
}

export default function CmvCard({ channels, brands, dateTo }: { channels: Marketplace[]; brands: string[]; dateTo: string }) {
  const router = useRouter();
  const mesDre = mesDoCmv(dateTo, toISODate(new Date()));
  const filtros = { mes: mesDre, canais: channels, marcas: brands };
  const chave = `${dateTo}|${channels.join(",")}|${brands.join(",")}`;
  const [estado, setEstado] = useState<{ chave: string; nf: CmvNotas | null; dre: DreResponse | null } | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const abortou = () => ctl.signal.aborted;
    // A DRE e' so' o ⓘ: se ela falhar, o cartao segue com as notas.
    Promise.allSettled([fetchCmvNotas(channels, brands, dateTo, ctl.signal), fetchDre(filtros, ctl.signal)]).then(([nf, dre]) => {
      if (abortou()) return;
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
  const c = estado.nf ? cartaoCmvNotas(estado.nf, dre) : null;
  return (
    <div className={W}>
    <CartaoIndicador
      rotulo="CMV / receita"
      icone={Boxes}
      cor="rgb(var(--tc-kpi-cmv))"
      valor={c?.valor ?? (estado.nf ? "Sem dado" : "—")}
      ausente={!c?.valor}
      pilula={c?.selo ? { texto: c.selo.rotulo, tom: TOM[c.selo.tom] } : null}
      legenda={<span className="text-balance">{c ? c.legenda : "A base de custo das notas não respondeu nesta carga."}</span>}
      ajuda={<InfoDica emControle texto={c?.dica ?? ["CMV pelas notas fiscais do mês = CMV ÷ receita com custo.", dre].filter(Boolean).join(" ")} />}
      onAbrir={() => router.push(`/dre?${dreUrlQuery(filtros)}`)}
    />
    </div>
  );
}
