/**
 * UI-FUNDACAO (F1) — carregando no FORMATO do conteudo que vai chegar.
 *
 * Um giro no meio de um painel vazio faz a tela pular quando os dados chegam;
 * o esqueleto ocupa o mesmo espaco (cartoes, linhas de tabela, area de
 * grafico, itens de lista). O brilho vem do CSS global (`.animate-pulse` com
 * blocos `bg-raised`) e para com `prefers-reduced-motion`.
 */
import KpiCardSkeleton from "./KpiCardSkeleton";

type Forma = "cartoes" | "tabela" | "grafico" | "lista";

export default function Esqueleto({
  forma,
  quantidade,
  rotulo = "Carregando…",
}: {
  forma: Forma;
  /** Cartoes (padrao 4), linhas de tabela (padrao 6) ou itens de lista (padrao 3). */
  quantidade?: number;
  /** Texto para o leitor de tela. */
  rotulo?: string;
}) {
  const anuncio = <span className="sr-only">{rotulo}</span>;
  if (forma === "cartoes") {
    const n = quantidade ?? 4;
    return (
      <div role="status" aria-busy="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {anuncio}
        {Array.from({ length: n }, (_, i) => (
          <KpiCardSkeleton key={i} anunciar={false} />
        ))}
      </div>
    );
  }
  if (forma === "grafico") {
    return (
      <div role="status" aria-busy="true" className="flex h-56 flex-col justify-end gap-2 animate-pulse">
        {anuncio}
        <div className="flex flex-1 items-end gap-2">
          {[40, 65, 50, 80, 60, 72, 45, 90].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-raised" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="h-px bg-line" />
      </div>
    );
  }
  if (forma === "lista") {
    const n = quantidade ?? 3;
    return (
      <ul role="status" aria-busy="true" className="flex flex-col gap-3 animate-pulse">
        {anuncio}
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className="flex items-center gap-3">
            <div className="h-5 w-16 shrink-0 rounded bg-raised" />
            <div className="h-3 flex-1 rounded bg-raised" />
          </li>
        ))}
      </ul>
    );
  }
  const n = quantidade ?? 6;
  return (
    <div role="status" aria-busy="true" className="flex flex-col animate-pulse">
      {anuncio}
      <div className="mb-1 h-3 w-1/3 rounded bg-raised" />
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line py-2.5 last:border-b-0">
          <div className="h-3 w-1/4 rounded bg-raised" />
          <div className="ml-auto h-3 w-16 rounded bg-raised" />
          <div className="h-3 w-16 rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}
