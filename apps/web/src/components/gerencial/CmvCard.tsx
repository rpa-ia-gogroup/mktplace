"use client";

/**
 * Cartao de CMV % da Gerencial. Le a MESMA chamada da aba DRE (`fetchDre`) no
 * recorte de canal e marca do filtro; o mes vem de `mesDoCmv`. Clique abre a
 * DRE no mesmo recorte. Sem CMV = "Sem dado", nunca 0.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";
import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";
import type { Tom } from "@/components/ui/tone";
import { fetchDre } from "@/lib/dre-api";
import { dreUrlQuery, type DreResponse } from "@/lib/dre";
import { cartaoCmv, mesDoCmv } from "@/lib/gerencial/cmv-card";
import { toISODate } from "@/lib/filters/presets";
import type { Marketplace } from "@/lib/mock-data";

const TOM: Record<Tom, TomPilula> = { bom: "ok", atencao: "warn", critico: "crit", neutro: "neutro", ausente: "neutro" };

export default function CmvCard({ channels, brands, dateTo }: { channels: Marketplace[]; brands: string[]; dateTo: string }) {
  const router = useRouter();
  const mes = mesDoCmv(dateTo, toISODate(new Date()));
  const filtros = { mes, canais: channels, marcas: brands };
  const chave = `${mes}|${channels.join(",")}|${brands.join(",")}`;
  const [estado, setEstado] = useState<{ chave: string; resp: DreResponse | null; erro: boolean } | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetchDre(filtros, ctl.signal).then(
      (resp) => setEstado({ chave, resp, erro: false }),
      (err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setEstado({ chave, resp: null, erro: true });
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chave cobre o recorte
  }, [chave]);

  // 5o cartao: entre 480 e 1279px (2 colunas) ocupa a linha inteira em vez de ficar sozinho pela metade.
  const W = "last:min-[480px]:col-span-2 xl:col-span-1";
  if (estado?.chave !== chave) {
    return (
      <div className={`${W} h-[150px] animate-pulse rounded-2xl border border-line bg-surface p-4`} role="status" aria-busy="true">
        <span className="sr-only">Carregando CMV…</span>
        <div className="h-3 w-24 rounded bg-raised" />
        <div className="mt-3 h-8 w-36 rounded bg-raised" />
      </div>
    );
  }
  const c = estado.resp ? cartaoCmv(estado.resp, mes) : null;
  return (
    <div className={W}>
    <CartaoIndicador
      rotulo="CMV / receita"
      icone={Boxes}
      cor="rgb(var(--tc-kpi-cmv))"
      valor={c?.valor ?? (estado.erro ? "—" : "Sem dado")}
      ausente={!c?.valor}
      pilula={c?.selo ? { texto: c.selo.rotulo, tom: TOM[c.selo.tom] } : null}
      legenda={
        estado.erro
          ? "A DRE não respondeu nesta carga."
          : [c?.competencia, c?.previa ? "prévia" : null, c?.semDado].filter(Boolean).join(" · ")
      }
      ajuda={<InfoDica emControle texto={c?.dica ?? "CMV ÷ receita da DRE, o mesmo número da aba DRE."} />}
      onAbrir={() => router.push(`/dre?${dreUrlQuery(filtros)}`)}
    />
    </div>
  );
}
