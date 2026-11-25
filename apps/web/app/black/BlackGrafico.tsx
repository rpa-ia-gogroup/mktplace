"use client";

/**
 * Acumulado do dia, hora a hora: meta (referência, tracejada) x realizado (só
 * até a última hora fechada). Carregado por `next/dynamic` (recharts fora do bundle inicial).
 */
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useTema } from "@/components/theme/ThemeProvider";
import { temaDoGrafico } from "@/lib/chart-theme";
import { fmtBrlCurto, fmtNumCurto } from "@/lib/formatters";
import { rotuloHora, type HoraBlack } from "@/lib/black-hora";

const NOME: Record<string, string> = { metaAcum: "Meta acumulada", realizadoAcum: "Realizado acumulado" };

export default function BlackGrafico({ horas }: { horas: HoraBlack[] }) {
  const tema = temaDoGrafico(useTema().resolvido);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={horas} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={tema.grade} vertical={false} />
        <XAxis dataKey="hora" tickFormatter={rotuloHora} tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => fmtNumCurto(v)} />
        <Tooltip
          contentStyle={{ background: tema.tooltipFundo, border: `1px solid ${tema.tooltipBorda}`, borderRadius: 8, color: tema.tooltipTinta, fontSize: 12 }}
          labelFormatter={(h: number) => `Até ${rotuloHora(h + 1 === 24 ? 0 : h + 1)}${h + 1 === 24 ? " (fim do dia)" : ""}`}
          formatter={(v: number, nome: string) => [fmtBrlCurto(v), NOME[nome] ?? nome]}
        />
        <Legend formatter={(nome: string) => NOME[nome] ?? nome} wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="metaAcum" stroke={tema.referencia} strokeWidth={2} strokeDasharray="5 4" dot={false} type="monotone" isAnimationActive={false} />
        <Line dataKey="realizadoAcum" stroke={tema.total} strokeWidth={2.5} dot={false} type="monotone" connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
