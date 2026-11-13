"use client";

/**
 * Blocos da visao das marcas menores (Bling): topo consolidado com rosca, linha por marca com a
 * serie diaria e produtos. Usados pela aba Marcas menores e pela Gerencial (filtro de marca).
 */
import { useState } from "react";
import dynamic from "next/dynamic";

import { CircleDollarSign, Store } from "lucide-react";

import CartaoIndicador from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";
import StateBlock from "@/components/ui/StateBlock";
import { fmtNumber, fmtPctBr } from "@/lib/formatters";
import {
  corDaPlataforma,
  fatias,
  nomeDaPlataforma,
  variacaoConsolidada,
  variacaoDaMarca,
  type Consolidado,
  type MarcaMenor,
  type ProdutosMarcas,
} from "@/lib/marcas-menores";
import { fmtCompacto } from "@/lib/metas";

const SerieDiaria = dynamic(() => import("./SerieDiaria"), { ssr: false, loading: () => <div className="h-36" aria-hidden="true" /> });

export const FONTE_PRODUTOS =
  "Origem: itens dos pedidos do Bling. Quantidade e receita por produto (valor × quantidade − desconto do item), sem cancelados. A Denavita aguarda autorização da conta. Os itens são lidos pedido a pedido: a tabela pode vir parcial e se completa sozinha.";

