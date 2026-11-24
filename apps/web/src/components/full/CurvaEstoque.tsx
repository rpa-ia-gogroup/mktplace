"use client";

/**
 * CURVA-ABC nas abas de estoque (PR4): a celula "Curva" e os chips do filtro,
 * iguais nas abas Shopee e ML. O chip e' o do /full (#301); o filtro, a caixa da Gerencial.
 */
import BrandFilter from "@/components/BrandFilter";
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

/** "Curva: Todas | AA/A | B | C | Sem curva" — a caixa multi da Gerencial (`BrandFilter` menu). */
export function FiltroCurva({
  valor, aoMudar, ajuda,
}: { valor: readonly OpcaoCurva[]; aoMudar: (v: OpcaoCurva[]) => void; /** Cobertura da curva e regra do "sem curva": ⓘ ao lado da caixa, nao paragrafo. */ ajuda?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <BrandFilter
        variante="menu"
        rotulo="Curva"
        opcoes={OPCOES_CURVA.map((o) => ({ value: o.valor, label: o.texto }))}
        value={[...valor]}
        onChange={(v) => aoMudar(v as OpcaoCurva[])}
      />
      {ajuda && <InfoDica texto={ajuda} />}
    </span>
  );
}

/**
 * Pedido da Nath (24/11): a curva a vista, na faixa logo acima de "Estoque por curva e marca".
 * "Todas | AA/A | B | C | Sem curva" — uma escolha por vez; Todas = sem filtro (mesmo estado do filtro antigo).
 */
export function SeletorCurva({
  valor, aoMudar, ajuda,
}: { valor: readonly OpcaoCurva[]; aoMudar: (v: OpcaoCurva[]) => void; ajuda?: string | null }) {
  const opcoes: { valor: OpcaoCurva | null; texto: string }[] = [{ valor: null, texto: "Todas" }, ...OPCOES_CURVA];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="text-xs font-medium text-ink-muted">Curva</span>
      <span role="group" aria-label="Curva" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
        {opcoes.map((o) => {
          const on = o.valor === null ? valor.length === 0 : valor.length === 1 && valor[0] === o.valor;
          return (
            <button
              key={o.texto}
              type="button"
              aria-pressed={on}
              onClick={() => aoMudar(o.valor === null || on ? [] : [o.valor])}
              className={`min-h-11 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-8 ${
                on ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {o.texto}
            </button>
          );
        })}
      </span>
      {ajuda && <InfoDica texto={ajuda} />}
    </span>
  );
}
