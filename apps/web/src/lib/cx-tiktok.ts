/**
 * CX do TikTok Shop direto da Open API (rota `GET /api/v1/cx/tiktok`): devolucoes e cancelamentos
 * da janela por motivo, marca e SKU. Nao pago (o TikTok cancela sozinho) vem a' parte, fora do Pareto.
 */
import type { FiltrosCx } from "./cx.ts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface MarcaTikTok {
  marca: string;
  estado: "dado" | "sem_permissao" | "erro" | "nao_autorizada";
  motivo: string | null;
  truncado?: boolean;
  devolucoes?: number;
  reembolsado?: number;
  cancelamentos?: number;
  nao_pagos?: number;
  cancelamentos_comprador?: number;
  /** Data Mart (gold.tiktok_brand_daily): base das taxas. Ausente = sem taxa, nunca 0. */
  pedidos?: number | null;
  faturamento?: number | null;
}

export interface MotivoTikTok {
  tipo: "Devolução" | "Cancelamento";
  motivo: string;
  quantidade: number;
  autor: string | null;
  marcas: { marca: string; quantidade: number }[];
  skus: { marca: string; sku: string; produto: string | null; quantidade: number }[];
}

export interface CxTikTokResponse {
  /** A API ainda esta' lendo o TikTok em 2o plano: perguntar de novo em alguns segundos. */
  carregando?: boolean;
  gerado_em: string;
  dias: number;
  inicio: string;
  fim: string;
  marcas: MarcaTikTok[];
  motivos: MotivoTikTok[];
}

/** Cada pergunta e' rapida (a API nunca espera o TikTok); a 1a leitura da janela vem por repeticao. */
export const TIMEOUT_TIKTOK_MS = 30_000;
export const INTERVALO_TIKTOK_MS = 5_000;
export const MAX_TENTATIVAS_TIKTOK = 60; // ~5 min

export function urlCxTikTok(base: string, f: FiltrosCx): string {
  const qs = new URLSearchParams({ dias: String(f.dias) });
  if (f.marca) qs.set("brands", f.marca);
  return `${base}/api/v1/cx/tiktok?${qs.toString()}`;
}

export type ResultadoTikTok = { ok: true; dados: CxTikTokResponse } | { ok: false; motivo: string };

/** Pergunta ate' a API terminar de ler o TikTok (`carregando`), esperando `esperar` entre as tentativas. */
export async function carregarCxTikTok(
  f: FiltrosCx,
  fetchImpl: typeof fetch = fetch,
  base: string = API_URL,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  vivo: () => boolean = () => true,
): Promise<ResultadoTikTok> {
  for (let n = 0; n < MAX_TENTATIVAS_TIKTOK && vivo(); n++) {
    const r = await umaVezTikTok(f, fetchImpl, base);
    if (!r.ok || !r.dados.carregando) return r;
    await esperar(INTERVALO_TIKTOK_MS);
  }
  return { ok: false, motivo: "O TikTok está demorando para responder. Tente de novo em alguns minutos." };
}

async function umaVezTikTok(f: FiltrosCx, fetchImpl: typeof fetch, base: string): Promise<ResultadoTikTok> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_TIKTOK_MS);
  try {
    const res = await fetchImpl(urlCxTikTok(base, f), { cache: "no-store", signal: controle.signal });
    if (!res.ok) return { ok: false, motivo: `A API respondeu ${res.status}.` };
    const j = (await res.json()) as CxTikTokResponse;
    if (!j || !Array.isArray(j.marcas) || !Array.isArray(j.motivos)) return { ok: false, motivo: "Resposta inválida da API." };
    return { ok: true, dados: j };
  } catch {
    return { ok: false, motivo: controle.signal.aborted ? "A API demorou demais para responder. Tente de novo." : "Não foi possível contatar a API." };
  } finally {
    clearTimeout(timer);
  }
}

export interface ResumoTikTok {
  devolucoes: number;
  reembolsado: number;
  cancelamentos: number;
  naoPagos: number;
  comprador: number;
  comDado: MarcaTikTok[];
  semDado: MarcaTikTok[];
  parcial: boolean;
}

export function resumoTikTok(d: CxTikTokResponse): ResumoTikTok {
  const comDado = d.marcas.filter((m) => m.estado === "dado");
  const soma = (k: keyof MarcaTikTok) => comDado.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  return {
    devolucoes: soma("devolucoes"),
    reembolsado: soma("reembolsado"),
    cancelamentos: soma("cancelamentos"),
    naoPagos: soma("nao_pagos"),
    comprador: soma("cancelamentos_comprador"),
    comDado,
    semDado: d.marcas.filter((m) => m.estado !== "dado"),
    parcial: comDado.some((m) => m.truncado),
  };
}

/** Itens do Pareto (o mesmo formato do PainelPareto da Shopee/ML). */
export function itensParetoTikTok(d: CxTikTokResponse, max = 12) {
  const total = d.motivos.reduce((a, m) => a + m.quantidade, 0) || 1;
  const maior = d.motivos[0]?.quantidade || 1;
  let acc = 0;
  return d.motivos.slice(0, max).map((m) => {
    acc += m.quantidade;
    return {
      chave: `${m.tipo}:${m.motivo}`,
      rotulo: m.motivo,
      tipo: m.tipo,
      natureza: m.tipo === "Cancelamento" ? (m.autor ?? "Plataforma") : "Comprador",
      quantidade: m.quantidade.toLocaleString("pt-BR"),
      pct: `${((m.quantidade / total) * 100).toFixed(1).replace(".", ",")}%`,
      acumulado: `${((acc / total) * 100).toFixed(0)}%`,
      largura: (m.quantidade / maior) * 100,
      mapeado: true,
      bruto: m,
    };
  });
}

