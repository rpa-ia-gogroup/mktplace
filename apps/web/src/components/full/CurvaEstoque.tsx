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
