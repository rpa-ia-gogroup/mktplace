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
 * insights do /executive-summary ja' listados abaixo, entao entram so' a saude
 * do periodo (selo + resumo) no cabecalho e o atalho para a visao agrupada.
 */
import type { ExecutiveHealth } from "@/lib/api-client";
import { HEALTH_STATUS_LABEL, HEALTH_STATUS_TONE } from "@/lib/executive-summary";
import type {
  CommercialAttentionItem,
  CommercialSeverity,
  DataConfidenceItem,
  DataSeverity,
} from "@/lib/gerencial/attention";

interface Props {
  commercial: CommercialAttentionItem[];
  dataConfidence: DataConfidenceItem[];
  commercialLoading: boolean;
  commercialError: boolean;
  onOpenCommercial: (item: CommercialAttentionItem) => void;
  onOpenDataWarning: (item: DataConfidenceItem) => void;
  /** Saude do periodo (ex-Pulso). */
  health: ExecutiveHealth | null;
  /** Ha `missing_data`: diz "Dados indisponíveis", nunca "Crítico". */
  dataUnavailable: boolean;
  /** Quantos grupos a visao agrupada mostra (0 = sem atalho). */
  groupedCount: number;
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

/** Escala PROPRIA dos avisos de dado — deliberadamente sem "Critico". */
const DATA_LABEL: Record<DataSeverity, string> = {
  attention: "Verificar",
  note: "Nota",
};

const DATA_TONE: Record<DataSeverity, string> = {
  attention: "text-warn-ink bg-warn-soft border-warn/35",
  note: "text-ink-muted bg-raised border-line",
};

export default function AttentionQueue({
  commercial,
  dataConfidence,
  commercialLoading,
  commercialError,
  onOpenCommercial,
  onOpenDataWarning,
  health,
  dataUnavailable,
  groupedCount,
  onOpenAll,
  onRetry,
}: Props) {
  const comSaude = !commercialLoading && !commercialError;
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
        {comSaude && health?.summary && <p className="text-xs text-ink-muted leading-snug">{health.summary}</p>}
        {comSaude && groupedCount > 0 && (
          <button
            type="button"
            onClick={onOpenAll}
            aria-haspopup="dialog"
            className="inline-flex items-center min-h-11 text-xs font-semibold text-accent hover:underline self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            Ver sinais agrupados ({groupedCount})
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
            <span className="text-xs text-ink-faint tabular-nums">{commercial.length}</span>
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
        ) : commercial.length === 0 ? (
          <p className="text-xs text-ink-faint">Sem atenções comerciais no período e filtros selecionados.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {commercial.map((item) => (
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

      {/* Lista 2 — confianca no dado, com estado proprio e escala propria */}
      <div className="flex flex-col gap-2 pt-3 border-t border-line">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Confiança no dado
          </h3>
          {!commercialLoading && (
            <span className="text-xs text-ink-faint tabular-nums">{dataConfidence.length}</span>
          )}
        </div>

        {commercialLoading ? (
          <div className="h-10 w-full bg-accent-soft rounded-xl animate-pulse" role="status" aria-busy="true">
            <span className="sr-only">Carregando avisos de confiança…</span>
          </div>
        ) : dataConfidence.length === 0 ? (
          <p className="text-xs text-ink-faint">
            {commercialError
              ? "Não foi possível verificar avisos de confiança nesta carga."
              : "Nenhum aviso de confiança no dado neste período."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dataConfidence.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onOpenDataWarning(item)}
                  aria-haspopup="dialog"
                  aria-label={`${item.message} — abrir explicação`}
                  className="w-full min-h-11 text-left flex items-start gap-2.5 rounded-xl px-2 -mx-2 py-2 hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
                >
                  <span
                    className={`text-xs font-semibold uppercase rounded border px-1.5 py-0.5 shrink-0 mt-0.5 ${DATA_TONE[item.severity]}`}
                  >
                    {DATA_LABEL[item.severity]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-ink-muted leading-snug">{item.message}</span>
                    {(item.source || item.lastDate || item.stalenessDays != null) && (
                      // `overflow-wrap:anywhere`: o nome da tabela-fonte nao
                      // tem ponto de quebra e vazava do cartao no mobile.
                      <span className="block text-xs text-ink-faint tabular-nums [overflow-wrap:anywhere]">
                        {item.source && <>fonte {item.source}</>}
                        {item.lastDate && <> · até {item.lastDate}</>}
                        {item.stalenessDays != null && <> · defasagem {item.stalenessDays}d</>}
                      </span>
                    )}
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
