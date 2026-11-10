"use client";

/**
 * Bloco "Avaliações de produto (Shopee)" da aba CX (spec do Prumo, 09/11):
 * cards por marca (padrao Gerencial) + produtos em largura total; nota
 * ACUMULADA (nao segue o periodo; isso mora no ⓘ). Busca
 * propria (`GET /api/v1/cx/shopee/avaliacoes`): se cair, so' este bloco mostra
 * erro. Ausencia = "—" com motivo; contagem truncada = piso ("≥").
 */
import { Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import type { FiltrosCx } from "@/lib/cx";
import {
  ajudaAvaliacoes,
  carregarAvaliacoes,
  contagem,
  linhaAvaliacoes,
  nomeProduto,
  PISO,
  ordenarProdutos,
  type AvaliacoesProduto as Produto,
  type OrdemProdutos,
  type ResultadoAvaliacoes,
} from "@/lib/cx-avaliacoes";
import { nota, pct } from "@/lib/cx-site";
import { brandLabel } from "@/lib/filters/brands";
import { torreFetch } from "@/lib/torre-fetch";

const TITULO = "Avaliações de produto (Shopee)";
const LINHAS_NO_CARD = 10;
const ORDENS = [
  { valor: "pior", texto: "Pior nota" },
  { valor: "1a3", texto: "Mais 1–3 ★" },
] as const;

const THEAD = "bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint";
const TD = "whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-muted";

export default function AvaliacoesProduto({ filtros }: { filtros: FiltrosCx }) {
  const { marca } = filtros;
  const [r, setR] = useState<ResultadoAvaliacoes | null>(null);
  const [ordem, setOrdem] = useState<OrdemProdutos>("pior");
  const [todos, setTodos] = useState(false);

  const carregar = useCallback(() => {
    let vivo = true;
    setR(null);
    carregarAvaliacoes({ marca }, torreFetch as typeof fetch).then((x) => {
      if (vivo) setR(x);
    });
    return () => {
      vivo = false;
    };
  }, [marca]);

  useEffect(() => carregar(), [carregar]);

  if (!r) return <StateBlock tipo="carregando" titulo={`Carregando ${TITULO}`} />;
  if (!r.ok) {
    return <StateBlock tipo="erro" compacto titulo={`Não foi possível carregar ${TITULO}`} descricao={r.motivo} acao={<RetryButton onClick={() => carregar()} />} />;
  }

  const d = r.dados;
  const titulo = (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {TITULO}
      <InfoDica titulo={TITULO} texto={ajudaAvaliacoes(d, brandLabel)} />
      {/* dado velho nunca so' no ⓘ */}
      {d.aviso_frescor && (
        <Chip tom="critico" ponto title={d.aviso_frescor}>
          Desatualizado
        </Chip>
      )}
    </span>
  );

  if (d.estado === "erro" || (d.estado !== "dado" && d.marcas.length === 0)) {
    return (
      <Panel titulo={titulo} aria-label={TITULO}>
        <StateBlock
          tipo={d.estado === "erro" ? "erro" : "indisponivel"}
          compacto
          titulo={d.estado === "erro" ? "Avaliações indisponíveis nesta carga" : "Sem avaliações de produto"}
          descricao={d.motivo_indisponivel ?? undefined}
          acao={d.estado === "erro" ? <RetryButton onClick={() => carregar()} /> : undefined}
        />
      </Panel>
    );
  }

  const linhas = d.marcas.map((m) => ({ m, l: linhaAvaliacoes(m, brandLabel(m.marca)) }));
  const total = d.total ? { m: d.total, l: linhaAvaliacoes(d.total, "Total") } : null;
  // card Total primeiro; marca sem dado nunca vira card de "—": entra na linha "sem avaliações"
  const cards = [...(total && !total.l.ausente ? [total] : []), ...linhas.filter((x) => !x.l.ausente)];
  const semDado = linhas.filter((x) => x.l.ausente);
  const produtos = ordenarProdutos(d.produtos, ordem);

  return (
    <Panel titulo={titulo} aria-label={TITULO}>
      <div className="flex flex-col gap-3" data-testid="cx-avaliacoes">
        {cards.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
            {cards.map(({ m, l }) => (
              <KpiTile
                key={l.chave}
                variante="gerencial"
                identidade="atendimento"
                icone={Star}
                rotulo={l.marca}
                valor={l.nota}
                tom={l.ausente ? "ausente" : "neutro"}
                // % 1–3 ★ antes do absoluto; o piso ("≥") so' no title
                comparacao={
                  <span>
                    <span className="font-semibold text-ink">{l.pct1a3} 1–3 ★</span>
                    <span className="text-ink-faint"> · {l.avaliacoes.replace("≥ ", "")} aval.</span>
                  </span>
                }
                contexto={[
                  l.nota_extra,
                  d.respostas_medidas ? `${l.pctRespondidas} respondidas` : null,
                  m.truncado ? `Contagem de avaliações: ${l.avaliacoes}` : null,
                ].filter(Boolean).join(" · ") || undefined}
              />
            ))}
          </div>
        )}
        {semDado.length > 0 && (
          <p className="text-xs text-ink-faint" data-testid="cx-avaliacoes-sem-dado">
            sem avaliações: {semDado.map((x) => x.l.marca).join(", ")}
            <span className="sr-only"> ({semDado.map((x) => `${x.l.marca}: ${x.m.motivo ?? "sem dado"}`).join("; ")})</span>
          </p>
        )}

        <section aria-label="Produtos" className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              Produtos
              <InfoDica titulo="Produtos" texto={`Só produtos com ${d.minimo_avaliacoes} avaliações ou mais. Pior nota: nota mais baixa primeiro, desempate pelas avaliações de 1–3 ★.`} />
            </h3>
            <Segmented rotulo="Ordem dos produtos" opcoes={ORDENS} valor={ordem} aoEscolher={setOrdem} />
          </div>
          {produtos.length === 0 ? (
            <p className="text-xs text-ink-faint">Nenhum produto com {d.minimo_avaliacoes} avaliações ou mais.</p>
          ) : (
            <>
              <ListaProdutos itens={produtos.slice(0, LINHAS_NO_CARD)} />
              {produtos.length > LINHAS_NO_CARD && (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setTodos(true)}
                  className="inline-flex min-h-11 items-center self-start text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Ver todos ({produtos.length}) →
                </button>
              )}
            </>
          )}
        </section>
      </div>

      <KpiDrilldownDialog open={todos} onClose={() => setTodos(false)} title={`${TITULO} · todos os produtos`} largura="larga">
        <div className="flex flex-col gap-2">
          <Segmented rotulo="Ordem dos produtos" opcoes={ORDENS} valor={ordem} aoEscolher={setOrdem} className="self-start" />
          <ListaProdutos itens={produtos} />
        </div>
      </KpiDrilldownDialog>
    </Panel>
  );
}

