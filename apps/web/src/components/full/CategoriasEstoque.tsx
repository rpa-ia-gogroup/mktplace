"use client";

/**
 * CARDS-CLICAVEIS (spec do Prumo) — faixa de cards das abas de estoque do
 * /full, chip "Mostrando: … ×" e a categoria na URL (?categoria=). O clique no
 * card aplica a categoria na tabela da propria aba; clicar de novo ou no ×
 * limpa. Voltar do navegador desfaz.
 */
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";

import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import type { Tom } from "@/components/ui/tone";
import { categoriaDaUrl, urlComCategoria } from "@/lib/estoque-categorias";

export interface CardCategoria {
  chave: string;
  rotulo: string;
  valor: string;
  comparacao: ReactNode;
  identidade: IdentidadeKpi;
  icone: LucideIcon;
  tom?: Tom;
}

const SR_PARCIAL = "parcial: veja o aviso no topo";

export function FaixaCategorias({
  cards, ativa, aoEscolher, parcial = false,
}: { cards: CardCategoria[]; ativa: string | null; aoEscolher: (chave: string) => void; parcial?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
      {cards.map((c) => (
        <KpiTile
          key={c.chave}
          variante="gerencial"
          identidade={c.identidade}
          icone={c.icone}
          rotulo={c.rotulo}
          valor={c.valor}
          tom={c.tom ?? "neutro"}
          // O parcial e' UM aviso no topo da aba; no card, so' title e leitor de tela.
          contexto={parcial ? `${c.rotulo}: ${SR_PARCIAL}` : undefined}
          comparacao={
            <>
              {c.comparacao}
              {parcial && <span className="sr-only">; {SR_PARCIAL}</span>}
            </>
          }
          onAbrir={() => aoEscolher(c.chave)}
          ativo={ativa === c.chave}
        />
      ))}
    </div>
  );
}

/** "Mostrando: Excesso (121) ×" — o botao inteiro limpa. */
export const ChipCategoria = forwardRef<HTMLButtonElement, { texto: string; aoLimpar: () => void }>(
  function ChipCategoria({ texto, aoLimpar }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={aoLimpar}
        aria-label={`${texto}. Limpar e voltar à lista completa`}
        className="inline-flex min-h-11 w-fit max-w-full items-center gap-1.5 rounded-full border border-accent bg-accent-soft px-3 py-1 text-left text-sm font-semibold text-accent-ink hover:bg-accent-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-0"
      >
        <span>{texto}</span>
        <X aria-hidden="true" className="h-4 w-4 shrink-0" />
      </button>
    );
  },
);

/**
 * A categoria vive na URL (?categoria=excesso): o voltar do navegador desfaz e
 * o link compartilha o recorte. Chave desconhecida = nenhuma.
 */
export function useCategoriaNaUrl(validas: readonly string[]) {
  const params = useSearchParams();
  const router = useRouter();
  const caminho = usePathname();
  const ativa = categoriaDaUrl(params.get("categoria"), validas);
  const definir = useCallback(
    (chave: string | null) => router.push(urlComCategoria(caminho, params.toString(), chave), { scroll: false }),
    [params, router, caminho],
  );
  return [ativa, definir] as const;
}

/**
 * Depois do clique no card: rola ate' o chip (abaixo da barra fixa de filtros)
 * e poe o foco nele. So' quando o clique pediu (`pedido`), nunca ao abrir a URL.
 */
export function useRolarAteChip(chip: RefObject<HTMLButtonElement | null>, ativa: string | null, pronto: boolean) {
  const pedido = useRef(false);
  useEffect(() => {
    if (!pedido.current || !ativa || !pronto || !chip.current) return;
    pedido.current = false;
    const barra = document.querySelector(".tc-barra-vidro");
    chip.current.style.scrollMarginTop = `${(barra?.getBoundingClientRect().height ?? 0) + 16}px`;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chip.current.scrollIntoView({ block: "start", behavior: suave ? "smooth" : "auto" });
    chip.current.focus({ preventScroll: true });
  }, [ativa, pronto, chip]);
  return pedido;
}
