"use client";

import type { LucideIcon } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";

import NumeroAnimado from "./NumeroAnimado";

/**
 * ALVO-GRADE (aprovado em 12/11/2026) — o cartao de indicador UNICO das abas.
 *
 * Sempre a mesma anatomia, de cima para baixo: rotulo com o icone em caixinha,
 * numero, uma linha de apoio (pilula + barra de progresso + legenda curta) e a
 * linha de tendencia com area, de ponta a ponta. A cor de identidade (`cor`)
 * pinta o degrade do fundo, a borda, a caixinha, a barra e a linha; bom/ruim
 * fica so' na pilula. Tendencia nunca e' inventada: sem serie real o cartao
 * so' reserva o espaco da linha quando OUTRO cartao da mesma faixa tem linha ou
 * rodape (para alinhar); faixa sem nenhum apoio nao fica com cartoes ocos. A
 * regra e' CSS (`.tc-cartao-reserva`) e vale para cartoes IRMAOS, filhos
 * diretos do mesmo container.
 */
export type TomPilula = "ok" | "crit" | "warn" | "neutro";

const PILULA: Record<TomPilula, string> = {
  ok: "bg-ok-soft text-ok-ink",
  crit: "bg-crit-soft text-crit-ink",
  warn: "bg-warn-soft text-warn-ink",
  neutro: "bg-raised text-ink-muted",
};

export default function CartaoIndicador({
  rotulo,
  icone: Icone,
  cor,
  valor,
  pilula,
  progresso,
  legenda,
  serie,
  rodape,
  tendencia,
  ajuda,
  onAbrir,
}: {
  rotulo: string;
  icone: LucideIcon;
  /** Cor de identidade do indicador (CSS). */
  cor: string;
  /** Valor ja' formatado; `null` = indisponivel (a legenda diz o motivo). */
  valor: string | null;
  pilula?: { texto: ReactNode; tom: TomPilula } | null;
  /** 0..1 (passa de 1 quando supera a meta; a barra enche e para). */
  progresso?: number | null;
  legenda?: ReactNode;
  /** Pontos do periodo, na ordem. Linha so' com 4 ou mais pontos reais. */
  serie?: number[] | null;
  /** O que a linha diz, em texto ("Tendência: tende a subir (…)"): vai para o leitor de tela e o title. */
  tendencia?: string | null;
  /** Sem serie real: o que ocupa o lugar da linha (ex.: o indicador aberto por canal). Nunca um grafico inventado. */
  rodape?: ReactNode;
  /** `InfoDica emControle` ao lado do rotulo. */
  ajuda?: ReactNode;
  onAbrir?: () => void;
}) {
  const id = `cartao-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const pontos = serie && serie.length >= 4 ? serie : null;
  let linha = "";
  if (pontos) {
    const min = Math.min(...pontos);
    const faixa = Math.max(...pontos) - min;
    linha = pontos
      .map((v, i) => `${i ? "L" : "M"}${((i / (pontos.length - 1)) * 100).toFixed(1)} ${(faixa === 0 ? 22 : 36 - ((v - min) / faixa) * 28).toFixed(1)}`)
      .join(" ");
  }
  const corpo = (
    <>
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        <span aria-hidden="true" className="tc-cartao-icone flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
          <Icone className="h-3 w-3" strokeWidth={2.25} />
        </span>
        <span className="min-w-0 truncate">{rotulo}</span>
        {ajuda}
        {onAbrir && <span className="sr-only"> (abrir detalhe)</span>}
      </span>
      <span className={`mt-2 block text-[28px] font-bold leading-tight tracking-tight tabular-nums ${valor ? "text-ink" : "text-ink-faint"}`}>
        {valor ? <NumeroAnimado texto={valor} /> : "N/D"}
      </span>
      <span className="mt-1.5 flex min-h-[22px] flex-wrap items-center gap-2 text-xs text-ink-muted">
        {pilula && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold tabular-nums whitespace-nowrap ${PILULA[pilula.tom]}`}>
            {pilula.texto}
          </span>
        )}
        {progresso != null && (
          <span className="tc-cartao-prog h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full" aria-hidden="true">
            <span className="tc-barra block h-full rounded-full" style={{ width: `${Math.min(progresso, 1) * 100}%`, background: "var(--h)" }} />
          </span>
        )}
        {legenda && <span className="min-w-0">{legenda}</span>}
      </span>
      {pontos && tendencia ? <span className="sr-only">{tendencia}</span> : null}
      {pontos ? (
        <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true" className="tc-cartao-apoio -mx-4 mt-2 block h-11 w-[calc(100%+2rem)]">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--h)" stopOpacity={0.32} />
              <stop offset="1" stopColor="var(--h)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${linha} L100 44 L0 44 Z`} fill={`url(#${id})`} className="tc-cartao-area" />
          <path d={linha} className="tc-cartao-linha" fill="none" stroke="var(--h)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : rodape ? (
        <span className="tc-cartao-apoio mt-2 block min-h-11 text-xs text-ink-muted">{rodape}</span>
      ) : (
        <span aria-hidden="true" className="tc-cartao-reserva mt-2 h-11" />
      )}
    </>
  );
  const classe = "tc-cartao flex h-full w-full min-w-0 flex-col px-4 pt-3.5 text-left";
  const estilo = { "--h": cor } as CSSProperties;
  return onAbrir ? (
    <button type="button" onClick={onAbrir} aria-haspopup="dialog" style={estilo} className={`${classe} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}>
      {corpo}
    </button>
  ) : (
    <div style={estilo} className={classe}>
      {corpo}
    </div>
  );
}
