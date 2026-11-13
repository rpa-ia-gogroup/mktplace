"use client";

/**
 * UI-FUNDACAO (F1) — o ESQUELETO de toda aba, na mesma ordem:
 *
 *   1. cabecalho: icone em caixa + titulo | selo "Atualizado HH:MM";
 *   2. barra de filtros (sticky; encolhe ao rolar);
 *   3. faixa principal (o heroi / os cartoes de indicador);
 *   4. "O que exige atenção";
 *   5. paineis e tabelas (`children`).
 *
 * As abas migram para ele uma a uma (F2/F3); `tests/ui-fundacao.test.ts`
 * guarda a lista das que ainda nao migraram, que so' pode diminuir.
 *
 * Fragmento nao: a barra sticky precisa ser filha DIRETA do container da
 * pagina inteira (ver `PageHeader`), senao so' cola dentro do cabecalho.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function BarraDeFiltros({ children }: { children: ReactNode }) {
  // Encolhe quando o topo da pagina sai da tela: menos altura parada sobre o
  // conteudo. Um sentinela de 1px antes da barra; sem IntersectionObserver
  // (teste, navegador antigo), fica no tamanho cheio.
  const sentinela = useRef<HTMLDivElement>(null);
  const [encolhida, setEncolhida] = useState(false);
  useEffect(() => {
    const el = sentinela.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setEncolhida(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinela} aria-hidden="true" className="-mb-3 h-px" />
      <div
        data-encolhida={encolhida || undefined}
        className={`tc-barra-filtros sticky top-0 z-30 -mx-4 border-b border-line px-4 tc-barra-vidro ${
          encolhida ? "py-1 shadow-sm" : "py-2"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">{children}</div>
      </div>
    </>
  );
}

export default function Aba({
  icone: Icone,
  titulo,
  selo,
  filtros,
  faixa,
  atencao,
  children,
}: {
  icone: LucideIcon;
  titulo: string;
  /** `SeloAtualizado` (e, se houver, um aviso curto ao lado). */
  selo?: ReactNode;
  /** Controles da barra (`GlobalFilterControls` + controles da aba a' direita). */
  filtros?: ReactNode;
  faixa?: ReactNode;
  atencao?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-3 px-4 py-4" data-esqueleto="aba">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {/* h2: o h1 da pagina e' do shell. */}
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold text-ink">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/15"
          >
            <Icone className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="tc-titulo-texto truncate">{titulo}</span>
        </h2>
        {selo ? <div className="flex flex-wrap items-center gap-1.5">{selo}</div> : null}
      </header>
      {filtros ? <BarraDeFiltros>{filtros}</BarraDeFiltros> : null}
      {faixa}
      {atencao}
      {children}
    </div>
  );
}
