"use client";

import { Check } from "lucide-react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

import Popover from "@/components/ui/Popover";

/**
 * Container padrao da barra de filtros das 3 abas de Produtos. Nao conhece
 * quais filtros existem em cada canal — cada aba decide o que renderizar
 * dentro (marca, status, velocidade, sinal, periodo/escopo, contador).
 */
export default function ProductFilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

const BTN =
  "inline-flex w-full items-center justify-between gap-2 min-h-11 px-3 rounded-md text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

/**
 * ALVO-GRADE: o filtro de escolha unica de Produtos no MESMO dropdown em pilula
 * da barra das outras abas (`Popover`, como a Marca). Mesma assinatura do
 * antigo `<select>`: `value`, `onChange(e)` com `e.target.value` e as opcoes
 * como `<option value>`; vazio = sem filtro (o gatilho nao fica realcado).
 */
export function ProductSelect({
  value,
  onChange,
  "aria-label": rotulo,
  children,
}: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  "aria-label": string;
  children: ReactNode;
}) {
  const opcoes = Children.toArray(children)
    .filter((o): o is ReactElement<{ value?: string; children?: ReactNode }> => isValidElement(o))
    .map((o) => ({ valor: String(o.props.value ?? ""), texto: o.props.children }));
  const atual = opcoes.find((o) => o.valor === value) ?? opcoes[0];
  return (
    <Popover rotulo={rotulo} rotuloSoNoLargo valor={atual?.texto} ativo={value !== ""} largura="w-64">
      {(fechar) => (
        <div role="group" aria-label={rotulo} className="flex flex-col gap-0.5">
          {opcoes.map((o) => {
            const on = o.valor === value;
            return (
              <button
                key={o.valor || "todos"}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onChange({ target: { value: o.valor } });
                  fechar();
                }}
                className={`${BTN} ${on ? "bg-surface font-semibold text-ink shadow-sm ring-1 ring-inset ring-line-strong" : "text-ink-muted hover:bg-surface/70 hover:text-ink"}`}
              >
                {o.texto}
                {on && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
