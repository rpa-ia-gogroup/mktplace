"use client";

/**
 * Venda diaria (pecas) dos SKUs slow moving: barras empilhadas por marketplace
 * (Mercado Livre, Shopee, TikTok) + media movel de 7 dias. Carregado por
 * `next/dynamic` para o recharts ficar fora do bundle inicial.
 */
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useTema } from "@/components/theme/ThemeProvider";
import { temaDoGrafico } from "@/lib/chart-theme";
import { fmtNumCurto } from "@/lib/formatters";
import type { Marketplace } from "@/lib/full-slow-moving";

export type PontoSlow = { dia: string; media7: number } & Record<Marketplace, number>;

const rotuloDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const NOME: Record<string, string> = { ML: "Mercado Livre", SP: "Shopee", TT: "TikTok Shop", media7: "Média 7 dias" };

export default function SlowMovingGrafico({ pontos, canais }: { pontos: PontoSlow[]; canais: Marketplace[] }) {
  const tema = temaDoGrafico(useTema().resolvido);
  const cor: Record<Marketplace, string> = { ML: tema.canais.ml, SP: tema.canais.shopee, TT: tema.canais.tiktok };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={pontos} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={tema.grade} vertical={false} />
        <XAxis dataKey="dia" tickFormatter={rotuloDia} tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => fmtNumCurto(v)} />
        <Tooltip
          cursor={{ fill: tema.grade, opacity: 0.5 }}
          contentStyle={{ background: tema.tooltipFundo, border: `1px solid ${tema.tooltipBorda}`, borderRadius: 8, color: tema.tooltipTinta, fontSize: 12 }}
          labelFormatter={(d: string) => rotuloDia(d)}
          formatter={(v: number, nome: string) => [`${int(v)} pç`, NOME[nome] ?? nome]}
        />
        <Legend formatter={(nome: string) => NOME[nome] ?? nome} wrapperStyle={{ fontSize: 12 }} />
        {canais.map((c) => <Bar key={c} dataKey={c} stackId="v" fill={cor[c]} maxBarSize={14} />)}
        <Line dataKey="media7" stroke={tema.total} strokeWidth={2} dot={false} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
