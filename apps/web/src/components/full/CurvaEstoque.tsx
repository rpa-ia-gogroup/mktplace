"use client";

/**
 * CURVA-ABC nas abas de estoque (PR4): a celula "Curva" e os chips do filtro,
 * iguais nas abas Shopee e ML. O chip e' o do /full (#301).
 */
import ChipCurva from "@/components/full/ChipCurva";
import InfoDica from "@/components/ui/InfoDica";
import { motivoSemCurva, OPCOES_CURVA, type ItemComCurva, type OpcaoCurva } from "@/lib/estoque-curva";

/** Nunca vazia: "sem curva" tracejado com o motivo no title e no leitor de tela. */
export function CelulaCurva({ item }: { item: ItemComCurva }) {
  const curva = item.curva ?? null;
  if (curva) return <ChipCurva curva={curva} />;
  const motivo = motivoSemCurva(item.curva_motivo);
  return (
    <span title={`Sem curva: ${motivo}`} className="inline-flex">
      <ChipCurva curva={null} />
      <span className="sr-only">: {motivo}</span>
    </span>
  );
}

const CHIP =
  "inline-flex items-center min-h-11 sm:min-h-0 text-sm rounded-full border px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** "Curva: AA/A | B | C | Sem curva" — liga/desliga como os chips de Classificação. */
export function FiltroCurvaChips({
  valor, aoMudar, ajuda,
}: { valor: readonly OpcaoCurva[]; aoMudar: (v: OpcaoCurva[]) => void; /** Cobertura da curva e regra do "sem curva": ⓘ ao lado do rotulo, nao paragrafo. */ ajuda?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por curva">
      <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide">Curva</span>
      {ajuda && <InfoDica texto={ajuda} />}
      {OPCOES_CURVA.map((o) => {
        const ligado = valor.includes(o.valor);
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={ligado}
            onClick={() => aoMudar(ligado ? valor.filter((x) => x !== o.valor) : [...valor, o.valor])}
            className={`${CHIP} ${
              ligado
                ? "bg-accent border-accent text-accent-on font-semibold"
                : "bg-surface border-line text-ink-muted hover:border-accent/40"
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}
