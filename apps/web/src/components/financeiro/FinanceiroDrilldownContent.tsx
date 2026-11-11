"use client";

import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import { gmvExato } from "@/lib/financeiro-cartoes";
import ListaDeCustos from "./ChannelCostPanel";
import type { PainelCanal } from "./FinanceiroCartoes";

/**
 * Detalhe do cartao de GMV de um canal: valor exato, periodo e frescor em selos e os
 * componentes de custo CONHECIDOS do canal (valor + % do GMV do proprio canal, em
 * escala real). Nada e' somado: os componentes vem de fontes e denominadores
 * diferentes e somar fecharia uma "margem" que esta tela nao tem. Componente que a
 * fonte nao entrega aparece como ausente, com o motivo, nunca como zero.
 */
export default function FinanceiroDrilldownContent({ painel, periodLabel, refreshedAt }: { painel: PainelCanal; periodLabel: string; refreshedAt: string | null }) {
  const exato = gmvExato(painel.gmv);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        {exato == null ? (
          <span className="text-[32px] font-bold leading-none tracking-tight text-ink-faint tabular-nums">—</span>
        ) : (
          <NumeroAnimado texto={exato} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
        )}
        <DrilldownContextLine leading="GMV" periodLabel={periodLabel} refreshedAt={refreshedAt} />
      </div>
      <DrilldownSecao titulo="Componentes conhecidos">
        <ListaDeCustos linhas={painel.linhas} barra={painel.ponto} />
      </DrilldownSecao>
    </div>
  );
}
