import type { Curva } from "@/lib/full-visao-geral";

/**
 * CURVA-ABC -- selo da curva do produto (AA, A, B, C ou "sem curva").
 *
 * Rampa de UMA cor (accent), do mais forte (AA) ao mais apagado (C): NAO e'
 * cor de status (bom/ruim). "Sem curva" e' contorno tracejado: desconhecido,
 * nao baixo. Exportado para as abas de estoque usarem o mesmo selo.
 */
const PELE: Record<Curva | "sem", string> = {
  AA: "bg-accent text-accent-on font-semibold",
  A: "bg-accent-soft text-accent-ink border border-accent/40",
  B: "bg-raised text-ink-muted border border-line-strong",
  C: "bg-raised text-ink-faint",
  sem: "border border-dashed border-line-strong text-ink-faint",
};

export default function ChipCurva({ curva, className = "" }: { curva: Curva | null; className?: string }) {
  const chave = curva ?? "sem";
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 text-xs leading-5 ${PELE[chave]} ${className}`}>
      <span aria-hidden="true">{curva ?? "sem curva"}</span>
      <span className="sr-only">{curva ? `curva ${curva}` : "sem curva"}</span>
    </span>
  );
}
