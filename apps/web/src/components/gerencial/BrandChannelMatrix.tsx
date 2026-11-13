"use client";

/**
 * Matriz Marca x Canal (Gate V2-1, Task H; completada na rodada consolidada,
 * Tasks B.2, B.4 e C).
 *
 * Intensidade e participacao calculadas DENTRO de cada canal — nunca entre
 * canais, cujas ordens de grandeza produziriam comparacao falsa.
 *
 * Duas fontes, dois estados: o GMV/share/variacao vem de `/brands`; os SINAIS e
 * as referencias comparativas vem de `/canais`. Por isso a matriz tem estado
 * PARCIAL: com `/brands` fresco e `/canais` em falha, a grade de GMV continua
 * inteira e apenas os sinais sao declarados indisponiveis. Somente um erro de
 * `/brands` impede a matriz toda.
 *
 * Alvos clicaveis, sem aninhamento: a celula e' um `<button>` e os chips de
 * sinal dentro dela sao `<span>` — o nome acessivel da celula ja anuncia os
 * sinais, e a explicacao completa vive no dialogo comparativo.
 */
import Link from "next/link";
import InfoDica from "@/components/ui/InfoDica";
import CelulaBarra from "@/components/ui/CelulaBarra";
import TableScrollHint from "@/components/TableScrollHint";
import DataQualityNote from "@/components/drilldown/DataQualityNote";
import type { BrandChannelMatrix as MatrixData, MatrixCell } from "@/lib/gerencial/brand-matrix";
import { CHANNEL_LABEL } from "@/lib/gerencial/kpi-band";
import { signalLabel } from "@/lib/canais-channel-metrics";
import { fmtBrlCurto, fmtPctBr } from "@/lib/formatters";

/** Estado da fonte de sinais/referencias (`/canais`), independente de `/brands`. */
export type SignalsState = "fresh" | "loading" | "error";

interface Props {
  matrix: MatrixData;
  loading: boolean;
  error: boolean;
  /** Sinais por celula, chaveados por `${brand}:${channel}`. */
  signalsByCell: Record<string, string[]>;
  signalsState: SignalsState;
  onOpenCell: (brand: string, channel: MatrixCell["channel"]) => void;
  onOpenChannelHeader: (channel: MatrixCell["channel"]) => void;
  brandHref: (brand: string) => string;
  onRetry: () => void;
}

export function cellKey(brand: string, channel: string): string {
  return `${brand}:${channel}`;
}

/** Cor de identidade de cada canal (as mesmas dos pontos e do grafico), para o mapa de calor. */
const RGB_DO_CANAL: Record<MatrixCell["channel"], string> = { tiktok: "139, 92, 246", ml: "6, 182, 212", shopee: "249, 115, 22" };

/** Nome acessivel da celula — inclui os sinais para que o foco os anuncie. */
function cellAriaLabel(
  brandLabel: string,
  cell: MatrixCell,
  signals: string[],
  signalsState: SignalsState,
): string {
  const base = `${brandLabel} em ${CHANNEL_LABEL[cell.channel]}`;
  if (!cell.available) return `${base} — sem dado no período, abrir explicação`;
  const parts = [base];
  if (signals.length > 0) {
    parts.push(`sinais: ${signals.map(signalLabel).join(", ")}`);
  } else if (signalsState === "error") {
    parts.push("sinais indisponíveis nesta carga");
  }
  parts.push("abrir explicação");
  return parts.join(" — ");
}

