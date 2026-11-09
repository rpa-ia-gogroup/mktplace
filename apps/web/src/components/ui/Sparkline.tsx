"use client";

import { useId } from "react";

import { suavizar, type TendenciaKpi } from "@/lib/gerencial/kpi-trend";

/**
 * Mini grafico da tendencia (extraido da KpiBand da Gerencial, mesmo markup).
 * Decorativo (`aria-hidden`): a leitura acessivel e' o texto da
 * `LinhaDeTendencia`, que diz a direcao e o recorte comparado.
 *
 * UX-VIDRO-3: linha de 2px na cor do KPI, area preenchida em degrade da mesma
 * cor ate' sumir na base e ponto final redondo com anel da superficie. Tudo em
 * `currentColor`, entao a paleta e' a do KPI (`text-kpi-*`) nos dois temas.
 */
export default function Sparkline({ pontos, tinta }: { pontos: number[]; tinta: string }) {
  // `useId` traz ":" e outros simbolos que quebrariam o `url(#...)` do SVG.
  const idDegrade = `kpi-area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const min = Math.min(...pontos);
  const max = Math.max(...pontos);
  const faixa = max - min;
  const passo = 100 / (pontos.length - 1);
  // Serie constante fica no MEIO: colada no chao ela parece "caiu para zero".
  const y = (v: number) => (faixa === 0 ? 16 : 28 - ((v - min) / faixa) * 24);
  const xy = pontos.map((v, i) => [i * passo, y(v)] as const);
  const linha = xy.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${yy.toFixed(2)}`).join(" ");
  const ultimoY = xy[xy.length - 1][1];
  // O ponto final e' um <span> SEPARADO, fora do `preserveAspectRatio="none"`
  // da linha: dentro dele o circulo esticaria junto com o grafico.
  return (
    <span className={`relative block h-9 w-full ${tinta}`}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" className="tc-revela absolute inset-0 h-full w-[calc(100%-5px)] overflow-visible">
        <defs>
          <linearGradient id={idDegrade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity={0.32} />
            <stop offset="1" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${linha} L100 32 L0 32 Z`} fill={`url(#${idDegrade})`} stroke="none" />
        <path
          d={linha}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute right-0 h-2 w-2 rounded-full bg-current ring-2 ring-surface animate-[tc-fade_240ms_var(--mov-ease)_700ms_both] motion-reduce:animate-none"
        style={{ top: `calc(${(ultimoY / 32) * 100}% - 4px)` }}
      />
    </span>
  );
}

/**
 * Tendencia como INDICATIVO: SO' o mini grafico, terminando num ponto -- o
 * formato da linha ja' diz se sobe ou desce. Nenhum texto no card; a conta
 * (ultimos 7 contra os 7 anteriores e o %) fica no `title` e no texto
 * `sr-only`, para quem quiser conferir.
 */
const DIRECAO_FALADA: Record<"up" | "down" | "flat", string> = {
  up: "tende a subir",
  down: "tende a descer",
  flat: "estável",
};

export function LinhaDeTendencia({ t, tinta }: { t: TendenciaKpi; tinta: string }) {
  const detalhe =
    t.variacaoPct != null ? `${t.rotulo}: ${t.variacaoPct >= 0 ? "+" : ""}${t.variacaoPct.toFixed(1)}%` : undefined;
  return (
    <span className="block w-24 shrink-0 min-[1440px]:w-28" title={detalhe}>
      <Sparkline pontos={suavizar(t.pontos)} tinta={tinta} />
      {t.direcao && <span className="sr-only">Tendência: {DIRECAO_FALADA[t.direcao]}.</span>}
    </span>
  );
}
