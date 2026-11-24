"use client";

/**
 * CURVA-ABC nas abas de estoque (PR4): a celula "Curva" e os chips do filtro,
 * iguais nas abas Shopee e ML. O chip e' o do /full (#301); o filtro, a caixa da Gerencial.
 */
import BrandFilter from "@/components/BrandFilter";
import ChipCurva from "@/components/full/ChipCurva";
import InfoDica from "@/components/ui/InfoDica";
import Segmented from "@/components/ui/Segmented";
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
const OPCOES_SEGMENTADO = [{ valor: "todas", texto: "Todas" }, ...OPCOES_CURVA] as const;
export function SeletorCurva({
  valor, aoMudar, ajuda,
}: { valor: readonly OpcaoCurva[]; aoMudar: (v: OpcaoCurva[]) => void; ajuda?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Segmented
        rotulo="Curva"
        opcoes={OPCOES_SEGMENTADO}
        valor={valor.length === 1 ? valor[0] : "todas"}
        aoEscolher={(v) => aoMudar(v === "todas" ? [] : [v])}
      />
      {ajuda && <InfoDica texto={ajuda} />}
    </span>
  );
}
