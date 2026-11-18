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
  gerado_em: string;
  dias: number;
  inicio: string;
  fim: string;
  marcas: MarcaTikTok[];
  motivos: MotivoTikTok[];
}

/** A 1a leitura da janela pagina a API do TikTok por marca: pode passar de 1 min (depois, cache de 10 min). */
export const TIMEOUT_TIKTOK_MS = 240_000;

export function urlCxTikTok(base: string, f: FiltrosCx): string {
  const qs = new URLSearchParams({ dias: String(f.dias) });
  if (f.marca) qs.set("brands", f.marca);
  return `${base}/api/v1/cx/tiktok?${qs.toString()}`;
}

export type ResultadoTikTok = { ok: true; dados: CxTikTokResponse } | { ok: false; motivo: string };

export async function carregarCxTikTok(f: FiltrosCx, fetchImpl: typeof fetch = fetch, base: string = API_URL): Promise<ResultadoTikTok> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_TIKTOK_MS);
  try {
    const res = await fetchImpl(urlCxTikTok(base, f), { cache: "no-store", signal: controle.signal });
    if (!res.ok) return { ok: false, motivo: `A API respondeu ${res.status}.` };
    const j = (await res.json()) as CxTikTokResponse;
    if (!j || !Array.isArray(j.marcas) || !Array.isArray(j.motivos)) return { ok: false, motivo: "Resposta inválida da API." };
    return { ok: true, dados: j };
  } catch {
    return { ok: false, motivo: controle.signal.aborted ? "O TikTok demorou demais para responder. Tente de novo." : "Não foi possível contatar a API." };
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
