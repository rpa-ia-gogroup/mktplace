// Periodo da aba Produtos (ML, TikTok e Shopee): atalhos, mes e intervalo livre.
// Os atalhos reusam `presetRange` do filtro global (mesmas janelas, terminando em D-1).
import { intervaloCurto, presetRange } from "./filters/presets.ts";
import type { MonthOption } from "./produtos-tab-transition.ts";

export type AtalhoProdutos = "mes_atual" | "mes_anterior" | "semana_atual" | "semana_passada" | "7d" | "30d";

export interface PeriodoProdutos {
  inicio: string;
  fim: string;
  /** Atalho clicado; null = mes escolhido na lista ou intervalo livre. */
  atalho: AtalhoProdutos | null;
}

export const ATALHOS_PRODUTOS: { valor: AtalhoProdutos; texto: string }[] = [
  { valor: "mes_atual", texto: "Este mês" },
  { valor: "mes_anterior", texto: "Mês passado" },
  { valor: "semana_atual", texto: "Esta semana" },
  { valor: "semana_passada", texto: "Semana passada" },
  { valor: "7d", texto: "Últimos 7 dias" },
  { valor: "30d", texto: "Últimos 30 dias" },
];

export function periodoDoAtalho(atalho: AtalhoProdutos, hoje: Date = new Date()): PeriodoProdutos {
  const r = presetRange(atalho, hoje);
  return { inicio: r.dateFrom, fim: r.dateTo, atalho };
}

function ultimoDia(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
}

/** Mes da lista: o atual e o anterior viram os atalhos (mesma janela); os outros, o mes inteiro. */
export function periodoDoMesProdutos(ym: string, hoje: Date = new Date()): PeriodoProdutos {
  for (const atalho of ["mes_atual", "mes_anterior"] as const) {
    const p = periodoDoAtalho(atalho, hoje);
    if (p.inicio.slice(0, 7) === ym) return p;
  }
  return { inicio: `${ym}-01`, fim: ultimoDia(ym), atalho: null };
}

/** "YYYY-MM" quando o periodo e' um mes (inteiro ou o atual ate D-1); senao null. */
export function mesDoPeriodo(p: PeriodoProdutos): string | null {
  if (p.atalho === "mes_atual" || p.atalho === "mes_anterior") return p.inicio.slice(0, 7);
  return p.inicio.endsWith("-01") && p.fim === ultimoDia(p.inicio.slice(0, 7)) ? p.inicio.slice(0, 7) : null;
}

export function chavePeriodo(p: PeriodoProdutos): string {
  return `${p.inicio}..${p.fim}`;
}

/** Rotulo do escopo: "Últimos 7 dias · 09–15/11", "Out/26" ou "01/10–15/11". */
export function rotuloPeriodo(p: PeriodoProdutos, meses: MonthOption[]): string {
  const atalho = ATALHOS_PRODUTOS.find((a) => a.valor === p.atalho);
  if (atalho) return `${atalho.texto} · ${intervaloCurto(p.inicio, p.fim)}`;
  const mes = mesDoPeriodo(p);
  const rotuloMes = mes ? meses.find((m) => m.value === mes)?.label : null;
  return rotuloMes ?? intervaloCurto(p.inicio, p.fim);
}
