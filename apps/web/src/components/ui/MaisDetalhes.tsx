import type { ReactNode } from "react";

/**
 * IDENTIDADE-GERENCIAL — o "Mais detalhes" da Gerencial (app/page.tsx), com
 * as mesmas classes: profundidade sob demanda, fechado por padrao para a
 * primeira dobra responder sozinha. Nada some: so' sai da vista.
 */
export default function MaisDetalhes({
  titulo = "Mais detalhes",
  resumo,
  children,
  abertoInicial = false,
}: {
  titulo?: ReactNode;
  /** O que tem dentro, em ink-faint ao lado do titulo. */
  resumo?: ReactNode;
  children: ReactNode;
  abertoInicial?: boolean;
}) {
  return (
    <details open={abertoInicial || undefined} className="group rounded-xl border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span>
          {titulo}
          {resumo && <span className="ml-2 font-normal text-ink-faint">{resumo}</span>}
        </span>
        <span aria-hidden="true" className="text-ink-faint transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-4">{children}</div>
    </details>
  );
}
