"use client";

import type { RegiaoBrandRow, RegiaoUfRow, RegioesSummaryData } from "@/lib/api-client";
import { linhasPorMarca, linhasPorUf, ufsForaDoTop, valorExato, type ChaveRegioes } from "@/lib/regioes-cartoes";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import InfoDica from "@/components/ui/InfoDica";
import NumeroAnimado from "@/components/ui/NumeroAnimado";

/**
 * Detalhe de GMV e de Pedidos de Regioes, no molde do detalhe da Gerencial: valor,
 * periodo e frescor em selos, o ⓘ do escopo regional (o numero NAO e' o GMV total do
 * periodo) e as quebras por UF (as 10 maiores) e por marca x canal, com a participacao
 * antes do absoluto. So' dados ja' carregados; sem dado = "Sem dado", nunca zero.
 */
export default function RegioesDrilldownContent({
  chave, resumo, ufs, marcas, periodLabel, refreshedAt, notaDoEscopo,
}: {
  chave: ChaveRegioes;
  resumo: RegioesSummaryData | null;
  ufs: RegiaoUfRow[] | null;
  marcas: RegiaoBrandRow[] | null;
  periodLabel: string;
  refreshedAt: string | null;
  notaDoEscopo?: string;
}) {
  // T-0111: total nulo (sem linha) vira base 0, e a participacao por UF/marca sai nula, nunca 0%.
  const total = (resumo ? (chave === "gmv" ? resumo.gmv : resumo.orders) : null) ?? 0;
  const exato = valorExato(chave, resumo);
  const porUf = ufs ? linhasPorUf(chave, ufs, total) : null;
  const porMarca = marcas ? linhasPorMarca(chave, marcas, total) : null;
  const fora = ufs ? ufsForaDoTop(ufs, chave) : 0;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        {exato == null ? (
          <span className="text-[32px] font-bold leading-none tracking-tight text-ink-faint tabular-nums">—</span>
        ) : (
          <NumeroAnimado texto={exato} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
        )}
        <DrilldownContextLine periodLabel={periodLabel} refreshedAt={refreshedAt} dica={notaDoEscopo ? <InfoDica texto={notaDoEscopo} /> : undefined} />
      </div>

      <DrilldownSecao titulo="Por UF" acao={<span className="tabular-nums">{fora > 0 ? `10 maiores · +${fora}` : porUf ? porUf.length : ""}</span>}>
        {porUf == null ? (
          <p className="text-xs text-ink-faint">Sem dado por UF nesta carga.</p>
        ) : porUf.length === 0 ? (
          <p className="text-xs text-ink-faint">Nenhuma UF com venda no período.</p>
        ) : (
          <ul className="flex flex-col">
            {porUf.map((l) => (
              <EvidenceRow key={l.chave} label={l.label} value={l.valor} pct={l.pct} tone={l.ausente ? "muted" : "value"} mutedLabel={l.ausente} />
            ))}
          </ul>
        )}
      </DrilldownSecao>

      <DrilldownSecao titulo="Por marca e canal" acao={<span className="tabular-nums">{porMarca ? porMarca.length : ""}</span>}>
        {porMarca == null ? (
          <p className="text-xs text-ink-faint">Sem dado por marca nesta carga.</p>
        ) : porMarca.length === 0 ? (
          <p className="text-xs text-ink-faint">Nenhuma marca no período e filtros selecionados.</p>
        ) : (
          <ul className="flex flex-col">
            {porMarca.map((l) => (
              <EvidenceRow key={l.chave} label={l.label} value={l.valor} pct={l.pct} tone={l.ausente ? "muted" : "value"} mutedLabel={l.ausente} />
            ))}
          </ul>
        )}
      </DrilldownSecao>
    </div>
  );
}
