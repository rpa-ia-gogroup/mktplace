import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

// ALVO-GRADE: o seletor em pilula da barra de filtros (token do tema: claro e escuro).
const SELECT_CLASS =
  "min-h-11 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
