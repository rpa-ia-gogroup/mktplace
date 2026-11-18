"use client";

/**
 * OPORTUNIDADES-1 — "Maiores oportunidades": as 3 de maior ganho real (R$ em 30
 * dias) com a acao a tomar, na Gerencial. Respeita o filtro de marca: com uma
 * marca, sao as 3 dela; sem filtro, as 3 do grupo e "Ver por marca" abre o top 3
 * de cada empresa. Fontes: ruptura no Full (venda perdida) e capital parado
 * (slow moving). Nada e' somado: so' ordena.
 */
import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import InfoDica from "@/components/ui/InfoDica";
import { brandLabel } from "@/lib/filters/brands";
import { fmtBrlCurto } from "@/lib/formatters";
import { fetchOportunidades, ROTULO_TIPO, type Oportunidade, type OportunidadesResponse } from "@/lib/oportunidades";

function Linha({ o, pos }: { o: Oportunidade; pos: number }) {
  const canal = o.canal === "ml" ? "Mercado Livre" : o.canal === "shopee" ? "Shopee" : "Marketplace";
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent-ink">{pos}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{o.acao}</p>
        <p className="truncate text-sm text-ink">{o.titulo}</p>
        <p className="text-xs text-ink-muted">
          {brandLabel(o.marca)} · {canal} · {ROTULO_TIPO[o.tipo]}{o.sku ? ` · ${o.sku}` : ""} — {o.motivo}
        </p>
      </div>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-ink">{fmtBrlCurto(o.valor_30d)}</span>
        <span className="block text-xs text-ink-muted">em 30 dias</span>
      </span>
    </li>
  );
}

export default function OportunidadesTop3({ brands }: { brands: string[] }) {
  const [dados, setDados] = useState<OportunidadesResponse | null>(null);
  const [erro, setErro] = useState(false);
  const [porMarca, setPorMarca] = useState(false);
  const chave = brands.join(",");

  useEffect(() => {
    const ac = new AbortController();
    setDados(null);
    setErro(false);
    fetchOportunidades(brands, ac.signal).then(setDados).catch((e) => {
      if (!(e instanceof DOMException && e.name === "AbortError")) setErro(true);
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `chave` resume `brands`
  }, [chave]);

  // Falha ou nada a mostrar: o bloco some (a Gerencial segue igual), nunca "R$ 0".
  if (erro || (dados && dados.geral.length === 0)) return null;
  const marcas = dados ? Object.keys(dados.por_marca) : [];

  return (
    <section aria-labelledby="oport-titulo" className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="oport-titulo" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Lightbulb aria-hidden="true" className="h-4 w-4 text-accent-ink" />
          Maiores oportunidades{brands.length === 1 ? ` · ${brandLabel(brands[0])}` : ""}
          <InfoDica texto="Ganho em R$ nos próximos 30 dias. Ruptura no Full: venda que volta ao repor (média de 28 dias × preço). Capital parado: custo que sai do estoque se o SKU vender no ritmo da meta de 120 dias. Brinde e descontinuado ficam de fora." />
        </h2>
        {dados && marcas.length > 1 && (
          <button type="button" onClick={() => setPorMarca(true)} aria-haspopup="dialog"
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Ver por marca
          </button>
        )}
      </div>
      {!dados ? (
        <div role="status" aria-busy="true" className="mt-3 h-28 animate-pulse rounded-lg bg-raised motion-reduce:animate-none">
          <span className="sr-only">Carregando oportunidades…</span>
        </div>
      ) : (
        <ol className="mt-1 divide-y divide-line">
          {dados.geral.map((o, i) => <Linha key={`${o.tipo}|${o.canal}|${o.marca}|${o.sku}`} o={o} pos={i + 1} />)}
        </ol>
      )}
      {dados && dados.fontes_indisponiveis.length > 0 && (
        <p className="mt-1 text-xs text-ink-muted">
          Sem {dados.fontes_indisponiveis.map((f) => ROTULO_TIPO[f as Oportunidade["tipo"]] ?? f).join(" e ")} agora: o ranking usa só o que foi lido.
        </p>
      )}

      <KpiDrilldownDialog open={porMarca} onClose={() => setPorMarca(false)} title="Maiores oportunidades por marca" icone={Lightbulb} largura="larga">
        <div className="flex flex-col gap-4">
          {dados && marcas.map((m) => (
            <section key={m} aria-label={brandLabel(m)}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{brandLabel(m)}</h3>
              <ol className="divide-y divide-line">
                {dados.por_marca[m].map((o, i) => <Linha key={`${o.tipo}|${o.canal}|${o.sku}`} o={o} pos={i + 1} />)}
              </ol>
            </section>
          ))}
        </div>
      </KpiDrilldownDialog>
    </section>
  );
}
