"use client";

/**
 * Filtros da aba CX (CX-FILTROS-PADRAO, 08/11/2026): a mesma barra das outras
 * abas, montada como o `GlobalFilterControls` (Gerencial, Canais, Financeiro):
 * marca e periodo como gatilhos que
 * mostram o valor atual e, abaixo de `sm`, tudo recolhido atras de "Filtros"
 * com o resumo do escopo.
 *
 * As pecas sao as do app: `BrandFilter` (variante `menu`) e o `Popover` que o
 * `DateRangeFilter` usa. O que so' a CX tem entra dentro do padrao:
 *   - canal: Shopee ou Mercado Livre sao as ABAS da pagina (ALVO-GRADE,
 *     12/11/2026; `canal=ml` na URL), nao mais um controle desta barra;
 *   - marca: UMA (a URL e a API leem uma), via `marcaUnica`;
 *   - periodo: a janela de dias fechados (7, 30 ou 90), nao datas livres.
 *
 * A URL continua a fonte de verdade (`hrefCx`, os mesmos `brands` e `dias`).
 */
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, X } from "lucide-react";

import BrandFilter from "@/components/BrandFilter";
import Popover from "@/components/ui/Popover";
import { CLASSE_CONTAGEM, CLASSE_LIMPAR } from "@/components/layout/GlobalFilterControls";
import { JANELAS_DIAS, JANELA_PADRAO, hrefCx, marcaUnica, resumoFiltrosCx, type CanalCx, type FiltrosCx as Filtros } from "@/lib/cx";
import { brandLabel } from "@/lib/filters/brands";

/** Mesmas classes dos botoes do `BrandFilter`/`DateRangeFilter` no menu. */
const OPCAO =
  "inline-flex w-full shrink-0 items-center justify-between min-h-11 min-w-11 px-3 rounded-md text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const OPCAO_ATIVA = "bg-surface font-semibold text-ink shadow-sm ring-1 ring-inset ring-line-strong";
const OPCAO_INATIVA = "text-ink-muted hover:bg-surface/70 hover:text-ink";

export default function FiltrosCx({ f, canal }: { f: Filtros; canal: CanalCx }) {
  const router = useRouter();
  const [aplicando, iniciar] = useTransition();
  const [aberto, setAberto] = useState(false);
  const id = useId();

  const ir = (novo: Filtros, c: CanalCx = canal) => iniciar(() => router.push(hrefCx(novo, c), { scroll: false }));
  // FILTROS-PADRAO: fora do padrao da aba (todas as marcas, janela padrao). O canal virou ABA (ALVO-GRADE): nao e' filtro.
  const fora = [f.marca != null, f.dias !== JANELA_PADRAO].filter(Boolean).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5" data-testid="cx-filtros" aria-busy={aplicando}>
      {/* Celular: o mesmo botao "Filtros" do GlobalFilterControls, com o escopo legivel */}
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto((v) => !v)}
        className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 text-left text-sm sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="min-w-0">
          <span className="flex items-center text-xs font-semibold text-ink">
            Filtros
            {fora > 0 && (
              <span className={CLASSE_CONTAGEM}>
                {fora}
                <span className="sr-only"> fora do padrão</span>
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-ink-muted">{resumoFiltrosCx(f, brandLabel, canal)}</span>
        </span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${aberto ? "rotate-180" : ""}`}
        >
          <path d="M3.5 6 8 10.5 12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        id={id}
        className={`${aberto ? "flex" : "hidden"} min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 pb-1 sm:flex sm:pb-0`}
      >
        <BrandFilter
          value={f.marca ? [f.marca] : []}
          onChange={(escolha) => ir({ ...f, marca: marcaUnica(escolha, f.marca) })}
          variante="menu"
        />

        <Popover
          rotulo="Período"
          valor={`Últimos ${f.dias} dias`}
          icone={<CalendarDays aria-hidden="true" className="h-4 w-4 text-ink-faint" />}
          largura="w-52"
        >
          {(fechar) => (
            <div role="group" aria-label="Janela de dias fechados" className="flex flex-col gap-0.5">
              {JANELAS_DIAS.map((d) => {
                const ativo = f.dias === d;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => {
                      fechar();
                      if (!ativo) ir({ ...f, dias: d });
                    }}
                    className={`${OPCAO} ${ativo ? OPCAO_ATIVA : OPCAO_INATIVA}`}
                  >
                    Últimos {d} dias
                    {ativo && <Check aria-hidden="true" className="h-4 w-4 text-accent" />}
                  </button>
                );
              })}
            </div>
          )}
        </Popover>

        {fora > 0 && (
          <button type="button" onClick={() => ir({ ...f, marca: null, dias: JANELA_PADRAO })} aria-label="Limpar filtros (volta ao padrão da aba)" className={CLASSE_LIMPAR}>
            <X aria-hidden="true" className="h-3.5 w-3.5 min-[1760px]:mr-1" />
            <span className="sr-only min-[1760px]:not-sr-only">Limpar</span>
          </button>
        )}

        {aplicando && (
          <span role="status" className="inline-flex min-h-11 shrink-0 items-center text-xs text-ink-faint animate-pulse">
            Atualizando…
          </span>
        )}
      </div>
    </div>
  );
}
