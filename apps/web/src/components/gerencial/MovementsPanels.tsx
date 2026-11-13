"use client";

/**
 * Maiores altas e quedas por marca (Gate V2-1, Task I).
 *
 * Dois paineis de alturas coordenadas (`h-full` dentro de uma grade sem
 * `items-start`; listas com `max-h` e rolagem interna). A Concentracao por
 * marca saiu no enxugamento do "Mais detalhes" (13/11).
 */
import type { Movement, Movements } from "@/lib/gerencial/brand-matrix";
import { MOVEMENT_FLOOR_NOTE } from "@/lib/gerencial/brand-matrix";
import { CHANNEL_LABEL } from "@/lib/gerencial/kpi-band";
import { fmtBrlFull } from "@/lib/formatters";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";

interface Props {
  movements: Movements;
  loading: boolean;
  error: boolean;
  onOpenMovement: (movement: Movement) => void;
  onRetry: () => void;
}

const PANEL = "h-full bg-surface border border-line rounded-xl p-4 flex flex-col gap-2";

function PanelSkeleton() {
  return (
    <div className={`${PANEL} animate-pulse`} role="status" aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <div className="h-3 w-28 bg-accent-soft rounded" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-7 w-full bg-accent-soft rounded" />
      ))}
    </div>
  );
}

function MovementList({
  title,
  items,
  emptyLabel,
  floorNote,
  onOpenMovement,
}: {
  title: string;
  items: Movement[];
  emptyLabel: string;
  floorNote: boolean;
  onOpenMovement: (movement: Movement) => void;
}) {
  const headingId = `mov-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className={PANEL}>
      <h3 id={headingId} className="text-sm font-semibold text-ink-muted">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink-faint">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
          {items.map((m) => {
            const up = m.deltaAbs > 0;
            return (
              <li key={`${m.brand}:${m.channel}`}>
                <button
                  type="button"
                  onClick={() => onOpenMovement(m)}
                  aria-haspopup="dialog"
                  aria-label={`${m.brandLabel} em ${CHANNEL_LABEL[m.channel]} — abrir detalhe da variação`}
                  className="w-full min-h-11 text-left rounded-lg px-2 -mx-2 py-1 hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        aria-hidden="true"
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${CHANNEL_DOT[m.channel]}`}
                      />
                      <span className="text-xs font-medium text-ink-muted truncate">{m.brandLabel}</span>
                    </span>
                    <span
                      className={`text-xs font-semibold tabular-nums shrink-0 ${
                        up ? "text-ok-ink" : "text-crit-ink"
                      }`}
                    >
                      {up ? "+" : "−"}
                      {fmtBrlFull(Math.abs(m.deltaAbs))}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-xs text-ink-faint tabular-nums">
                    <span>{CHANNEL_LABEL[m.channel]}</span>
                    {/* Percentual e' CONTEXTO; a ordenacao usa o absoluto. */}
                    <span>
                      {m.deltaPct != null ? `${up ? "▲" : "▼"} ${Math.abs(m.deltaPct).toFixed(1)}%` : "% n/d"} · antes{" "}
                      {fmtBrlFull(m.previous)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {floorNote && <p className="mt-auto pt-1 text-xs text-ink-faint">{MOVEMENT_FLOOR_NOTE}</p>}
    </section>
  );
}

export default function MovementsPanels({
  movements,
  loading,
  error,
  onOpenMovement,
  onRetry,
}: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <section className="bg-raised border border-line rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink-muted">Maiores altas e quedas</h2>
          <p className="text-xs text-ink-faint">
            Desempenho por marca indisponível nesta carga — sem base para calcular as variações.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-ink-muted border border-line-strong rounded-lg px-3 min-h-11 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Tentar novamente
        </button>
      </section>
    );
  }

  const floorNote = movements.excludedByFloor > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <MovementList
        title="Maiores altas"
        items={movements.gains}
        emptyLabel="Nenhuma alta com base anterior suficiente no período."
        floorNote={floorNote}
        onOpenMovement={onOpenMovement}
      />
      <MovementList
        title="Maiores quedas"
        items={movements.drops}
        emptyLabel="Nenhuma queda com base anterior suficiente no período."
        floorNote={floorNote}
        onOpenMovement={onOpenMovement}
      />
    </div>
  );
}
