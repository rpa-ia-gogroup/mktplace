import Link from "next/link";
import { useId, type ReactNode } from "react";

/**
 * IDENTIDADE-GERENCIAL — "O que exige atenção agora": a lista do
 * AttentionQueue da Gerencial generalizada (mesmas classes de selo e de
 * linha). O AttentionQueue nao muda nem passa a usar este componente.
 */

export type Severidade = "critico" | "atencao" | "info";

export interface ItemAtencao {
  chave: string;
  severidade: Severidade;
  titulo: ReactNode;
  detalhe?: ReactNode;
  /** Link de destino OU acao de abrir (drilldown); sem nenhum, a linha nao e' clicavel. */
  href?: string;
  onAbrir?: () => void;
}

const ROTULO: Record<Severidade, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  info: "Informativo",
};

const TOM: Record<Severidade, string> = {
  critico: "text-crit-ink bg-crit-soft border-crit/35",
  atencao: "text-warn-ink bg-warn-soft border-warn/35",
  info: "text-ink-muted bg-raised border-line",
};

const LINHA =
  "w-full min-h-11 text-left flex items-start gap-2.5 rounded-xl px-2 -mx-2 py-2 hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors";

export default function FilaAtencao({
  titulo = "O que exige atenção agora",
  itens,
  vazio,
  carregando = false,
  erro,
  onTentar,
  semMoldura = false,
}: {
  titulo?: ReactNode;
  itens: ItemAtencao[];
  /** Texto quando nao ha' nada (ex.: "Nenhuma ruptura no Full"). */
  vazio: ReactNode;
  carregando?: boolean;
  /** Mensagem de erro do bloco: a fila falha sozinha. */
  erro?: ReactNode;
  onTentar?: () => void;
  /** ALVO-GRADE: so' a lista, para ir DENTRO de um `Panel` (que ja' traz moldura e titulo). */
  semMoldura?: boolean;
}) {
  const id = useId();
  const corpo = (
    <>
      {carregando ? (
        <div className="flex flex-col gap-2 animate-pulse motion-reduce:animate-none" role="status" aria-busy="true">
          <span className="sr-only">Carregando…</span>
          <div className="h-10 w-full bg-accent-soft rounded-xl" />
          <div className="h-10 w-full bg-accent-soft rounded-xl" />
        </div>
      ) : erro ? (
        <div className="bg-raised border border-line rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-ink-muted">{erro}</p>
          {onTentar && (
            <button
              type="button"
              onClick={onTentar}
              className="text-xs font-semibold text-ink-muted border border-line-strong rounded-lg px-3 min-h-11 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Tentar novamente
            </button>
          )}
        </div>
      ) : itens.length === 0 ? (
        <p className="text-xs text-ink-faint">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {itens.map((item) => {
            const corpo = (
              <>
                <span className={`text-xs font-semibold uppercase rounded border px-1.5 py-0.5 shrink-0 mt-0.5 ${TOM[item.severidade]}`}>
                  {ROTULO[item.severidade]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink leading-snug">{item.titulo}</span>
                  {item.detalhe && <span className="block text-xs text-ink-faint leading-snug">{item.detalhe}</span>}
                </span>
                {(item.href || item.onAbrir) && (
                  <span aria-hidden="true" className="text-ink-faint shrink-0 mt-0.5">→</span>
                )}
              </>
            );
            return (
              <li key={item.chave}>
                {item.href ? (
                  <Link href={item.href} className={LINHA}>{corpo}</Link>
                ) : item.onAbrir ? (
                  <button type="button" onClick={item.onAbrir} aria-haspopup="dialog" className={LINHA}>{corpo}</button>
                ) : (
                  <div className="flex items-start gap-2.5 py-2">{corpo}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  if (semMoldura) return corpo;
  return (
    <section aria-labelledby={id} className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-4">
      <h2 id={id} className="text-sm font-semibold text-ink-muted">{titulo}</h2>
      {corpo}
    </section>
  );
}
