import { useId, type ReactNode } from "react";

import { TOM_TINTA, type Tom } from "./tone";

/**
 * IDENTIDADE-GERENCIAL — o heroi das abas principais: a casca generica do
 * MetaHero da Gerencial (mesmas classes; o MetaHero nao muda nem passa a
 * usar este componente).
 *
 * UM numero dominante (text-3xl), rotulo uppercase em cima, 1 linha de
 * contexto embaixo, aviso de dado colado no numero, `meio` para a barra ou a
 * quebra por canal e, a direita, o selo de status -- so' quando existe regra
 * de negocio por tras (status sem regra e' decoracao; ver `tone.ts`).
 */

export type TomSelo = "ok" | "atencao" | "critico" | "neutro";

const SELO: Record<TomSelo, string> = {
  ok: "border-ok/40 bg-ok-soft text-ok-ink",
  atencao: "border-warn/40 bg-warn-soft text-warn-ink",
  critico: "border-crit/40 bg-crit-soft text-crit-ink",
  neutro: "border-line-strong bg-raised text-ink-muted",
};

export default function Heroi({
  rotulo,
  valor,
  contexto,
  delta,
  aviso,
  meio,
  selo,
  acao,
  ajuda,
  tom = "neutro",
  carregando = false,
  erro,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  /** Uma linha embaixo do numero (ex.: "120 produtos do sortimento"). */
  contexto?: ReactNode;
  /** Pilula de variacao, antes do contexto. */
  delta?: ReactNode;
  /** Aviso de dado colado no numero (ex.: chip "Desatualizada"). */
  aviso?: ReactNode;
  /** Coluna do meio: barra da meta ou quebra por canal. */
  meio?: ReactNode;
  /** Selo de status a direita. So' com regra de negocio. */
  selo?: { texto: string; tom: TomSelo };
  /** Link de acao embaixo do numero (ex.: "Detalhar →"). */
  acao?: ReactNode;
  /** O ⓘ do rotulo. */
  ajuda?: ReactNode;
  /** Tinta do numero. O tom fica no numero, nunca no fundo do cartao. */
  tom?: Tom;
  carregando?: boolean;
  /** Mensagem de erro do bloco: o heroi falha sozinho, sem derrubar a pagina. */
  erro?: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border border-accent/30 bg-surface">
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(220px,1fr)_2fr_auto] lg:items-center lg:gap-6">
        <div className="min-w-0">
          <h2 id={id} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {rotulo}
            {ajuda && <span className="inline-flex normal-case tracking-normal">{ajuda}</span>}
          </h2>
          {carregando ? (
            <div className="mt-2 h-9 w-48 animate-pulse rounded bg-raised motion-reduce:animate-none" aria-hidden="true" />
          ) : erro ? (
            <p className="mt-2 text-sm text-crit-ink">{erro}</p>
          ) : (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`text-3xl font-bold tracking-tight tabular-nums ${TOM_TINTA[tom]}`}>{valor}</span>
                {aviso}
              </p>
              {(delta || contexto) && (
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted tabular-nums">
                  {delta}
                  {contexto}
                </p>
              )}
              {acao && <div className="mt-1">{acao}</div>}
            </>
          )}
        </div>
        {meio !== undefined && (
          <div className="min-w-0">
            {carregando ? <div className="h-20 animate-pulse rounded-lg bg-raised motion-reduce:animate-none" aria-hidden="true" /> : erro ? null : meio}
          </div>
        )}
        {selo && !carregando && !erro && (
          <div className="flex flex-row items-center justify-between gap-3 border-t border-line pt-4 lg:flex-col lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${SELO[selo.tom]}`}>
              {selo.texto}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
