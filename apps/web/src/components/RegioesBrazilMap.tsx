"use client";

import { useMemo, useState } from "react";
import type { RegiaoUfRow } from "@/lib/api-client";
import { BRAZIL_UF_PATHS, BRAZIL_MAP_VIEWBOX, UF_NAME } from "@/lib/brazil-uf-paths";
import { computeGmvIntensity, topUfsByGmv } from "@/lib/regioes-map";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "@/lib/formatters";
import { fmtPctOrNA, coverageLabel, coverageBadgeClass, fmtShareOfTotalPct } from "@/lib/regioes-format";
import Panel from "@/components/ui/Panel";

interface Props {
  /** Linhas de /regioes/by-uf — pode incluir "XX", o componente a exclui do
   * mapa e mostra separadamente, em uma faixa discreta abaixo. */
  rows: RegiaoUfRow[];
  /** summary.gmv — denominador da participação exibida no painel de detalhe. */
  totalGmv: number;
  loading?: boolean;
}

const TOP_N = 3;

/**
 * ALVO-GRADE: o preenchimento sai do token de identidade do GMV (alfa pela
 * intensidade), para o mapa seguir o tema escuro. Vai em `style`, nao no
 * atributo SVG: `var()` em atributo de apresentacao nao e' garantido em todo navegador.
 */
