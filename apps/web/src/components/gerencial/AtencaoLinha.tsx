import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Faixa "Atenção" da aba padrao: UMA linha com o item mais urgente e a porta
 * para a lista inteira. Sem item, a pagina nao monta a faixa.
 */
const TOM = {
  critico: { rotulo: "Crítico", classe: "bg-crit-soft text-crit-ink" },
  atencao: { rotulo: "Atenção", classe: "bg-warn-soft text-warn-ink" },
} as const;

export default function AtencaoLinha({
  severidade,
  children,
  href,
  outros = 0,
  onVerTodos,
}: {
  severidade: keyof typeof TOM;
  children: ReactNode;
  /** Destino do item mostrado (a marca, a aba de origem). */
  href?: string;
  /** Quantos itens alem deste a lista tem. */
  outros?: number;
  onVerTodos: () => void;
}) {
  const texto = <span className="min-w-0 text-sm text-ink">{children}</span>;
  return (
    <section
      aria-label="O que exige atenção"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-4 py-1.5"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TOM[severidade].classe}`}>{TOM[severidade].rotulo}</span>
        {href ? (
          <Link href={href} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {texto}
          </Link>
        ) : (
          texto
        )}
        {outros > 0 && <span className="text-xs text-ink-faint tabular-nums">+{outros}</span>}
      </p>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onVerTodos}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Ver todos →
      </button>
    </section>
  );
}
