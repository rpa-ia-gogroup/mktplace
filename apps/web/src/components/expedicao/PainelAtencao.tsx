"use client";

import { useState, type ReactNode } from "react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import FilaAtencao, { type ItemAtencao } from "@/components/ui/FilaAtencao";
import Panel from "@/components/ui/Panel";

/** Itens de "O que exige atenção" visiveis no painel; o resto abre em "Ver todos". */
const ATENCAO_NO_PAINEL = 4;

/**
 * ALVO-GRADE — o painel "O que exige atenção", ao lado da fila por situacao de
 * prazo: ate' quatro itens e "Ver todos (n)" no canto, como na CX. Os itens
 * continuam vindo do contrato de cada canal.
 */
export default function PainelAtencao({ itens, vazio }: { itens: ItemAtencao[]; vazio: ReactNode }) {
  const [todos, setTodos] = useState(false);
  return (
    <Panel
      titulo="O que exige atenção"
      aria-label="O que exige atenção"
      className="h-full"
      acao={
        itens.length > ATENCAO_NO_PAINEL ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setTodos(true)}
            className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver todos ({itens.length}) →
          </button>
        ) : undefined
      }
    >
      <FilaAtencao semMoldura itens={itens.slice(0, ATENCAO_NO_PAINEL)} vazio={vazio} />
      <KpiDrilldownDialog open={todos} onClose={() => setTodos(false)} title="O que exige atenção">
        {/* abrir um item fecha a lista: um dialogo por vez */}
        <FilaAtencao
          semMoldura
          itens={itens.map((x) => (x.onAbrir ? { ...x, onAbrir: () => { setTodos(false); x.onAbrir?.(); } } : x))}
          vazio={vazio}
        />
      </KpiDrilldownDialog>
    </Panel>
  );
}