function preenchimento(t: number): string {
  return t > 0 ? `rgb(var(--tc-kpi-gmv) / ${Math.round((0.14 + 0.86 * Math.min(1, t)) * 1000) / 1000})` : "rgb(var(--tc-raised))";
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 lg:justify-between">
      <dt className="whitespace-nowrap text-xs text-ink-muted">{label}</dt>
      <dd className="whitespace-nowrap text-xs font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export default function RegioesBrazilMap({ rows, totalGmv, loading }: Props) {
  // Dois estados independentes, de propósito: `hoverUf` e' um preview
  // efêmero (mouse/teclado passando por cima), `selectedUf` e' a seleção
  // que persiste após o mouse sair (clique/Enter). Um único estado
  // compartilhado fazia o clique comparar contra o valor que o próprio
  // onMouseEnter tinha acabado de setar — clicar numa UF em hover sempre
  // "desmarcava" em vez de fixar a seleção (bug encontrado em QA visual).
  const [hoverUf, setHoverUf] = useState<string | null>(null);
  const [selectedUf, setSelectedUf] = useState<string | null>(null);
  const displayedUf = hoverUf ?? selectedUf;

  const byUf = useMemo(() => {
    const m = new Map<string, RegiaoUfRow>();
    for (const r of rows) m.set(r.uf, r);
    return m;
  }, [rows]);

  const intensity = useMemo(
    () => computeGmvIntensity(rows.map((r) => ({ uf: r.uf, gmv: r.gmv }))),
    [rows],
  );

  const top3 = useMemo(() => topUfsByGmv(rows, TOP_N), [rows]);

  const xx = byUf.get("XX") ?? null;
  const hasAnyData = rows.some((r) => r.uf !== "XX" && r.gmv > 0);
  const active = displayedUf ? byUf.get(displayedUf) ?? null : null;
  const activeName = displayedUf ? UF_NAME[displayedUf] : null;

  return (
    <Panel
      titulo="Mapa regional"
      semPadding
      acao={
        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
          <span className="font-semibold uppercase tracking-wide text-ink-faint">GMV</span>
          <span
            className="h-2.5 w-16 rounded-full"
            style={{ background: "linear-gradient(to right, rgb(var(--tc-kpi-gmv) / 0.14), rgb(var(--tc-kpi-gmv)))" }}
            aria-hidden="true"
          />
          <span>menor</span>
          <span className="text-ink-faint">→</span>
          <span>maior</span>
        </span>
      }
    >
      <div
        className={`flex flex-col gap-4 p-4 transition-opacity duration-200 lg:flex-row lg:p-6 ${loading ? "opacity-50" : ""}`}
        aria-busy={loading}
      >
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2">
          <svg
            viewBox={BRAZIL_MAP_VIEWBOX}
            className="h-auto max-h-[440px] w-full"
            role="img"
            aria-label="Mapa do Brasil, estados coloridos por intensidade de GMV no período e filtros selecionados"
          >
            {BRAZIL_UF_PATHS.map(({ uf, name, path }) => {
              const row = byUf.get(uf);
              const t = intensity.get(uf) ?? 0;
              const level = row?.coverage_level ?? "not_applicable";
              const isSelected = selectedUf === uf;
              const isActive = displayedUf === uf;
              const gmv = row?.gmv ?? 0;
              const orders = row?.orders ?? 0;
              const share = fmtShareOfTotalPct(gmv, totalGmv);

              return (
                <path
                  key={uf}
                  d={path}
                  // contorno neutro: vermelho tracejado se lia como erro; a cobertura fica no aria-label e no painel ao lado
                  strokeWidth={isActive ? 2.5 : 0.75}
                  strokeLinejoin="round"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${name} (${uf}): GMV ${fmtBrlCurto(gmv)}, ${fmtNumCurto(orders)} pedidos${share != null ? `, ${fmtPctSimples(share)} de participação` : ""}. ${coverageLabel(level)}.`}
                  className="cursor-pointer outline-none transition-[filter] duration-100 focus-visible:brightness-95"
                  style={{
                    fill: preenchimento(t),
                    stroke: isActive ? "rgb(var(--tc-accent-ink))" : "rgb(var(--tc-line-strong))",
                    filter: isActive ? "brightness(1.05)" : undefined,
                  }}
                  onMouseEnter={() => setHoverUf(uf)}
                  onMouseLeave={() => setHoverUf((cur) => (cur === uf ? null : cur))}
                  onFocus={() => setHoverUf(uf)}
                  onBlur={() => setHoverUf((cur) => (cur === uf ? null : cur))}
                  onClick={() => setSelectedUf((prev) => (prev === uf ? null : uf))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedUf((prev) => (prev === uf ? null : uf));
                    }
                  }}
                >
                  <title>{`${name} (${uf})`}</title>
                </path>
              );
            })}
          </svg>
          {!hasAnyData && !loading && (
            <p className="max-w-xs text-center text-xs text-ink-faint">
              Sem dados de GMV por UF para o período e filtros selecionados.
            </p>
          )}
        </div>

        {/* Painel de detalhe — compacto, nunca disputa espaço com o mapa */}
        <div className="flex w-full shrink-0 flex-col gap-2.5 self-start rounded-xl bg-raised p-3.5 lg:w-64">
          {active ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold leading-none text-ink">{activeName ?? active.uf} <span className="font-semibold text-ink-faint">· {active.uf}</span></p>
                <span className={`inline-block whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${coverageBadgeClass(active.coverage_level)}`}>
                  {coverageLabel(active.coverage_level)}
                </span>
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-1.5 lg:flex-col lg:gap-1.5">
                <StatRow label="GMV" value={fmtBrlCurto(active.gmv)} />
                <StatRow label="Pedidos" value={fmtNumCurto(active.orders)} />
                <StatRow
                  label="Participação"
                  value={(() => {
                    const s = fmtShareOfTotalPct(active.gmv, totalGmv);
                    return s != null ? `${fmtPctSimples(s)}` : "N/A";
                  })()}
                />
                <StatRow label="Cobertura UF" value={fmtPctOrNA(active.uf_fill_pct)} />
                <StatRow label="Cobertura Frete" value={fmtPctOrNA(active.shipping_cost_coverage_pct)} />
              </dl>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-faint">Selecione uma UF para detalhes.</p>
              {top3.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-line pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Top {top3.length} UFs por GMV</p>
                  {top3.map((row, i) => {
                    const share = fmtShareOfTotalPct(row.gmv, totalGmv);
                    return (
                      <div key={row.uf} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-ink">{i + 1}. {row.uf}</span>
                        <span className="tabular-nums text-ink-muted">
                          {fmtBrlCurto(row.gmv)}{share != null && ` · ${fmtPctSimples(share)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {xx && (
        <div className="border-t border-line bg-raised/60 px-6 py-2.5">
          <p className="text-xs text-ink-muted">
            <span className="font-semibold text-ink">Sem UF (XX), fora do mapa:</span> {fmtBrlCurto(xx.gmv)} · {fmtNumCurto(xx.orders)} pedidos
          </p>
        </div>
      )}

      {/* Atribuicao obrigatoria da geometria do mapa (CC BY 4.0) — ver
         header de brazil-uf-paths.ts e THIRD_PARTY_NOTICES.md */}
      <div className="border-t border-line px-6 py-1.5">
        <p className="text-right text-xs text-ink-faint">
          Mapa base:{" "}
          <a
            href="https://github.com/VictorCazanave/svg-maps"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted hover:text-ink-muted"
          >
            @svg-maps/brazil
          </a>{" "}
          (CC BY 4.0)
        </p>
      </div>
    </Panel>
  );
}
