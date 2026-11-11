import { avisoCanaisSemDado } from "@/lib/filters/channel-coverage";
import type { Marketplace } from "@/lib/mock-data";

/**
 * T-0089 — aviso de canal selecionado sem dado na fonte desta visao (sem dado
 * nao e' zero). Nao renderiza nada quando todo canal selecionado e' coberto.
 * Selo de atencao em tokens do tema (bg-warn-soft/text-warn-ink), como os
 * avisos da Expedicao; substitui o selo ambar literal de Pedidos.
 */
export default function AvisoCanaisSemDado({
  selecao,
  cobertos,
  className = "",
}: {
  /** Canais do filtro global. */
  selecao: readonly Marketplace[];
  /** Canais que a fonte desta visao tem. */
  cobertos: readonly Marketplace[];
  /** Espaco externo, quando o pai nao e' flex com gap. */
  className?: string;
}) {
  const texto = avisoCanaisSemDado(selecao, cobertos);
  if (!texto) return null;
  return (
    <p
      role="note"
      className={`${className} w-fit rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 text-xs font-medium text-warn-ink`}
    >
      {texto}
    </p>
  );
}
