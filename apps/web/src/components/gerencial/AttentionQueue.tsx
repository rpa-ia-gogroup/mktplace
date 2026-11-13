"use client";

/**
 * Fila de atencao (Gate V2-1, Task J).
 *
 * Substitui integralmente o alerta hard-coded por marca que vivia no JSX da
 * Gerencial (`if (brand === "lescent")`) — regra de negocio embutida em markup.
 * Fonte unica: `/executive-summary`.
 *
 * Duas listas SEPARADAS por decisao estrutural do G1: risco comercial e aviso
 * de confianca no dado nunca compartilham lista, e um aviso de dado nunca
 * recebe severidade comercial "Critico" (o tipo `DataSeverity` nao tem esse
 * valor). Clicar abre a explicacao antes de navegar.
 *
 * O "Pulso do periodo" foi fundido aqui (13/11): os itens dele sao os mesmos
 * insights do /executive-summary, entao entram so' a saude do periodo (selo) e
 * o atalho para a visao agrupada. A lista mostra so' o que pede acao
 * (Critico/Atencao): os informativos de alta repetem "Maiores altas" e seguem
 * na visao agrupada. Os avisos de dado moram no selo de confianca do topo.
 */
import type { ExecutiveHealth } from "@/lib/api-client";
import { HEALTH_STATUS_LABEL, HEALTH_STATUS_TONE } from "@/lib/executive-summary";
import type { CommercialAttentionItem, CommercialSeverity } from "@/lib/gerencial/attention";

interface Props {
  commercial: CommercialAttentionItem[];
  commercialLoading: boolean;
  commercialError: boolean;
  onOpenCommercial: (item: CommercialAttentionItem) => void;
  /** Saude do periodo (ex-Pulso). */
  health: ExecutiveHealth | null;
  /** Ha `missing_data`: diz "Dados indisponíveis", nunca "Crítico". */
  dataUnavailable: boolean;
  /** Ha sinais para a visao agrupada (senao, sem atalho). */
  temSinais: boolean;
  onOpenAll: () => void;
  onRetry: () => void;
}

const SEVERITY_LABEL: Record<CommercialSeverity, string> = {
  critical: "Crítico",
  warning: "Atenção",
  info: "Informativo",
};

const SEVERITY_TONE: Record<CommercialSeverity, string> = {
  critical: "text-crit-ink bg-crit-soft border-crit/35",
  warning: "text-warn-ink bg-warn-soft border-warn/35",
  info: "text-ink-muted bg-raised border-line",
};

export default function AttentionQueue({
  commercial,
  commercialLoading,
  commercialError,
  onOpenCommercial,
  health,
  dataUnavailable,
  temSinais,
  onOpenAll,
  onRetry,
}: Props) {
  const comSaude = !commercialLoading && !commercialError;
  const acionaveis = commercial.filter((item) => item.severity !== "info");
  return (
    <section
      aria-labelledby="fila-heading"
      className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="fila-heading" className="text-sm font-semibold text-ink-muted">
            Fila de atenção
          </h2>
          {comSaude && (dataUnavailable ? (
            <span className="text-xs font-semibold rounded-lg px-2 py-1 shrink-0 text-ink-muted bg-raised border border-line">
              Dados indisponíveis
            </span>
          ) : health ? (
            <span className={`text-xs font-semibold rounded-lg px-2 py-1 shrink-0 ${HEALTH_STATUS_TONE[health.status]}`}>
              {HEALTH_STATUS_LABEL[health.status]}
            </span>
          ) : null)}
        </div>
        {comSaude && temSinais && (
          <button
            type="button"
            onClick={onOpenAll}
            aria-haspopup="dialog"
            className="inline-flex items-center min-h-11 text-xs font-semibold text-accent hover:underline self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            Ver todos os sinais do período
          </button>
        )}
      </div>

      {/* Lista 1 — atencoes comerciais */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Atenções comerciais
          </h3>
          {!commercialLoading && !commercialError && (
            <span className="text-xs text-ink-faint tabular-nums">{acionaveis.length}</span>
          )}
        </div>

        {commercialLoading ? (
          <div className="flex flex-col gap-2 animate-pulse" role="status" aria-busy="true">
            <span className="sr-only">Carregando atenções comerciais…</span>
            <div className="h-10 w-full bg-accent-soft rounded-xl" />
            <div className="h-10 w-full bg-accent-soft rounded-xl" />
          </div>
        ) : commercialError ? (
          <div className="bg-raised border border-line rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-ink-muted">
              Resumo executivo indisponível — não é possível listar as atenções comerciais do período.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-semibold text-ink-muted border border-line-strong rounded-lg px-3 min-h-11 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Tentar novamente
            </button>
          </div>
        ) : acionaveis.length === 0 ? (
          <p className="text-xs text-ink-faint">Sem atenções comerciais no período e filtros selecionados.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {acionaveis.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onOpenCommercial(item)}
                  aria-haspopup="dialog"
                  aria-label={`${item.title} — abrir explicação`}
                  className="w-full min-h-11 text-left flex items-start gap-2.5 rounded-xl px-2 -mx-2 py-2 hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
                >
                  <span
                    className={`text-xs font-semibold uppercase rounded border px-1.5 py-0.5 shrink-0 mt-0.5 ${SEVERITY_TONE[item.severity]}`}
                  >
                    {SEVERITY_LABEL[item.severity]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-ink leading-snug">{item.title}</span>
                    <span className="block text-xs text-ink-faint leading-snug">{item.description}</span>
                  </span>
                  <span aria-hidden="true" className="text-ink-faint shrink-0 mt-0.5">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

    </section>
  );
}
