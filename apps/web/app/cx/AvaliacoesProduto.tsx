"use client";

/**
 * Bloco "Avaliações de produto (Shopee)" da aba CX (spec do Prumo, 09/11):
 * marcas 5/12 | produtos 7/12, nota ACUMULADA (nao segue o periodo). Busca
 * propria (`GET /api/v1/cx/shopee/avaliacoes`): se cair, so' este bloco mostra
 * erro. Ausencia = "—" com motivo; contagem truncada = piso ("≥").
 */
import { useCallback, useEffect, useState } from "react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import TableScrollHint from "@/components/TableScrollHint";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
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
  ordenarProdutos,
  type AvaliacoesProduto as Produto,
  type LinhaAvaliacoes,
  type OrdemProdutos,
  type ResultadoAvaliacoes,
} from "@/lib/cx-avaliacoes";
import { nota, pct } from "@/lib/cx-site";
import { TITULO_SEGUNDA_TENTATIVA } from "@/lib/performance-contas";
import { brandLabel } from "@/lib/filters/brands";
import { torreFetch } from "@/lib/torre-fetch";

const TITULO = "Avaliações de produto (Shopee)";
const DESCRICAO = "Nota acumulada · não segue o período";
const LINHAS_NO_CARD = 10;
const ORDENS = [
  { valor: "pior", texto: "Pior nota" },
  { valor: "1a3", texto: "Mais 1–3 ★" },
] as const;

const THEAD = "bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint";
const TD = "whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-muted";

export default function AvaliacoesProduto({ filtros }: { filtros: FiltrosCx }) {
  const { marca } = filtros;
  const [repetindo, setRepetindo] = useState(false);
  const [r, setR] = useState<ResultadoAvaliacoes | null>(null);
  const [ordem, setOrdem] = useState<OrdemProdutos>("pior");
  const [todos, setTodos] = useState(false);

  const carregar = useCallback(() => {
    let vivo = true;
    setR(null);
    setRepetindo(false);
    const aoRepetir = () => vivo && setRepetindo(true);
    carregarAvaliacoes({ marca }, torreFetch as typeof fetch, undefined, undefined, aoRepetir).then((x) => {
      if (vivo) setR(x);
    });
    return () => {
      vivo = false;
    };
  }, [marca]);

  useEffect(() => carregar(), [carregar]);

  if (!r) {
    return <StateBlock tipo="carregando" titulo={repetindo ? TITULO_SEGUNDA_TENTATIVA : `Carregando ${TITULO}`} />;
  }
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
      <Panel titulo={titulo} descricao={DESCRICAO} aria-label={TITULO}>
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

  const linhas = d.marcas.map((m) => linhaAvaliacoes(m, brandLabel(m.marca)));
  const total = d.total ? linhaAvaliacoes(d.total, "Total") : null;
  const produtos = ordenarProdutos(d.produtos, ordem);

  return (
    <Panel titulo={titulo} descricao={DESCRICAO} aria-label={TITULO}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" data-testid="cx-avaliacoes">
        <div className="min-w-0 lg:col-span-5">
          <TableScrollHint>
            <table className={`w-full border-collapse text-sm ${d.respostas_medidas ? "min-w-[420px]" : ""}`}>
              <caption className="sr-only">Avaliações de produto da Shopee por marca</caption>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className="px-2 py-2 text-left">Marca</th>
                  {["Nota", "% 1–3 ★", ...(d.respostas_medidas ? ["% respondidas"] : []), "Avaliações"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-2 py-2 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <LinhaMarca key={l.chave} l={l} respostas={d.respostas_medidas} />
                ))}
                {total && <LinhaMarca l={total} totalizador respostas={d.respostas_medidas} />}
              </tbody>
            </table>
          </TableScrollHint>
        </div>

        <section aria-label="Produtos" className="flex min-w-0 flex-col gap-2 lg:col-span-7">
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

function LinhaMarca({ l, totalizador = false, respostas }: { l: LinhaAvaliacoes; totalizador?: boolean; respostas: boolean }) {
  const extra = l.nota_extra;
  return (
    <tr className={totalizador ? "border-t border-line-strong bg-raised font-semibold" : "border-t border-line hover:bg-raised/60"} title={extra ?? undefined}>
      <th scope="row" className="whitespace-nowrap px-2 py-2 text-left font-semibold text-ink">
        {l.marca}
        {extra && <span className="sr-only"> ({extra})</span>}
      </th>
      <td className={`${TD} ${l.ausente ? "" : "font-semibold text-ink"}`}>{l.nota}</td>
      <td className={TD}>{l.pct1a3}</td>
      {/* respostas nao coletadas: a coluna sai (coluna so' com "—" nao aparece) */}
      {respostas && <td className={TD}>{l.pctRespondidas}</td>}
      <td className={TD}>{l.avaliacoes}</td>
    </tr>
  );
}

function ListaProdutos({ itens }: { itens: Produto[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Produtos da Shopee por avaliação</caption>
      <thead className={THEAD}>
        <tr>
          <th scope="col" className="px-2 py-2 text-left">Produto</th>
          <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Nota</th>
          <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">% 1–3 ★</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((p) => (
          <tr key={`${p.marca}-${p.item_id}`} className="border-t border-line hover:bg-raised/60">
            <th scope="row" className="px-2 py-2 text-left font-normal">
              <span className="line-clamp-2 text-ink" title={p.nome ? p.nome : `item_id ${p.item_id}`}>{nomeProduto(p)}</span>
              <span className="text-xs text-ink-faint">
                {brandLabel(p.marca)} · {contagem(p.avaliacoes, p.truncado)} avaliações
                {p.truncado && <span className="sr-only"> (a contagem é um piso)</span>}
              </span>
            </th>
            <td className={`${TD} align-top font-semibold text-ink`}>{nota(p.nota_media).replace(" ★", "")}</td>
            <td className={`${TD} align-top`}>{pct(p.pct_1a3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
