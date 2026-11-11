"use client";

import { CircleDollarSign, Megaphone, Repeat, ShoppingBag } from "lucide-react";

import KpiTile from "@/components/ui/KpiTile";
import StateBlock from "@/components/ui/StateBlock";
import { valoresVelocidade, type LinhaVelocidade } from "@/lib/operacoes-cartoes";

/**
 * Um grupo por marca (titulo + 4 `KpiTile` gerenciais): GMV -> `gmv`, Ad Spend ->
 * `ads`, ROAS -> `roas`, Pedidos -> `pedidos`. A marca e' o titulo do grupo, nunca
 * cor de cartao. O tom do ROAS e' a regra que a tela ja' tinha. Informativos: a
 * fonte nao traz periodo anterior nem serie, entao sem pilula, "antes" ou grafico.
 */
export function GrupoVelocidade({ r, rotulo }: { r: LinhaVelocidade; rotulo: string }) {
  const v = valoresVelocidade(r);
  return (
    <section aria-label={`Velocidade ML: ${rotulo}`} className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
        {rotulo}
        {v.roas.baixo && (
          <span className="rounded-full bg-crit-soft px-2 py-0.5 text-xs font-semibold text-crit-ink">ROAS baixo</span>
        )}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <KpiTile variante="gerencial" identidade="gmv" icone={CircleDollarSign} rotulo="GMV 7d" valor={v.gmv} />
        <KpiTile variante="gerencial" identidade="ads" icone={Megaphone} rotulo="Ad Spend" valor={v.adSpend} />
        <KpiTile
          variante="gerencial"
          identidade="roas"
          icone={Repeat}
          rotulo="ROAS"
          valor={v.roas.texto}
          tom={v.roas.tom}
        />
        <KpiTile variante="gerencial" identidade="pedidos" icone={ShoppingBag} rotulo="Pedidos" valor={v.pedidos} />
      </div>
    </section>
  );
}

export function GrupoSemDados({ rotulo }: { rotulo: string }) {
  return (
    <section aria-label={`Velocidade ML: ${rotulo}`} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink-muted">{rotulo}</h3>
      <StateBlock tipo="vazio" titulo="Sem dados no período." />
    </section>
  );
}
