"use client";

import type { PedidosBrandRow } from "@/lib/api-client";
import { suavizar, tendencia } from "@/lib/gerencial/kpi-trend";
import { fmtDelta, fmtPctBr } from "@/lib/formatters";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import { linhasPorCanal, linhasPorMarca, serieDoDetalhe, valorExato, variacaoEmPp, type ChaveDetalhe, type Dados, type Selecao, type Series } from "@/lib/pedidos-cartoes";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import { IDENTIDADE, type IdentidadeKpi } from "@/components/ui/KpiTile";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import Sparkline from "@/components/ui/Sparkline";

/**
 * Detalhe de um cartao de Pedidos, no molde do detalhe da Gerencial
 * (`KpiDrilldownContent`): valor exato, periodo e frescor em selos, tendencia com o
 * MESMO Sparkline do cartao (cor do KPI, ponto final), e a quebra por canal e por
 * marca. So' dados ja' carregados; marca sem valor aparece como "Sem dado".
 */
export default function PedidosDrilldownContent({
  chave, dados, marcas, sel, series, identidade, periodLabel, refreshedAt,
}: {
  chave: ChaveDetalhe;
  dados: Dados;
  marcas: PedidosBrandRow[];
  sel: Selecao;
  series: Series;
  identidade: IdentidadeKpi;
  periodLabel: string;
  refreshedAt: string | null;
}) {
  const exato = valorExato(chave, dados);
  const t = tendencia(serieDoDetalhe(chave, series), "day");
  const porCanal = linhasPorCanal(chave, dados, sel);
  const porMarca = linhasPorMarca(chave, marcas, sel);
  // Taxa: a variacao e' em pontos percentuais; contagem e valor, relativa.
  const variacao = t == null ? null : chave === "cancelamento" ? (variacaoEmPp(t.pontos) != null ? fmtDelta(variacaoEmPp(t.pontos)!, "pp") : null) : t.variacaoPct != null ? fmtPctBr(t.variacaoPct) : null;
  const canalDoDetalhe = chave.startsWith("tk_") ? "tiktok" : chave.startsWith("ml_") ? "ml" : chave.startsWith("sh_") ? "shopee" : null;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        {exato === "—" ? (
          <span className="text-[32px] font-bold leading-none tracking-tight text-ink-faint tabular-nums">—</span>
        ) : (
          <NumeroAnimado texto={exato} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
        )}
        <DrilldownContextLine periodLabel={periodLabel} refreshedAt={refreshedAt} />
      </div>

      {t && t.pontos.length >= 4 && (
        <DrilldownSecao
          titulo="Tendência"
          acao={
            variacao != null && (
              <span className="tabular-nums">
                <b className="font-semibold text-ink-muted">{variacao}</b> · {t.rotulo}
              </span>
            )
          }
        >
          <div className="[&>span]:h-16">
            <Sparkline pontos={suavizar(t.pontos)} tinta={IDENTIDADE[identidade].tinta} />
          </div>
        </DrilldownSecao>
      )}

      {porCanal.length > 1 && (
        <DrilldownSecao titulo="Por canal">
          <ul className="flex flex-col">
            {porCanal.map((l) => (
              <EvidenceRow key={l.canal} label={l.label} value={l.valor} ponto={CHANNEL_DOT[l.canal]} pct={l.pct} tone={l.ausente ? "muted" : "value"} mutedLabel={l.ausente} />
            ))}
          </ul>
        </DrilldownSecao>
      )}

      <DrilldownSecao titulo="Por marca" acao={<span className="tabular-nums">{porMarca.length}</span>}>
        {porMarca.length === 0 ? (
          <p className="text-xs text-ink-faint">Sem marcas para o período e filtros selecionados.</p>
        ) : (
          <ul className="flex flex-col">
            {porMarca.map((l) => (
              <EvidenceRow
                key={l.brand}
                label={l.label}
                value={l.valor}
                ponto={canalDoDetalhe ? CHANNEL_DOT[canalDoDetalhe] : undefined}
                pct={l.pct}
                tone={l.ausente ? "muted" : "value"}
                mutedLabel={l.ausente}
              />
            ))}
          </ul>
        )}
      </DrilldownSecao>
    </div>
  );
}
