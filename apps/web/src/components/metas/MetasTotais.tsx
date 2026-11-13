"use client";

import { Store, Target } from "lucide-react";

import CartaoIndicador from "@/components/ui/CartaoIndicador";
import { CANAIS, type Totais } from "@/lib/metas";
import { cartoesMetas } from "@/lib/metas-cartoes";

/** Cor de identidade: violeta para o global; em cada canal, a cor do proprio canal. */
const COR = {
  global: "rgb(var(--tc-kpi-gmv))",
  tiktok: "rgb(var(--tc-canal-tiktok))",
  ml: "rgb(var(--tc-canal-ml))",
  shopee: "rgb(var(--tc-canal-shopee))",
} as const;

/**
 * Totais da grade na faixa de 4 cartoes iguais (`CartaoIndicador`). Em cada
 * canal, a barra e' a parte dele na meta global. Informativos: a tela e' um
 * formulario e o total acompanha o rascunho, como o rodape da grade.
 */
export default function MetasTotais({ totais }: { totais: Totais }) {
  // Sem nenhuma meta no mes a faixa seria so' "—": a Note da pagina ja' diz isso.
  if (totais.global == null) return null;
  const cartoes = cartoesMetas(totais);
  return (
    <section aria-label="Totais das metas" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
      {cartoes.map((c) => {
        const canal = CANAIS.find((x) => x.id === c.chave);
        const v = canal ? totais.porCanal[canal.id] : null;
        return (
          <CartaoIndicador
            key={c.chave}
            rotulo={canal ? canal.label : "Meta global"}
            icone={canal ? Store : Target}
            cor={COR[c.chave]}
            valor={c.ausente ? "—" : c.valor}
            ausente={c.ausente}
            progresso={canal && v != null && totais.global ? v / totais.global : null}
            legenda={c.chave === "global" ? "Soma dos canais" : c.comparacao ?? undefined}
          />
        );
      })}
    </section>
  );
}
