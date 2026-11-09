"use client";

/**
 * Bloco "CX do site (DTC)" da aba CX: NPS, reenvio/reembolso e reviews do
 * site da Gobeaute, lidos do Data Mart (`GET /api/v1/cx/site`). Busca propria
 * e estado proprio: se cair, so' este bloco mostra erro.
 */
import { useCallback, useEffect, useState } from "react";
import { Repeat2, Smile, Star, Undo2, type LucideIcon } from "lucide-react";

import TableScrollHint from "@/components/TableScrollHint";
import { LinhaSemComparacao, pilula } from "@/components/gerencial/CxResumo";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { textoSemComparacao, type FiltrosCx } from "@/lib/cx";
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
  frescorDoBloco,
  type ResultadoCxSite,
  type ReviewsProduto,
} from "@/lib/cx-site";
import { brandLabel } from "@/lib/filters/brands";
import { textoJanela } from "@/lib/performance-contas-atendimento";
import { torreFetch } from "@/lib/torre-fetch";

const TITULO = "CX do site (DTC)";

/** Cor de identidade de cada card (spec do Prumo, 09/11); sem delta nem serie: a API ainda nao traz. */
const IDENT_SITE: Record<string, { identidade: IdentidadeKpi; icone: LucideIcon }> = {
  "NPS do site": { identidade: "atendimento", icone: Smile },
  "Taxa de reenvio": { identidade: "ads", icone: Repeat2 },
  "Taxa de reembolso": { identidade: "gmv", icone: Undo2 },
  "Reviews 1–3 ★": { identidade: "pedidos", icone: Star },
};

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
  // hora da carga e fonte de cada card vao para o ⓘ dele (os chips do topo sairam)
  const blocoDoCard: Record<string, Parameters<typeof frescorDoBloco>[0]> = {
    "NPS do site": d.nps,
    "Taxa de reenvio": d.reenvio_reembolso,
    "Taxa de reembolso": d.reenvio_reembolso,
    "Reviews 1–3 ★": d.reviews,
  };

  return (
    <Panel
      titulo={
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          {TITULO}
          <InfoDica titulo="Reenvio e reembolso" texto={RESSALVA_REENVIO} />
          {recorte && <span className="text-xs font-normal text-ink-faint" data-testid="cx-site-recorte">{recorte}</span>}
        </span>
      }
      descricao={textoJanela(d.janela)} aria-label={TITULO}>
      <div className="flex flex-col gap-4" data-testid="cx-site">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => (
            <KpiTile
              key={t.rotulo}
              variante="gerencial"
              identidade={IDENT_SITE[t.rotulo]?.identidade}
              icone={IDENT_SITE[t.rotulo]?.icone}
              rotulo={t.rotulo}
              valor={t.valor}
              comparacao={
                frescorDoBloco(blocoDoCard[t.rotulo]).parada ? (
                  // carga parada: um selo so', no proprio card; o texto inteiro no ⓘ
                  <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="cx-site-aviso-reviews">
                    <Chip tom="critico" ponto>Desatualizado</Chip>
                    {t.comparacao}
                  </span>
                ) : (
                  t.comparacao
                )
              }
              tom={t.ausente ? "ausente" : "neutro"}
              delta={t.comp ? pilula(t.comp) : undefined}
              antes={(() => {
                if (t.comp?.delta != null) return t.comp.antes;
                // API-3: sem periodo anterior, a linha neutra com o motivo e a data
                const sem = t.ausente ? null : textoSemComparacao(blocoDoCard[t.rotulo].sem_anterior);
                return sem ? <LinhaSemComparacao {...sem} /> : undefined;
              })()}
              serie={t.comp?.serie ?? undefined}
              granularidade={t.comp?.granularidade}
              ajuda={<InfoDica texto={`${t.ajuda} ${frescorDoBloco(blocoDoCard[t.rotulo]).texto}`} titulo={t.rotulo} />}
            />
          ))}
        </div>

        {(linhas.length > 0 || d.reviews.estado === "dado") && (
        <MaisDetalhes titulo="Por marca e produtos">
        {linhas.length > 0 && (
          <TableScrollHint>
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
          </TableScrollHint>
        )}

        {d.reviews.estado === "dado" && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Produtos titulo="Produtos com pior nota" itens={d.reviews.piores} minimo={d.reviews.minimo_reviews} />
            <Produtos titulo="Produtos com melhor nota" itens={d.reviews.melhores} minimo={d.reviews.minimo_reviews} />
          </div>
        )}
        </MaisDetalhes>
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
