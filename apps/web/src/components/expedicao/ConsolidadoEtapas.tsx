/**
 * EXPEDICAO-POPUP-ETAPAS — pedido da operacao (09/11/2026): no topo do popup
 * de pedidos, logo abaixo do total, quanto da lista INTEIRA esta' em cada
 * etapa ("Aguardando coleta 100% · 1.465"). Barra empilhada + uma linha por
 * etapa, da maior para a menor. Cor por POSICAO (nao e' estado).
 */
import { formatarInteiro } from "@/lib/expedicao-formato";
import { SEM_ETAPA, pctDaEtapa, type FatiaEtapa } from "@/lib/expedicao-travados";

const COR = ["bg-accent", "bg-accent/60", "bg-accent/35", "bg-accent/20"];

export default function ConsolidadoEtapas({ itens, total }: { itens: FatiaEtapa[]; total: number }) {
  if (!itens.length || !(total > 0)) return null;
  const cor = (i: number, rotulo: string) => (rotulo === SEM_ETAPA ? "bg-line-strong" : COR[Math.min(i, COR.length - 1)]);
  return (
    <section aria-label="Em que etapa estão" className="flex flex-col gap-2" data-testid="exp-consolidado-etapas">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
        {itens.map((e, i) => (
          <span key={e.rotulo} className={cor(i, e.rotulo)} style={{ width: `${(e.n / total) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {itens.map((e, i) => (
          <li key={e.rotulo} className="flex items-center gap-1.5 tabular-nums">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${cor(i, e.rotulo)}`} />
            <span className="text-ink">{e.rotulo}</span>
            <span className="font-semibold text-ink">{pctDaEtapa(e.n, total)}</span>
            <span>· {formatarInteiro(e.n)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
