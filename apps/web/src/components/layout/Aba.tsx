"use client";

/**
 * UI-FUNDACAO (F1) + ALVO-GRADE (aprovado em 12/11/2026) — o ESQUELETO de toda
 * aba, na mesma ordem:
 *
 *   1. titulo grande | selo "Atualizado HH:MM";
 *   2. sub-visoes da aba, em ABAS sob o titulo (`visoes`);
 *   3. barra de filtros numa linha (sticky; encolhe ao rolar);
 *   4. faixa de 4 cartoes de indicador (`faixa`);
 *   5. "O que exige atenção";
 *   6. paineis lado a lado e tabelas em largura total (`children`).
 *
 * As abas migram para ele uma a uma (F2/F3); `tests/ui-fundacao.test.ts`
 * guarda a lista das que ainda nao migraram, que so' pode diminuir.
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
      <div ref={sentinela} aria-hidden="true" className="-mb-3.5 h-px" />
      <div
        data-encolhida={encolhida || undefined}
        // Parada no lugar, a barra e' so' uma linha de controles; a faixa de vidro aparece quando ela cola no topo.
        className={`tc-barra-filtros sticky top-0 z-30 -mx-5 px-5 ${encolhida ? "tc-barra-vidro border-b border-line py-1 shadow-sm" : "py-0"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">{children}</div>
      </div>
    </>
  );
}

export interface VisaoDaAba<T extends string = string> {
  id: T;
  rotulo: string;
  /** Ponto de cor antes do rotulo (canal como aba, na Expedicao e na CX). */
  ponto?: string;
}

/** Rola a aba ativa para dentro da vista e esmaece a borda que esconde mais abas (390 com 4-5 abas). */
function useAbasRolaveis(ativa: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [mais, setMais] = useState({ esq: false, dir: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () =>
      setMais({ esq: el.scrollLeft > 1, dir: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    const alvo = el.querySelector<HTMLElement>('[aria-selected="true"]');
    // So' o scroll horizontal da lista: scrollIntoView mexeria na pagina inteira.
    if (alvo && (alvo.offsetLeft < el.scrollLeft || alvo.offsetLeft + alvo.offsetWidth > el.scrollLeft + el.clientWidth)) {
      el.scrollLeft = alvo.offsetLeft - (el.clientWidth - alvo.offsetWidth) / 2;
    }
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      el.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [ativa]);
  const mascara =
    mais.esq || mais.dir
      ? `linear-gradient(to right, ${mais.esq ? "transparent, black 32px" : "black"}, ${mais.dir ? "black calc(100% - 32px), transparent" : "black"})`
      : undefined;
  return { ref, estilo: mascara ? { maskImage: mascara, WebkitMaskImage: mascara } : undefined };
}

export default function Aba<T extends string = string>({
  titulo,
  selo,
  visoes,
  visao,
  onVisao,
  filtros,
  direita,
  faixa,
  atencao,
  children,
}: {
  /** Mantido para as abas que ainda passam o icone da rota; o titulo grande nao o desenha. */
  icone?: LucideIcon;
  titulo: string;
  /** `SeloAtualizado` (e, se houver, um aviso curto ao lado). */
  selo?: ReactNode;
  visoes?: readonly VisaoDaAba<T>[];
  visao?: T;
  onVisao?: (id: T) => void;
  /** Controles da barra (`GlobalFilterControls` + controles da aba a' direita). */
  filtros?: ReactNode;
  /** Controles da propria aba, a' direita na mesma linha dos filtros (ex.: Pagos | Realizados). */
  direita?: ReactNode;
  faixa?: ReactNode;
  atencao?: ReactNode;
  children?: ReactNode;
}) {
  const abas = useAbasRolaveis(visao);
  return (
    <div className="flex w-full flex-col gap-3.5 p-5" data-esqueleto="aba">
      <header className="flex flex-wrap items-end justify-between gap-3">
        {/* h2: o h1 da pagina e' do shell. */}
        <h2 className="min-w-0 truncate text-[28px] font-bold leading-tight tracking-tight text-ink">{titulo}</h2>
        {selo ? <div className="flex flex-wrap items-center gap-1.5 pb-1">{selo}</div> : null}
      </header>
      {visoes && visoes.length > 1 ? (
        <div ref={abas.ref} style={abas.estilo} role="tablist" aria-label={`Visões de ${titulo}`} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
          {visoes.map((v) => {
            const ativa = v.id === visao;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={ativa}
                onClick={() => onVisao?.(v.id)}
                className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition-colors duration-[180ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  ativa ? "border-accent font-semibold text-accent" : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {v.ponto && <span aria-hidden="true" className={`h-2 w-2 rounded-full ${v.ponto}`} />}
                {v.rotulo}
              </button>
            );
          })}
        </div>
      ) : null}
      {filtros || direita ? (
        <BarraDeFiltros>
          {filtros}
          {direita ? <div className="ml-auto flex flex-wrap items-center gap-2">{direita}</div> : null}
        </BarraDeFiltros>
      ) : null}
      {faixa}
      {atencao}
      {children}
    </div>
  );
}
