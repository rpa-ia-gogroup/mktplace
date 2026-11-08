"use client";

/**
 * Linha do ticket medio (R$ por peca) no detalhe de um produto do Top. Irma do
 * `TopProdutoGrafico`: mesmas barras/agrupamento, carregada por `next/dynamic`.
 * Barra sem venda = ponto ausente (`null`), e a linha quebra -- nunca zero.
 */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { temaDoGrafico } from "@/lib/chart-theme";
import { useTema } from "@/components/theme/ThemeProvider";
import { fmtBrlCurto } from "@/lib/formatters";
import { eixoTicket, ticketMedio, type Barra, type CanalTop } from "@/lib/gerencial/top-produtos";

export default function TopProdutoTicket({ barras, canal }: { barras: Barra[]; canal: CanalTop }) {
  const tema = temaDoGrafico(useTema().resolvido);
  const dados = barras.map((b) => ({ rotulo: b.rotulo, ticket: ticketMedio(b) }));
  const cor = tema.canais[canal];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dados} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={tema.grade} vertical={false} />
        <XAxis dataKey="rotulo" tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} minTickGap={12} />
        <YAxis tick={{ fontSize: 12, fill: tema.eixo }} axisLine={false} tickLine={false} width={72} tickFormatter={(v: number) => fmtBrlCurto(v)} {...eixoTicket(dados.map((d) => d.ticket))} />
        <Tooltip
          contentStyle={{ background: tema.tooltipFundo, border: `1px solid ${tema.tooltipBorda}`, borderRadius: 8, color: tema.tooltipTinta, fontSize: 12 }}
          formatter={(v: number) => [fmtBrlCurto(v), "Ticket médio"]}
        />
        {/* `dot` deixa visivel o ponto isolado entre duas barras sem venda. */}
        <Line type="monotone" dataKey="ticket" stroke={cor} strokeWidth={2} dot={{ r: 2.5, fill: cor, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
