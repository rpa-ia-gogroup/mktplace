"use client";

import type { ReactNode } from "react";

import { fmtRefreshedAt } from "@/lib/filters/format";

interface Props {
  /** Texto opcional antes do período (ex: categoria do insight). */
  leading?: string | null;
  periodLabel: string;
  /** null = não exibe "Atualizado em" — nunca inventa timestamp. */
  refreshedAt: string | null;
  /**
   * O "ⓘ" da ressalva que muda a leitura do numero. Fica COLADO no ultimo selo: no celular
   * os dois quebram de linha juntos, em vez de o ⓘ cair sozinho numa linha de baixo.
   */
  dica?: ReactNode;
}

/**
 * Linha de contexto canônica dos conteúdos de drill-down (Gate G2, contrato
 * §3 de docs/DRILLDOWN_ARCHITECTURE.md): período + "Atualizado em" quando o
 * timestamp da resposta fresca existir. Substitui o markup repetido em
 * KpiDrilldownContent/ChannelComparisonDialogContent e preenche a lacuna do
 * InsightDrilldownContent (que não exibia refreshed_at).
 */
export default function DrilldownContextLine({ leading, periodLabel, refreshedAt, dica }: Props) {
  if (dica) {
    const periodo = <span className="rounded-full border border-line bg-raised px-2 py-0.5 tabular-nums">{periodLabel}</span>;
    const atualizado = refreshedAt ? (
      <span className="rounded-full border border-line px-2 py-0.5 tabular-nums">Atualizado {fmtRefreshedAt(refreshedAt)}</span>
    ) : null;
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        {leading && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-ink">{leading}</span>}
        {atualizado ? (
          <>
            {periodo}
            <span className="inline-flex items-center gap-1.5">{atualizado}{dica}</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">{periodo}{dica}</span>
        )}
      </p>
    );
  }
  return (
    // POPUPS-1 — contexto em selos, nao em frase: periodo e frescor de relance.
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
      {leading && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-ink">{leading}</span>}
      <span className="rounded-full border border-line bg-raised px-2 py-0.5 tabular-nums">{periodLabel}</span>
      {refreshedAt && (
        <span className="rounded-full border border-line px-2 py-0.5 tabular-nums">Atualizado {fmtRefreshedAt(refreshedAt)}</span>
      )}
    </p>
  );
}
