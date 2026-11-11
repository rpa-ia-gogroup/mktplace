"use client";

import type { QualityBrandRow, QualityKpis } from "@/lib/api-client";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import { DEF_QUALIDADE, linhasPorMarca, textoDoCartao, type ChaveQualidade } from "@/lib/qualidade-cartoes";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import InfoDica from "@/components/ui/InfoDica";
import NumeroAnimado from "@/components/ui/NumeroAnimado";

/**
 * Detalhe de um cartao de Qualidade, no molde do detalhe da Gerencial: valor,
 * periodo e frescor em selos, ⓘ so' onde a ressalva muda a leitura, e a quebra por
 * marca em `EvidenceRow` (ponto do canal, barra). So' dados ja' carregados; marca
 * sem valor aparece como "Sem dado", nunca 0. Sem serie nesta fonte: sem tendencia.
 */
export default function QualidadeDrilldownContent({
  chave, kpis, marcas, periodLabel, refreshedAt,
}: {
  chave: ChaveQualidade;
  kpis: QualityKpis | null;
  marcas: QualityBrandRow[];
  periodLabel: string;
  refreshedAt: string | null;
}) {
  const def = DEF_QUALIDADE[chave];
  const t = textoDoCartao(chave, kpis);
  const linhas = linhasPorMarca(chave, marcas);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        {t.ausente ? (
          <span className="text-[32px] font-bold leading-none tracking-tight text-ink-faint tabular-nums">—</span>
        ) : (
          <NumeroAnimado texto={t.valor} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
        )}
        <DrilldownContextLine periodLabel={periodLabel} refreshedAt={refreshedAt} dica={def.dica ? <InfoDica texto={def.dica} /> : undefined} />
      </div>

      <DrilldownSecao titulo="Por marca" acao={<span className="tabular-nums">{linhas.length}</span>}>
        {linhas.length === 0 ? (
          <p className="text-xs text-ink-faint">Sem marcas para o período e filtros selecionados.</p>
        ) : (
          <ul className="flex flex-col">
            {linhas.map((l) => (
              <EvidenceRow key={l.brand} label={l.label} value={l.valor} ponto={CHANNEL_DOT[def.canal]} pct={l.pct} tone={l.ausente ? "muted" : "value"} mutedLabel={l.ausente} />
            ))}
          </ul>
        )}
      </DrilldownSecao>
    </div>
  );
}
