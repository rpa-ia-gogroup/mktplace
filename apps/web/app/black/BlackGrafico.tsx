"use client";

/**
 * Acumulado do dia: meta tracejada, realizado sólido (com área suave) até a
 * última hora fechada e o marcador da hora atual. Carregado por
 * `next/dynamic` (recharts fora do bundle inicial).
 */
import { useEffect, useId, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useTema } from "@/components/theme/ThemeProvider";
import { temaDoGrafico } from "@/lib/chart-theme";
import { fmtBrlCurto } from "@/lib/formatters";
import { rotuloHora, type HoraBlack } from "@/lib/black-hora";

const NOME: Record<string, string> = { metaAcum: "Meta", realizadoAcum: "Realizado" };
/** Ponto da hora h = acumulado ATÉ o fim dela: o eixo mostra a hora em que o acumulado fecha. */
const ateHora = (h: number) => rotuloHora(h + 1);
/** Eixo curto, sem quebra: "1,5 mi", "500 mil". */
const eixoY = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : String(v));

export default function BlackGrafico({ horas, ultimaHora }: { horas: HoraBlack[]; ultimaHora: number }) {
  const tema = temaDoGrafico(useTema().resolvido);
  const grad = useId().replace(/:/g, "");
  const atual = ultimaHora >= 0 ? horas[ultimaHora] : null;
  // Passo fixo no eixo: 3 h no largo, 6 h no celular. O ponto -1 e' o "00h" (acumulado zero).
  const [estreito, setEstreito] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const f = () => setEstreito(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const passo = estreito ? 6 : 3;
  const ticks = Array.from({ length: 24 / passo + 1 }, (_, i) => i * passo - 1);
  const dados = [{ hora: -1, metaAcum: horas[0]?.metaAcum === null ? null : 0, realizadoAcum: horas[0]?.realizadoAcum === null ? null : 0 }, ...horas];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={dados} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tema.total} stopOpacity={0.28} />
            <stop offset="100%" stopColor={tema.total} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={tema.grade} vertical={false} />
        <XAxis dataKey="hora" type="number" domain={[-1, 23]} ticks={ticks} tickFormatter={ateHora} tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} width={60} tickFormatter={eixoY} />
        <Tooltip
          contentStyle={{ background: tema.tooltipFundo, border: `1px solid ${tema.tooltipBorda}`, borderRadius: 8, color: tema.tooltipTinta, fontSize: 12 }}
          labelFormatter={(h: number) => `Até ${ateHora(h)}`}
          formatter={(v: number, nome: string) => [fmtBrlCurto(v), NOME[nome] ?? nome]}
        />
        {atual && <ReferenceLine x={ultimaHora} stroke={tema.eixo} strokeOpacity={0.5} label={{ value: ateHora(ultimaHora), position: "insideTopRight", fill: tema.eixo, fontSize: 11 }} />}
        <Line dataKey="metaAcum" stroke={tema.referencia} strokeWidth={2} strokeDasharray="6 5" dot={false} activeDot={false} type="monotone" isAnimationActive={false} />
        <Area dataKey="realizadoAcum" stroke={tema.total} strokeWidth={2.5} fill={`url(#${grad})`} dot={false} type="monotone" connectNulls={false} isAnimationActive={false} />
        {atual?.realizadoAcum != null && <ReferenceDot x={ultimaHora} y={atual.realizadoAcum} r={4.5} fill={tema.total} stroke={tema.tooltipFundo} strokeWidth={2} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
