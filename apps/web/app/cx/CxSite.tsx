"use client";

/**
 * Bloco "CX do site (DTC)" da aba CX: NPS, reenvio/reembolso e reviews do
 * site da Gobeaute, lidos do Data Mart (`GET /api/v1/cx/site`). Busca propria
 * e estado proprio: se cair, so' este bloco mostra erro.
 */
import { useCallback, useEffect, useState } from "react";

import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import type { FiltrosCx } from "@/lib/cx";
import {
  AJUDA_SITE,
  avisoRecorte,
  carregarCxSite,
  foraDasFontes,
  montarMarcasSite,
  montarTilesSite,
  nota,
  pct,
  RESSALVA_REENVIO,
  seloFrescor,
  textoSafra,
  type ResultadoCxSite,
  type ReviewsProduto,
} from "@/lib/cx-site";
import { brandLabel } from "@/lib/filters/brands";
import { textoJanela } from "@/lib/performance-contas-atendimento";
import { torreFetch } from "@/lib/torre-fetch";

const TITULO = "CX do site (DTC)";

export default function CxSite({ filtros }: { filtros: FiltrosCx }) {
  const { marca, dias } = filtros;
  const [r, setR] = useState<ResultadoCxSite | null>(null);

  const carregar = useCallback(() => {
    let vivo = true;
    setR(null);
    carregarCxSite({ marca, dias }, torreFetch as typeof fetch).then((x) => {
      if (vivo) setR(x);
    });
    return () => {
      vivo = false;
    };
  }, [marca, dias]);

  useEffect(() => carregar(), [carregar]);

  if (!r) return <StateBlock tipo="carregando" titulo={`Carregando ${TITULO}`} />;
  if (!r.ok) {
    return <StateBlock tipo="erro" titulo={`Não foi possível carregar ${TITULO}`} descricao={r.motivo} acao={<RetryButton onClick={() => carregar()} />} />;
  }

  const d = r.dados;
  const tiles = montarTilesSite(d);
  const linhas = montarMarcasSite(d, brandLabel);
  const fora = foraDasFontes(d, brandLabel);
  const recorte = avisoRecorte(dias);
  const selos = [seloFrescor("NPS", d.nps), seloFrescor("Reenvio", d.reenvio_reembolso), seloFrescor("Reviews", d.reviews)];

  return (
    <Panel
      titulo={
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          {TITULO}
          {recorte && <span className="text-xs font-normal text-ink-faint" data-testid="cx-site-recorte">{recorte}</span>}
        </span>
      }
      descricao="NPS, reenvio, reembolso e reviews do site" aria-label={TITULO}>
      <div className="flex flex-col gap-4" data-testid="cx-site">
        <div className="flex flex-wrap gap-2">
          <Chip>{textoJanela(d.janela)}</Chip>
          <Chip>Reenvio: {textoSafra(d.reenvio_reembolso.safra_inicio, d.reenvio_reembolso.safra_fim)}</Chip>
          {selos.map((s) => (
            <Chip key={s.texto} tom={s.tom} ponto={s.tom === "critico"} title={s.title}>{s.texto}</Chip>
          ))}
        </div>
        {d.reviews.aviso_frescor && (
          <p className="text-xs font-medium text-crit-ink" data-testid="cx-site-aviso-reviews">Reviews: {d.reviews.aviso_frescor}</p>
        )}
        <p className="text-xs text-ink-muted" data-testid="cx-site-ressalva">{RESSALVA_REENVIO}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => (
            <KpiTile
              key={t.rotulo}
              rotulo={t.rotulo}
              valor={t.valor}
              comparacao={t.comparacao}
              tom={t.ausente ? "ausente" : "neutro"}
              ajuda={<InfoDica texto={t.ajuda} titulo={t.rotulo} />}
            />
          ))}
        </div>

        {linhas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">CX do site por marca</caption>
              <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <tr>
                  <th scope="col" className="px-2 py-2 text-left">
                    <span className="inline-flex items-center gap-1">
                      Marca
                      {fora.length > 0 && <InfoDica texto={fora.join(" ")} titulo="Fora das fontes" />}
                    </span>
                  </th>
                  {["NPS", "Detratores", "Reenvio", "Reembolso", "Nota média", "1–3 ★"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-2 py-2 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.chave} className="border-t border-line hover:bg-raised/60">
                    <th scope="row" className="px-2 py-2 text-left font-semibold text-ink">{l.marca}</th>
                    {[l.nps, l.detratores, l.reenvio, l.reembolso, l.media, l.baixas].map((v, i) => (
                      <td key={i} className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-muted">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {d.reviews.estado === "dado" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Produtos titulo="Produtos com pior nota" itens={d.reviews.piores} minimo={d.reviews.minimo_reviews} />
            <Produtos titulo="Produtos com melhor nota" itens={d.reviews.melhores} minimo={d.reviews.minimo_reviews} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function Produtos({ titulo, itens, minimo }: { titulo: string; itens: ReviewsProduto[]; minimo: number }) {
  return (
    <section aria-label={titulo} className="rounded-lg border border-line p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {titulo}
        <InfoDica texto={`${AJUDA_SITE.produtos} Mínimo: ${minimo} reviews.`} titulo={titulo} />
      </h3>
      {itens.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">Nenhum produto com {minimo} reviews ou mais no período.</p>
      ) : (
        <ol className="mt-2 flex flex-col divide-y divide-line">
          {itens.map((p) => (
            <li key={`${p.marca}-${p.produto}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink" title={p.produto}>{p.produto}</span>
                <span className="text-xs text-ink-faint">{brandLabel(p.marca)} · {p.reviews} reviews</span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block font-semibold text-ink">{nota(p.media)}</span>
                <span className="text-xs text-ink-faint">{pct(p.baixas_pct)} 1–3 ★</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
