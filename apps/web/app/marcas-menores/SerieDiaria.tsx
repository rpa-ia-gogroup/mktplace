"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTema } from "@/components/theme/ThemeProvider";
import { temaDoGrafico } from "@/lib/chart-theme";
import { corDaPlataforma, nomeDaPlataforma, plataformasDaSerie, type MarcaMenor } from "@/lib/marcas-menores";
import { fmtCompacto } from "@/lib/metas";

// Eixo curto e sem arredondar para "mil" inteiro: 7,5k nao pode virar "8 mil".
const eixoY = (v: number) =>
  v === 0 ? "0" : v >= 1e6 ? `${+(v / 1e6).toFixed(1)} mi`.replace(".", ",") : `${+(v / 1e3).toFixed(1)}k`.replace(".", ",");
const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Faturamento por dia, empilhado por plataforma. Só os dias com dado: dia sem linha não vira barra de zero. */
export default function SerieDiaria({ marca }: { marca: MarcaMenor }) {
  const tema = temaDoGrafico(useTema().resolvido);
  const plats = plataformasDaSerie(marca);
  const dados = marca.serie.map((d) => ({ dia: d.data, ...d.por_plataforma }));
  const resumo = marca.serie.map((d) => `${dd(d.data)} ${fmtCompacto(d.faturamento)}`).join("; ");
  return (
    <div role="img" aria-label={`Faturamento diário de ${marca.label}. ${resumo}`} className="h-36">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={tema.grade} strokeDasharray="3 3" />
          <XAxis dataKey="dia" tickFormatter={dd} tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tickFormatter={eixoY} tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            cursor={{ fill: tema.grade, opacity: 0.45 }}
            labelFormatter={(l) => dd(String(l))}
            formatter={(v: unknown, nome: unknown) => [fmtCompacto(typeof v === "number" ? v : null), nomeDaPlataforma(String(nome))]}
            contentStyle={{ background: tema.tooltipFundo, border: `1px solid ${tema.tooltipBorda}`, borderRadius: 8, fontSize: 12, color: tema.tooltipTinta }}
            labelStyle={{ color: tema.tooltipTinta, fontWeight: 600 }}
          />
          {plats.map((p) => (
            <Bar key={p} dataKey={p} stackId="d" fill={corDaPlataforma(p)} maxBarSize={22} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