/** "▲ 12%" contra o período anterior; sem base, nada; com `motivo` (canal sem base no anterior), "—" e o aviso. */
export function Variacao({ pct, motivo = null }: { pct: number | null; motivo?: string | null }) {
  if (pct == null) {
    if (!motivo) return null;
    return (
      <span className="text-ink-muted" title={`Sem variação: ${motivo}`}>
        — <span className="font-semibold text-warn-ink">{motivo}</span>
      </span>
    );
  }
  return (
    <span className={`font-semibold ${pct >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>
      {pct >= 0 ? "▲" : "▼"} {fmtPctBr(Math.abs(pct)).replace("+", "")}
    </span>
  );
}

/** Receita consolidada das 4 marcas + rosca por canal (o mesmo desenho da Gerencial, sem meta). */
export function Topo({
  c,
  marcas,
  emAndamento,
  titulo = "Receita das marcas",
  semMeta = false,
}: {
  c: Consolidado;
  marcas: MarcaMenor[];
  emAndamento: boolean;
  titulo?: string;
  /** "sem meta" visivel no topo (Gerencial): estas marcas nao tem meta. */
  semMeta?: boolean;
}) {
  const total = c.total;
  const partes = c.por_plataforma.filter((p) => p.faturamento > 0);
  const pct = (x: number) => Math.round(x * 100);
  // Parcial: marca sem dado fica de fora da soma e o topo diz isso (nunca soma ausencia como 0).
  const comDado = marcas.filter((m) => m.total != null).length;
  const parcial = comDado < marcas.length;
  // Variacao so' sobre as marcas que tem base nos dois periodos, e so' se todo canal delas tem base no anterior.
  const vc = emAndamento ? { pct: null, motivo: null } : variacaoConsolidada(marcas);
  const v = vc.pct;
  // Faixa de cartoes iguais: a receita e, ao lado, um cartao por plataforma com a parte dela (barra).
  const colunas = ["", "", "min-[480px]:grid-cols-2", "min-[480px]:grid-cols-2 xl:grid-cols-3", "min-[480px]:grid-cols-2 xl:grid-cols-4"][Math.min(partes.length + 1, 4)];
  return (
    <section aria-label="Receita consolidada" className={`grid grid-cols-1 gap-3 ${colunas}`}>
      <CartaoIndicador
        rotulo={titulo}
        icone={CircleDollarSign}
        cor="rgb(var(--tc-kpi-gmv))"
        valor={total == null ? "—" : fmtCompacto(total)}
        pilula={v != null ? { texto: `${fmtPctBr(v)} vs anterior`, tom: v >= 0 ? "ok" : "crit" } : semMeta ? { texto: "sem meta", tom: "neutro" } : null}
        legenda={
          v == null && vc.motivo != null ? (
            <Variacao pct={null} motivo={vc.motivo} />
          ) : parcial ? (
            <span className="font-semibold text-warn-ink">parcial (sem {marcas.filter((m) => m.total == null).map((m) => m.label).join(", ")})</span>
          ) : emAndamento ? (
            "inclui hoje, dia em andamento"
          ) : null
        }
      />
      {total != null &&
        partes.slice(0, 3).map((p) => (
          <CartaoIndicador
            key={p.plataforma}
            rotulo={nomeDaPlataforma(p.plataforma)}
            icone={Store}
            cor={corDaPlataforma(p.plataforma)}
            valor={fmtCompacto(p.faturamento)}
            progresso={total > 0 ? p.faturamento / total : null}
            legenda={`${pct(p.faturamento / total)}% da receita`}
          />
        ))}
    </section>
  );
}

/** Bloco de marcas no padrão da Gerencial: linha por marca (barra por canal, total, variação) e a série diária. */
export function Marcas({ marcas, emAndamento, semMeta = false }: { marcas: MarcaMenor[]; emAndamento: boolean; semMeta?: boolean }) {
  const escala = Math.max(1, ...marcas.map((m) => m.total ?? 0));
  return (
    <section aria-labelledby="mm-marcas" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="mm-marcas" className="mb-3 text-sm font-semibold text-ink">
        Marcas
      </h2>
      <ul className="flex flex-col">
        {marcas.map((m) => {
          const partes = fatias(m);
          const v = emAndamento ? { pct: null, motivo: null } : variacaoDaMarca(m);
          return (
            <li key={m.id} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
              <div className="grid min-h-11 grid-cols-[88px_1fr_auto] items-center gap-3">
                <span className="truncate text-sm font-semibold text-ink">{m.label}</span>
                {m.total == null ? (
                  <span className="text-xs text-ink-muted">
                    {m.status === "aguardando_autorizacao" ? "Aguardando autorização." : "Sem dado no período."}
                  </span>
                ) : (
                  <span className="relative h-2.5 rounded-full bg-raised" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: `${(m.total / escala) * 100}%` }}>
                      {partes.map((p) => (
                        <span key={p.plataforma} style={{ flex: p.frac, background: corDaPlataforma(p.plataforma) }} />
                      ))}
                    </span>
                  </span>
                )}
                <span className="flex flex-col items-end text-right tabular-nums">
                  <span className="text-sm font-semibold text-ink">{m.total == null ? "—" : fmtCompacto(m.total)}</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    {semMeta && <span className="rounded bg-raised px-1.5 font-semibold text-ink-muted">sem meta</span>}
                    <Variacao pct={v.pct} motivo={v.motivo} />
                  </span>
                </span>
              </div>
              {m.total != null && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-1 text-xs text-ink-muted tabular-nums">
                  {m.por_plataforma.map((p, i) => (
                    <li key={p.plataforma} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: corDaPlataforma(p.plataforma) }} aria-hidden="true" />
                      <b className="font-semibold text-ink">{Math.round(partes[i].frac * 100)}%</b>
                      {nomeDaPlataforma(p.plataforma)}
                      <span>{fmtCompacto(p.faturamento)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* Um dia só: a barra repetiria a lista acima. */}
              {m.serie.length > 1 && <SerieDiaria marca={m} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const LINHAS_VISIVEIS = 10;

/** Produto, quantidade e receita por marca (itens dos pedidos). Sem item = "sem dado", nunca 0. */
export function Produtos({
  r,
  desistiu,
  onTentar,
  titulo = "Produtos",
  ids,
}: {
  r: ProdutosMarcas | null | undefined;
  desistiu: boolean;
  onTentar: () => void;
  titulo?: string;
  /** So' estas marcas (filtro de marca da Gerencial); sem lista, todas as que tem dado. */
  ids?: readonly string[];
}) {
  return (
    <section aria-labelledby="mm-produtos" className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id="mm-produtos" className="text-sm font-semibold text-ink">
          {titulo}
        </h2>
        <InfoDica texto={FONTE_PRODUTOS} />
        {r?.disponivel && !r.completo && (
          <span className="flex items-center gap-2 text-xs font-semibold text-warn-ink">
            {desistiu ? "leitura parcial" : "lendo os itens"}: {r.pedidos_lidos} de {r.pedidos_total} pedidos
            {desistiu && (
              <button type="button" onClick={onTentar} className="min-h-11 rounded px-2 text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                Tentar de novo
              </button>
            )}
          </span>
        )}
      </div>
      {r === undefined ? (
        <StateBlock tipo="carregando" titulo="Carregando os produtos" compacto />
      ) : r === null || !r.disponivel ? (
        <StateBlock tipo="indisponivel" titulo="Produtos indisponíveis" descricao={r?.motivo ?? undefined} compacto />
      ) : (
        <ul className="flex flex-col gap-4">
          {r.marcas.filter((m) => m.status !== "aguardando_autorizacao" && (!ids || ids.includes(m.id))).map((m) => (
            <li key={m.id}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{m.label}</h3>
              <TabelaProdutos m={m} lendo={!r.completo && !desistiu} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TabelaProdutos({ m, lendo }: { m: ProdutosMarcas["marcas"][number]; lendo: boolean }) {
  const [todos, setTodos] = useState(false);
  const linhas = m.produtos;
  const visiveis = todos ? linhas : linhas.slice(0, LINHAS_VISIVEIS);
  if (linhas.length === 0) {
    return <p className="text-sm text-ink-muted">{lendo ? "Lendo os itens…" : "Sem dado por produto no período."}</p>;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-faint">
              <th scope="col" className="py-1.5 pr-3 font-semibold">Produto</th>
              <th scope="col" className="px-3 py-1.5 text-right font-semibold">Qtd.</th>
              <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Receita</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {visiveis.map((p) => (
              <tr key={p.sku} className="border-t border-line">
                <td className="max-w-[9rem] py-2 pr-3 text-ink sm:max-w-md" title={p.produto}><span className="line-clamp-2">{p.produto}</span></td>
                <td className="px-3 py-2 text-right text-ink-muted">{p.quantidade == null ? "—" : fmtNumber(p.quantidade)}</td>
                <td className="py-2 pl-3 text-right font-semibold text-ink">{p.receita == null ? "—" : fmtCompacto(p.receita)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length > LINHAS_VISIVEIS && (
        <button
          type="button"
          onClick={() => setTodos((v) => !v)}
          className="mt-1 min-h-11 text-xs font-semibold text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {todos ? "Ver menos" : `Ver todos (${linhas.length})`}
        </button>
      )}
    </>
  );
}

/**
 * Esqueleto da visao das marcas menores: o layout aparece na hora e cada bloco se preenche quando
 * o Bling responde. Nada de tela inteira bloqueada num "Carregando".
 */
export function EsqueletoMarcasMenores() {
  const bloco = "animate-pulse rounded-xl border border-line bg-surface motion-reduce:animate-none";
  return (
    <div role="status" aria-busy="true" aria-label="Carregando as demais marcas" className="flex flex-col gap-3">
      <div className={`${bloco} h-28`} />
      <div className={`${bloco} h-64`} />
      <div className={`${bloco} h-40`} />
    </div>
  );
}
