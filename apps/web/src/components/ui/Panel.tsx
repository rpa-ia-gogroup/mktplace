import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import InfoDica from "./InfoDica";

/**
 * UX-TORRE-1 — a unidade de superficie da Torre.
 *
 * Sem cartao dentro de cartao: um `Panel` contem dados, nunca outro `Panel`.
 * Aviso interno usa fundo tingido (`ok-soft`, `warn-soft`, `crit-soft`), nao
 * uma segunda moldura.
 */
export default function Panel({
  titulo,
  descricao,
  ajuda,
  acao,
  rodape,
  children,
  className = "",
  semPadding = false,
  icone: Icone,
  id,
  "aria-label": ariaLabel,
}: {
  titulo?: ReactNode;
  /** UX-TORRE-B2B-1 — icone de 16px antes do titulo. Opcional. */
  icone?: LucideIcon;
  /** Ancora de navegacao interna (`#id`), com `scroll-mt` da barra sticky. */
  id?: string;
  /** Uma linha, no maximo. Metodologia longa vai para um recolhivel. */
  descricao?: ReactNode;
  /** UI-FUNDACAO (F1): a metodologia do painel, num UNICO "ⓘ" colado ao titulo. */
  ajuda?: string;
  /** Acao do painel, sempre a' direita do titulo. */
  acao?: ReactNode;
  rodape?: ReactNode;
  children: ReactNode;
  className?: string;
  semPadding?: boolean;
  "aria-label"?: string;
}) {
  return (
    <section
      id={id}
      aria-label={ariaLabel}
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface ${id ? "scroll-mt-24" : ""} ${className}`}
    >
      {(titulo || acao) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-3.5">
          <div className="min-w-0">
            {titulo && (
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                {Icone && <Icone aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />}
                {titulo}
                {ajuda ? <InfoDica texto={ajuda} /> : null}
              </h3>
            )}
            {descricao && (
              <p className="mt-0.5 text-xs leading-snug text-ink-muted">{descricao}</p>
            )}
          </div>
          {acao && <div className="flex flex-wrap items-center gap-2">{acao}</div>}
        </div>
      )}
      <div className={semPadding ? "min-w-0" : "min-w-0 p-4"}>{children}</div>
      {rodape && (
        <div className="border-t border-line px-4 py-2 text-xs text-ink-muted">{rodape}</div>
      )}
    </section>
  );
}
