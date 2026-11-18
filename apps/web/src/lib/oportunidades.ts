/**
 * OPORTUNIDADES-1 — contrato do top de oportunidades (API /api/v1/performance/oportunidades).
 * R$ em 30 dias; nada e' somado entre itens.
 */
import { torreFetch } from "./torre-fetch.ts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface Oportunidade {
  tipo: "ruptura_full" | "capital_parado";
  canal: string | null;
  marca: string;
  sku: string | null;
  titulo: string;
  valor_30d: number;
  acao: string;
  motivo: string;
}

export interface OportunidadesResponse {
  dias: number;
  geral: Oportunidade[];
  por_marca: Record<string, Oportunidade[]>;
  fontes_indisponiveis: string[];
}

export const ROTULO_TIPO: Record<Oportunidade["tipo"], string> = {
  ruptura_full: "ruptura no Full",
  capital_parado: "capital parado",
};

export function queryOportunidades(brands: readonly string[]): string {
  const qs = new URLSearchParams();
  brands.forEach((b) => qs.append("brands", b));
  return qs.toString();
}

export async function fetchOportunidades(brands: readonly string[], signal?: AbortSignal): Promise<OportunidadesResponse> {
  const q = queryOportunidades(brands);
  const res = await torreFetch(`${API_URL}/api/v1/performance/oportunidades${q ? `?${q}` : ""}`, { signal });
  if (!res.ok) throw new Error("Oportunidades indisponíveis.");
  return (await res.json()) as OportunidadesResponse;
}
