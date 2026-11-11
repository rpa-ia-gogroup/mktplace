"use client";

import type { CanaisBrandRow, CanaisKpis } from "@/lib/api-client";
import { KPI_CANAL, PONTO_DO_CANAL, linhasPorMarca, textoDoCartao, type KpiCanalChave } from "@/lib/canais-kpi-detalhe";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import InfoDica from "@/components/ui/InfoDica";
import NumeroAnimado from "@/components/ui/NumeroAnimado";

/**
 * Detalhe de um cartao de Canais, no molde do detalhe da Gerencial
 * (`KpiDrilldownContent`): valor grande, periodo e frescor em selos e a quebra
 * por marca em `EvidenceRow` (ponto do canal, barra). So' dados ja' carregados na
 * pagina; nada novo e' buscado. Marca sem valor aparece como "Sem dado", nunca 0.
 */
export default function KpiCanalDrilldownContent({
  chave,
  kpis,
  marcas,
  periodLabel,
  refreshedAt,
}: {
  chave: KpiCanalChave;
  kpis: CanaisKpis | null;
  marcas: CanaisBrandRow[];
  periodLabel: string;
  refreshedAt: string | null;
}) {
  const def = KPI_CANAL[chave];
  const texto = textoDoCartao(chave, kpis);
  const linhas = linhasPorMarca(chave, marcas);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
          {texto.ausente ? (
            <span className="text-[32px] font-bold leading-none tracking-tight text-ink-faint tabular-nums">—</span>
          ) : (
            <NumeroAnimado texto={texto.valor} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
          )}
          {texto.comparacao && <span className="pb-0.5 text-xs text-ink-faint tabular-nums">{texto.comparacao}</span>}
        </div>
        <DrilldownContextLine periodLabel={periodLabel} refreshedAt={refreshedAt} dica={def.dica ? <InfoDica texto={def.dica} /> : undefined} />
      </div>

      <DrilldownSecao titulo="Por marca" acao={<span className="tabular-nums">{linhas.length}</span>}>
        <ul className="flex flex-col">
          {linhas.map((l) => (
            <EvidenceRow
              key={l.brand}
              label={l.label}
              value={l.valor}
              ponto={PONTO_DO_CANAL[def.canal]}
              pct={l.pct}
              tone={l.ausente ? "muted" : "value"}
              mutedLabel={l.ausente}
            />
          ))}
        </ul>
      </DrilldownSecao>
    </div>
  );
}
