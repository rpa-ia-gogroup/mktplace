"use client";

import { Store, Target } from "lucide-react";

import KpiTile from "@/components/ui/KpiTile";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import { CANAIS, type Totais } from "@/lib/metas";
import { cartoesMetas } from "@/lib/metas-cartoes";

/**
 * Totais da grade no padrao da Gerencial (`KpiTile` gerencial, identidade `gmv`).
 * O canal e' so' o ponto no rotulo, nunca cor de cartao. Informativos: a tela e'
 * um formulario e o total acompanha o rascunho, como o rodape da grade.
 */
export default function MetasTotais({ totais, rotuloMes }: { totais: Totais; rotuloMes: string }) {
  const cartoes = cartoesMetas(totais);
  return (
    <section aria-label="Totais das metas" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cartoes.map((c) => {
        const canal = CANAIS.find((x) => x.id === c.chave);
        return (
          <KpiTile
            key={c.chave}
            variante="gerencial"
            identidade="gmv"
            icone={canal ? Store : Target}
            rotulo={
              canal ? (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CHANNEL_DOT[canal.id]}`} />
                  {canal.label}
                </span>
              ) : (
                "Meta global"
              )
            }
            valor={c.ausente ? "—" : c.valor}
            tom={c.ausente ? "ausente" : "neutro"}
            comparacao={c.chave === "global" && !c.ausente ? rotuloMes : c.comparacao ?? undefined}
          />
        );
      })}
    </section>
  );
}