// ---------------------------------------------------------------------------
// Taxas no mesmo padrao da Shopee/ML: % dos pedidos do periodo (Data Mart), por marca e no total
// ---------------------------------------------------------------------------
export type IndicadorTikTok = "cancelamento" | "devolucao" | "reembolso" | "naoPago";

const taxa = (n: number | undefined, base: number | null | undefined) => (n == null || !base ? null : (n / base) * 100);

export interface LinhaTikTok {
  chave: string;
  pedidos: number | null;
  faturamento: number | null;
  n: Record<IndicadorTikTok, number>;
  taxa: Record<IndicadorTikTok, number | null>;
  parcial: boolean;
}

/** Uma linha por marca com dado. Reembolso = R$ reembolsado ÷ faturamento; os demais = contagem ÷ pedidos. */
export function linhasTikTok(d: CxTikTokResponse): LinhaTikTok[] {
  return d.marcas
    .filter((m) => m.estado === "dado")
    .map((m) => {
      const pedidos = m.pedidos ?? null;
      const n = { cancelamento: m.cancelamentos ?? 0, devolucao: m.devolucoes ?? 0, reembolso: m.reembolsado ?? 0, naoPago: m.nao_pagos ?? 0 };
      return {
        chave: m.marca, pedidos, faturamento: m.faturamento ?? null, n, parcial: !!m.truncado,
        taxa: { cancelamento: taxa(n.cancelamento, pedidos), devolucao: taxa(n.devolucao, pedidos), reembolso: taxa(n.reembolso, m.faturamento), naoPago: taxa(n.naoPago, pedidos) },
      };
    });
}

/** Total so' com as marcas que tem a base (pedidos/faturamento): taxa nunca mistura marca sem base. */
export function totalTikTok(ls: LinhaTikTok[]): LinhaTikTok {
  const com = ls.filter((l) => l.pedidos);
  const soma = (f: (l: LinhaTikTok) => number) => com.reduce((a, l) => a + f(l), 0);
  const pedidos = com.length ? soma((l) => l.pedidos ?? 0) : null;
  const comFat = ls.filter((l) => l.faturamento);
  const faturamento = comFat.length ? comFat.reduce((a, l) => a + (l.faturamento ?? 0), 0) : null;
  const n = { cancelamento: soma((l) => l.n.cancelamento), devolucao: soma((l) => l.n.devolucao), reembolso: comFat.reduce((a, l) => a + l.n.reembolso, 0), naoPago: soma((l) => l.n.naoPago) };
  return {
    chave: "total", pedidos, faturamento, n, parcial: ls.some((l) => l.parcial),
    taxa: { cancelamento: taxa(n.cancelamento, pedidos), devolucao: taxa(n.devolucao, pedidos), reembolso: taxa(n.reembolso, faturamento), naoPago: taxa(n.naoPago, pedidos) },
  };
}

/** "O que exige atenção": marca acima de 1,5x a taxa do grupo, marca sem dado e leitura parcial. */
export function atencaoTikTok(d: CxTikTokResponse, rotulo: (m: string) => string) {
  const ls = linhasTikTok(d);
  const t = totalTikTok(ls);
  const itens: { chave: string; severidade: "critico" | "atencao" | "info"; titulo: string; detalhe?: string }[] = [];
  const nome: Record<IndicadorTikTok, string> = { cancelamento: "Cancelamento", devolucao: "Devolução", reembolso: "Reembolso", naoPago: "Não pago" };
  for (const l of ls) {
    for (const i of ["cancelamento", "devolucao", "reembolso"] as const) {
      const v = l.taxa[i], g = t.taxa[i];
      if (v != null && g != null && g > 0 && v >= g * 1.5) {
        itens.push({ chave: `${l.chave}:${i}`, severidade: v >= g * 2 ? "critico" : "atencao",
          titulo: `${rotulo(l.chave)}: ${nome[i].toLowerCase()} em ${v.toFixed(1).replace(".", ",")}%`,
          detalhe: `${(v / g).toFixed(1).replace(".", ",")}x a média do grupo (${g.toFixed(1).replace(".", ",")}%)` });
      }
    }
  }
  for (const m of d.marcas.filter((x) => x.estado !== "dado")) {
    itens.push({ chave: `${m.marca}:sem`, severidade: "info", titulo: `${rotulo(m.marca)}: sem dado do TikTok agora`, detalhe: m.motivo ?? undefined });
  }
  for (const l of ls.filter((x) => x.parcial)) {
    itens.push({ chave: `${l.chave}:parcial`, severidade: "info", titulo: `${rotulo(l.chave)}: leitura parcial`, detalhe: "Dias ainda por ler; completa na próxima atualização." });
  }
  const ordem = { critico: 0, atencao: 1, info: 2 };
  return itens.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);
}
