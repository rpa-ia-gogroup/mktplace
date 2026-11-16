"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import Popover from "@/components/ui/Popover";
import Segmented from "@/components/ui/Segmented";
import { toISODate } from "@/lib/filters/presets";
import { validateDateRange } from "@/lib/filters/url-state";
import {
  ATALHOS_PRODUTOS, ATALHOS_SO_MES, mesDoPeriodo, mesShopee, periodoDoAtalho, periodoDoMesProdutos, rotuloPeriodo,
  type AtalhoProdutos, type PeriodoProdutos,
} from "@/lib/produtos-periodo";
import type { MonthOption } from "@/lib/produtos-tab-transition";

/**
 * Periodo de Produtos (ML, TikTok e Shopee): atalhos a um clique na trilha;
 * mes e intervalo livre (secundarios) no "Outro". `soMes`: a Shopee so' tem
 * competencia mensal, entao ficam os atalhos de mes e a lista de meses.
 */
export default function PeriodoProdutos({ valor, aoMudar, meses, soMes = false }: {
  valor: PeriodoProdutos;
  aoMudar: (p: PeriodoProdutos) => void;
  meses: MonthOption[];
  soMes?: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const hoje = toISODate(new Date());
  const mes = soMes ? mesShopee(valor) : mesDoPeriodo(valor);
  // Na Shopee um atalho de semana/dias vale pelo mes do ultimo dia: acende o atalho desse mes.
  const visto = soMes ? periodoDoMesProdutos(mes!) : valor;
  const atalhos = soMes ? ATALHOS_SO_MES : ATALHOS_PRODUTOS;
  const ativo = atalhos.some((a) => a.valor === visto.atalho) ? (visto.atalho as AtalhoProdutos) : null;

  function livre(inicio: string, fim: string) {
    const v = validateDateRange(inicio, fim);
    if (!v.valid) return setErro(v.error ?? "Intervalo inválido.");
    setErro(null);
    aoMudar({ inicio, fim, atalho: null });
  }

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {/* 390: a trilha rola sozinha; a pagina nao ganha rolagem lateral. */}
      <div className="max-w-[calc(100vw-2.5rem)] overflow-x-auto">
        <Segmented
          rotulo="Período"
          opcoes={atalhos}
          valor={ativo ?? ("" as AtalhoProdutos)}
          aoEscolher={(a) => aoMudar(periodoDoAtalho(a))}
          className="whitespace-nowrap"
        />
      </div>
      <Popover
        rotulo="Outro"
        valor={ativo ? (soMes ? "mês" : "mês ou datas") : rotuloPeriodo(visto, meses)}
        ativo={!ativo}
        icone={<CalendarDays aria-hidden="true" className="h-4 w-4 text-ink-faint" />}
        largura="w-64"
        alinhar="fim"
      >
        {(fechar) => (
          <div className="flex flex-col gap-2">
            <div role="group" aria-label="Mês" className="grid grid-cols-3 gap-0.5">
              {meses.map((m) => {
                const marcado = !ativo && mes === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() => {
                      aoMudar(periodoDoMesProdutos(m.value));
                      fechar();
                    }}
                    className={`min-h-11 rounded-md px-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                      marcado ? "bg-raised font-semibold text-ink ring-1 ring-inset ring-line-strong" : "text-ink-muted hover:bg-raised hover:text-ink"
                    }`}
                  >
                    {m.label.replace(" (atual)", "")}
                  </button>
                );
              })}
            </div>
            {!soMes && (
              <div className="flex flex-col gap-1 border-t border-line px-1 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-ink-faint">
                    De
                    <input
                      type="date"
                      value={valor.inicio}
                      max={valor.fim < hoje ? valor.fim : hoje}
                      onChange={(e) => e.target.value && livre(e.target.value, valor.fim)}
                      className="min-h-11 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink [color-scheme:inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-ink-faint">
                    Até
                    <input
                      type="date"
                      value={valor.fim}
                      min={valor.inicio}
                      max={hoje}
                      onChange={(e) => e.target.value && livre(valor.inicio, e.target.value)}
                      className="min-h-11 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink [color-scheme:inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </label>
                </div>
                {erro && <p role="alert" className="text-xs font-medium text-crit-ink">{erro}</p>}
              </div>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}