function ListaProdutos({ itens }: { itens: Produto[] }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">Produtos da Shopee por avaliação</caption>
      <thead className={THEAD}>
        <tr>
          <th scope="col" className="px-2 py-2 text-left">Produto</th>
          <th scope="col" className="hidden w-28 px-2 py-2 text-left sm:table-cell">Marca</th>
          <th scope="col" className="w-20 whitespace-nowrap px-2 py-2 text-right">% 1–3 ★</th>
          <th scope="col" className="w-14 whitespace-nowrap px-2 py-2 text-right">Nota</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((p) => {
          const aval = `${contagem(p.avaliacoes, p.truncado)} avaliações${p.truncado ? ` (${PISO})` : ""}`;
          return (
            <tr key={`${p.marca}-${p.item_id}`} className="border-t border-line hover:bg-raised/60" title={aval}>
              <th scope="row" className="px-2 py-2 text-left font-normal">
                <span className="line-clamp-2 text-ink sm:block sm:truncate" title={p.nome ? p.nome : `item_id ${p.item_id}`}>{nomeProduto(p)}</span>
                <span className="block truncate text-xs text-ink-faint sm:hidden">{brandLabel(p.marca)}</span>
                <span className="sr-only">{aval}</span>
              </th>
              <td className="hidden truncate px-2 py-2 text-ink-muted sm:table-cell">{brandLabel(p.marca)}</td>
              <td className={`${TD} align-top`}>{pct(p.pct_1a3)}</td>
              <td className={`${TD} align-top font-semibold text-ink`}>{nota(p.nota_media).replace(" ★", "")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
