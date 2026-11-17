import { descreverPartes, type CelulaGrade } from "@/lib/estoque-grade-curva";

/**
 * Barra empilhada dos itens de uma marca: ruptura, estoque baixo, demais
 * (cinza: suficiente, sem giro) e excesso. Largura proporcional ao nº de itens;
 * quem pede acao tem cor, o resto recua. Excesso tem tom proprio e fraco (nao o
 * roxo cheio de destaque da Torre). Serve a grade do Estoque e a Visao geral.
 */
const SEGMENTOS = [
  { chave: "ruptura", cor: "bg-crit", rotulo: "Ruptura" },
  { chave: "baixo", cor: "bg-warn", rotulo: "Baixo" },
  { chave: "demais", cor: "bg-line-strong", rotulo: "Demais" },
  { chave: "excesso", cor: "bg-accent-excesso", rotulo: "Excesso" },
] as const;

type Partes = Pick<CelulaGrade, "itens" | "ruptura" | "baixo" | "excesso" | "demais">;

export default function BarraItens({ c, excessoComoDemais = false, className = "" }: {
  c: Partes;
  /** Visao rapida: so' ruptura e baixo pedem acao; excesso vira cinza junto com "demais". */
  excessoComoDemais?: boolean;
  className?: string;
}) {
  const p: Partes = excessoComoDemais ? { ...c, demais: c.demais + c.excesso, excesso: 0 } : c;
  const texto = descreverPartes(p);
  return (
    <span role="img" aria-label={texto} title={texto}
      className={`flex h-2 w-full overflow-hidden rounded-full bg-raised ${className}`}>
      {SEGMENTOS.map((s) => p[s.chave] > 0 && (
        // Fatia minima de 2%: 1 item em 200 nao some da barra.
        <span key={s.chave} className={`${s.cor} block h-full`} style={{ flexGrow: p[s.chave], flexBasis: 0, minWidth: "2%" }} />
      ))}
    </span>
  );
}

/** Legenda de uma linha acima das barras; as cores saem da mesma lista da barra. */
export function LegendaBarra({ excessoComoDemais = false, className = "" }: { excessoComoDemais?: boolean; className?: string }) {
  const itens = SEGMENTOS.filter((s) => !(excessoComoDemais && s.chave === "excesso"));
  return (
    <p aria-hidden="true" className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted ${className}`}>
      {itens.map((s) => (
        <span key={s.chave} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-sm ${s.cor}`} />{s.rotulo}
        </span>
      ))}
    </p>
  );
}