export default function BrandChannelMatrix({
  matrix,
  loading,
  error,
  signalsByCell,
  signalsState,
  onOpenCell,
  onOpenChannelHeader,
  brandHref,
  onRetry,
}: Props) {
  if (loading) {
    return (
      <section
        className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 animate-pulse"
        role="status"
        aria-busy="true"
      >
        <span className="sr-only">Carregando matriz marca × canal…</span>
        <div className="h-3 w-52 bg-accent-soft rounded" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-8 w-full bg-accent-soft rounded" />
        ))}
      </section>
    );
  }

  // Somente erro de /brands impede a matriz inteira.
  if (error) {
    return (
      <section className="bg-raised border border-line rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink-muted">Marca × Canal</h2>
          <p className="text-xs text-ink-faint">
            Desempenho por marca indisponível nesta carga. Os demais blocos do período seguem exibidos.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-ink-muted border border-line-strong rounded-lg px-3 min-h-11 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Tentar novamente
        </button>
      </section>
    );
  }

  if (matrix.rows.length === 0 || matrix.channels.length === 0) {
    return (
      <section className="bg-surface border border-line rounded-xl p-4">
        <h2 className="text-sm font-semibold text-ink-muted mb-1">Marca × Canal</h2>
        <p className="text-xs text-ink-faint">Sem marcas com dado no período e filtros selecionados.</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="matriz-heading"
      className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <h2 id="matriz-heading" className="text-[15px] font-semibold text-ink">
            Marca × Canal
          </h2>
          <InfoDica texto="A barra sob cada valor é o peso da marca dentro do canal. A célula abre a marca no canal, com sinais e referências; o nome do canal abre a distribuição entre as marcas." />
        </div>
      </div>

      <TableScrollHint>
        <table className="w-full min-w-[680px] border-collapse">
          <caption className="sr-only">
            GMV por marca e canal no período, com participação dentro do canal, variação contra o período
            anterior e sinais de eficiência. Cada célula abre a explicação da marca no canal; cada cabeçalho de
            canal abre a distribuição daquele canal entre as marcas.
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="text-left py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Marca
              </th>
              {matrix.channels.map((channel) => (
                <th key={channel} scope="col" className="py-1 px-1">
                  <button
                    type="button"
                    onClick={() => onOpenChannelHeader(channel)}
                    aria-haspopup="dialog"
                    aria-label={`${CHANNEL_LABEL[channel]} — abrir distribuição do canal entre as marcas`}
                    className="w-full min-h-11 text-right rounded-lg px-2 py-1 hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
                  >
                    <span className="block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      {CHANNEL_LABEL[channel]}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Total
              </th>
              <th scope="col" className="text-right py-2 pl-3 text-xs font-semibold uppercase tracking-wide text-ink-faint whitespace-nowrap">
                vs anterior
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.brand} className="border-b border-line transition-colors duration-[120ms] hover:bg-raised">
                <th scope="row" className="text-left py-1.5 pr-3 align-middle">
                  <Link
                    href={brandHref(row.brand)}
                    className="inline-flex items-center min-h-11 text-sm font-semibold text-ink-muted hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  >
                    {row.label}
                  </Link>
                </th>

                {row.cells.map((cell) => {
                  const signals = signalsByCell[cellKey(row.brand, cell.channel)] ?? [];
                  return (
                    <td key={cell.channel} className="py-1.5 px-1 align-middle">
                      <button
                        type="button"
                        onClick={() => onOpenCell(row.brand, cell.channel)}
                        aria-haspopup="dialog"
                        aria-label={cellAriaLabel(row.label, cell, signals, signalsState)}
                        className="w-full min-w-0 min-h-11 rounded-lg px-2 py-1 text-right transition-colors hover:ring-1 hover:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {cell.available ? (
                          <CelulaBarra valor={fmtBrlCurto(cell.gmv as number)} peso={cell.intensity} cor={`rgb(${RGB_DO_CANAL[cell.channel]})`} />
                        ) : (
                          <span className="block text-sm text-ink-faint">—</span>
                        )}
                      </button>
                    </td>
                  );
                })}

                <td className="py-1.5 px-3 text-right align-middle text-sm font-semibold text-ink tabular-nums">
                  {fmtBrlCurto(row.brandTotal)}
                </td>
                <td className="py-1.5 pl-3 text-right align-middle">
                  <Variacao pct={row.brandMomPct} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-sm font-semibold text-ink tabular-nums">
              <th scope="row" className="py-2.5 pr-3 text-left text-xs uppercase tracking-wide text-ink-faint">
                Total
              </th>
              {matrix.channels.map((channel) => (
                <td
                  key={channel}
                  className="py-2.5 px-3 text-right"
                  title={matrix.channelMomPct[channel] != null ? `${fmtPctBr(matrix.channelMomPct[channel] as number)} vs anterior` : undefined}
                >
                  {fmtBrlCurto(matrix.channelTotals[channel] ?? 0)}
                </td>
              ))}
              <td className="py-2.5 px-3 text-right">{fmtBrlCurto(matrix.grandTotal)}</td>
              <td className="py-2.5 pl-3 text-right">
                <Variacao pct={matrix.grandMomPct} />
              </td>
            </tr>
          </tfoot>
        </table>
      </TableScrollHint>

      {/* Estado PARCIAL: o GMV veio, os sinais nao. A matriz nao se apresenta
          como completa. */}
      {signalsState === "error" && (
        <DataQualityNote note="Sinais de eficiência e referências comparativas (mediana e p75 do canal) indisponíveis nesta carga — a matriz mostra GMV, participação e variação, mas não está completa." />
      )}
      {signalsState === "loading" && (
        <p className="text-xs text-ink-faint">Verificando sinais de eficiência e referências do canal…</p>
      )}
    </section>
  );
}

/** Variacao contra o periodo anterior: uma coluna so', sinal e cor. Sem base, travessao. */
function Variacao({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-sm text-ink-faint">—</span>;
  return <span className={`text-sm font-medium tabular-nums ${pct >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>{fmtPctBr(pct)}</span>;
}
