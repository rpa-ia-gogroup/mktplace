import { descreverPartes, type CelulaGrade } from "@/lib/estoque-grade-curva";

/**
 * Barra empilhada dos itens de uma marca: ruptura, estoque baixo, demais
 * (cinza: suficiente, sem giro) e excesso. Largura proporcional ao nº de itens;
 * quem pede acao tem cor, o resto recua. Serve a grade do Estoque e a Visao geral.
 */
const SEGMENTOS = [
  { chave: "ruptura", cor: "bg-crit" },
  { chave: "baixo", cor: "bg-warn" },
  { chave: "demais", cor: "bg-line-strong" },
  { chave: "excesso", cor: "bg-accent" },
] as const;

export default function BarraItens({ c, className = "" }: {
  c: Pick<CelulaGrade, "itens" | "ruptura" | "baixo" | "excesso" | "demais">;
  className?: string;
}) {
  const texto = descreverPartes(c);
  return (
    <span role="img" aria-label={texto} title={texto}
      className={`flex h-2 w-full overflow-hidden rounded-full bg-raised ${className}`}>
      {SEGMENTOS.map((s) => c[s.chave] > 0 && (
        // Fatia minima de 2%: 1 item em 200 nao some da barra.
        <span key={s.chave} className={`${s.cor} block h-full`} style={{ flexGrow: c[s.chave], flexBasis: 0, minWidth: "2%" }} />
      ))}
    </span>
  );
}
