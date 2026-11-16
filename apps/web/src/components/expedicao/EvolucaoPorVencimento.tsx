"use client";

/**
 * "Evolução por dia de vencimento" — barras da taxa de atraso por dia de
 * vencimento, comum aos canais da Expedição (antes so' no TikTok).
 *
 * Nao recalcula taxa: desenha o `rate` que a API publicou. Cada canal diz a
 * severidade do dia (`severidade`) e onde fica a linha de referencia (`linha`):
 * o TikTok le os selos da propria API; Shopee usa a meta/teto confirmados
 * (`META_TETO`). Dia sem taxa mostra "—", nunca 0.
 */

import type { ReactNode } from "react";

import Panel from "@/components/ui/Panel";
import {
  ROTULO_SEVERIDADE,
  VALOR_SEM_TAXA,
  alturaDaBarra,
  alturaDaMeta,
  formatarDiaCurto,
  formatarDiaLongo,
  formatarTaxa,
  serieTemDiaMedido,
  taxaMaxima,
  type Severidade,
} from "@/lib/expedicao-tiktok-contract";

export type DiaVencimento = { due_date: string; rate: number | null; is_mature: boolean };

/**
 * Severidade -> token. `parcial` continua HACHURADO de proposito: coorte
 * parcial nao pode parecer um resultado fechado, nem bom nem ruim.
 */
const COR_SEVERIDADE: Record<Severidade, string> = {
  ok: "bg-ok",
  fora_da_meta: "bg-warn",
  critico: "bg-crit",
  parcial:
    "bg-[repeating-linear-gradient(45deg,rgb(var(--tc-line-strong))_0px,rgb(var(--tc-line-strong))_4px,transparent_4px,transparent_8px)]",
};

export const TEXTO_SEVERIDADE: Record<Severidade, string> = {
  ok: "text-ok-ink",
  fora_da_meta: "text-warn-ink",
  critico: "text-crit-ink",
  parcial: "text-ink-faint",
};

function Grafico<D extends DiaVencimento>({
  dias,
  severidade,
  rotulos,
  linha,
  aoClicar,
  clicavel,
}: {
  dias: D[];
  severidade: (d: D) => Severidade;
  rotulos: Record<Severidade, string>;
  linha: { valor: number; rotulo: string };
  aoClicar?: (dia: string) => void;
  clicavel?: (dia: string) => boolean;
}) {
  const maximo = taxaMaxima(dias);
  const meta = alturaDaMeta(maximo, linha.valor);
  return (
    <div>
      {/* `items-stretch` e nao `items-end`: com `items-end` cada coluna e'
          dimensionada pelo CONTEUDO, o `flex-1` de dentro nao recebe altura e
          a barra desaparece. Ja aconteceu neste grafico. */}
      <div className="relative">
        {meta !== null ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-warn"
            style={{ bottom: `calc(${meta}% + 1.25rem)` }}
            aria-hidden="true"
          >
            <span className="absolute -top-4 right-0 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn-ink ring-1 ring-inset ring-warn/30">
              {linha.rotulo} {formatarTaxa(linha.valor, 0)}
            </span>
          </div>
        ) : null}
        <div
          className="flex h-56 items-stretch gap-1 overflow-x-auto pb-1"
          role={aoClicar ? "group" : "img"}
          aria-label={`Taxa por dia de vencimento.${aoClicar ? " Clique num dia para ver os pedidos vencidos." : ""} Máximo da série: ${formatarTaxa(
            maximo,
          )}. ${linha.rotulo}: ${formatarTaxa(linha.valor, 0)}.`}
        >
          {dias.map((d) => {
            const sev = severidade(d);
            const podeClicar = Boolean(aoClicar) && (clicavel?.(d.due_date) ?? true);
            const Coluna = podeClicar ? "button" : "div";
            return (
              <Coluna
                key={d.due_date}
                {...(podeClicar
                  ? {
                      type: "button" as const,
                      onClick: () => aoClicar?.(d.due_date),
                      "aria-label": `Ver os pedidos vencidos em ${formatarDiaLongo(d.due_date)} (${formatarTaxa(d.rate)})`,
                    }
                  : {})}
                className={`flex min-w-[34px] flex-1 flex-col items-center gap-1 ${
                  podeClicar
                    ? "cursor-pointer rounded-md hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    : ""
                }`}
              >
                <span
                  className={`text-xs tabular-nums ${d.rate === null ? "text-ink-faint" : TEXTO_SEVERIDADE[sev]}`}
                >
                  {d.rate === null ? VALOR_SEM_TAXA : formatarTaxa(d.rate, 1)}
                </span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t ${COR_SEVERIDADE[sev]}`}
                    style={{ height: `${alturaDaBarra(d, maximo)}%` }}
                    title={`${formatarDiaLongo(d.due_date)} · ${formatarTaxa(d.rate)}${
                      d.rate === null && d.is_mature ? "" : ` · ${rotulos[sev]}`
                    }`}
                  />
                </div>
                <span className="text-xs tabular-nums text-ink-faint">{formatarDiaCurto(d.due_date)}</span>
              </Coluna>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        {(["ok", "fora_da_meta", "critico", "parcial"] as Severidade[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COR_SEVERIDADE[s]}`} />
            {rotulos[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * O painel inteiro. Sem nenhum vencimento com taxa fechada o grafico seria um
 * retangulo sem barra: a tela diz por que nao ha o que desenhar (`vazio`).
 */
export default function EvolucaoPorVencimento<D extends DiaVencimento>({
  dias,
  severidade,
  rotulos = ROTULO_SEVERIDADE,
  linha,
  aoClicar,
  clicavel,
  vazio,
}: {
  dias: D[];
  severidade: (d: D) => Severidade;
  rotulos?: Record<Severidade, string>;
  linha: { valor: number; rotulo: string };
  /** Clicar na barra abre os vencidos do dia (so' onde ha lista por pedido). */
  aoClicar?: (dia: string) => void;
  clicavel?: (dia: string) => boolean;
  /** Complemento do aviso de serie sem taxa fechada. */
  vazio?: ReactNode;
}) {
  return (
    <Panel titulo="Evolução por dia de vencimento" className="h-full">
      {serieTemDiaMedido(dias) ? (
        <Grafico
          dias={dias}
          severidade={severidade}
          rotulos={rotulos}
          linha={linha}
          aoClicar={aoClicar}
          clicavel={clicavel}
        />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Nenhum vencimento da janela tem taxa fechada para desenhar.
          {vazio}
        </p>
      )}
    </Panel>
  );
}
