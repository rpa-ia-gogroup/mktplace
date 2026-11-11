import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

const SELECT_CLASS =
  "text-sm border border-line rounded-lg px-3 py-1.5 text-ink-muted bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent";

/**
 * Container padrao da barra de filtros das 3 abas de Produtos. Nao conhece
 * quais filtros existem em cada canal — cada aba decide o que renderizar
 * dentro (marca, status, velocidade, sinal, periodo/escopo, contador).
 */
export default function ProductFilterBar({ children }: Props) {
  return (
    <div className="px-6 py-4 border-b border-line flex items-center gap-3 flex-wrap">
      {children}
    </div>
  );
}

export function ProductSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={SELECT_CLASS} />;
}
