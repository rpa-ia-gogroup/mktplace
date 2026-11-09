"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PontoSerie, MetricaSerie } from "@/lib/ml-fulfillment";
import { SEM_DADO, fmtShare } from "@/lib/ml-fulfillment";
import { temaDoGrafico } from "@/lib/chart-theme";
import { useTema } from "@/components/theme/ThemeProvider";

const METRICA_LABEL: Record<MetricaSerie, string> = {
  gmv: "GMV",
  orders: "pedidos",
  units: "unidades",
};

interface Props {
  pontos: PontoSerie[];
  metrica: MetricaSerie;
}

function diaCurto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

interface TooltipEntry {
  payload?: PontoSerie;
}

function CustomTooltip({
  active, payload, metrica,
}: { active?: boolean; payload?: TooltipEntry[]; metrica: MetricaSerie }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="bg-surface border border-line rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-ink">{p.ref_date}</p>
      <p className="text-ink-muted mt-1">
        Share Full ({METRICA_LABEL[metrica]}):{" "}
        <span className="font-semibold tabular-nums">
          {p.share_full === null ? SEM_DADO : fmtShare(p.share_full)}
        </span>
      </p>
      {p.share_full === null && (
        <p className="text-ink-faint mt-1">Sem venda classificada neste dia.</p>
      )}
    </div>
  );
}

/**
 * Tendencia diaria do share de Full.
 *
 * O grafico NAO e' a unica via: abaixo dele vive uma tabela com os mesmos
 * pontos, exposta por `<details>` e navegavel por teclado. Quem usa leitor de
 * tela, quem imprime e quem precisa conferir numero exato chega ao mesmo dado
 * sem depender do SVG.
 *
 * Dias com `share_full = null` (nenhuma venda classificada) ficam com furo na
 * linha em vez de cair a zero -- `connectNulls` desligado de proposito: ligar
 * os pontos inventaria uma queda que nao houve.
 */
export default function MLFulfillmentTrend({ pontos, metrica }: Props) {
  // TEMA-ESCURO: SVG precisa de cor resolvida; a paleta vem do tema, como nos outros graficos.
  const tema = temaDoGrafico(useTema().resolvido);
  if (pontos.length === 0) {
    return (
      <p className="text-sm text-ink-faint py-8 text-center">
        Sem serie diaria para o periodo selecionado.
      </p>
    );
  }

  const comDado = pontos.filter((p) => p.share_full !== null);
  const media =
    comDado.length > 0
      ? comDado.reduce((a, p) => a + (p.share_full ?? 0), 0) / comDado.length
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[280px] w-full" role="img"
        aria-label={
          `Tendencia diaria do share de Full por ${METRICA_LABEL[metrica]}, ` +
          `${pontos.length} dias, media de ${media === null ? SEM_DADO : fmtShare(media)}. ` +
          "Os valores exatos estao na tabela logo abaixo do grafico."
        }>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pontos} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={tema.grade} />
            <XAxis
              dataKey="ref_date"
              tickFormatter={diaCurto}
              tick={{ fontSize: 12, fill: tema.eixo }}
              minTickGap={24}
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 12, fill: tema.eixo }}
              width={48}
            />
            <Tooltip content={<CustomTooltip metrica={metrica} />} />
            <Line animationDuration={450} animationEasing="ease-out"
              type="monotone"
              dataKey="share_full"
              stroke={tema.series[0]}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              name="Share Full"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded min-h-11 flex items-center">
          Ver os valores do gráfico em tabela ({pontos.length} dias)
        </summary>
        <div className="mt-2 max-h-72 overflow-y-auto overflow-x-auto border border-line rounded-lg">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Share diário de Full por {METRICA_LABEL[metrica]}
            </caption>
            <thead className="bg-raised sticky top-0">
              <tr>
                <th scope="col" className="text-left px-3 py-2 font-semibold text-ink-muted">Data</th>
                <th scope="col" className="text-right px-3 py-2 font-semibold text-ink-muted">Share Full</th>
                <th scope="col" className="text-right px-3 py-2 font-semibold text-ink-muted">Full</th>
                <th scope="col" className="text-right px-3 py-2 font-semibold text-ink-muted">Não-Full</th>
              </tr>
            </thead>
            <tbody>
              {pontos.map((p) => (
                <tr key={p.ref_date} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-muted">{p.ref_date}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                    {p.share_full === null ? SEM_DADO : fmtShare(p.share_full)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                    {metrica === "gmv" ? p.full.toFixed(2) : p.full.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                    {metrica === "gmv" ? p.non_full.toFixed(2) : p.non_full.toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
