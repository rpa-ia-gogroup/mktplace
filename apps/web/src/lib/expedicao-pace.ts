/**
 * Pace de despacho: "quantos dias o backlog dura" = backlog / media de
 * despachados por dia nos 2 ultimos dias uteis fechados.
 *
 * A API (`/api/v1/expedicao/despachados`) publica a media; a divisao e' feita
 * aqui, sobre o backlog que a tabela ja' mostra. Sem dado = `null` ("—"),
 * nunca zero nem infinito.
 */

export type CanalPace = "shopee" | "mercadolivre";

export interface ContaPace {
  channel: string;
  brand: string;
  media_2du: number | null;
}

export interface RespostaPace {
  availability: string;
  contas: ContaPace[];
}

export function urlPace(api: string, canal: CanalPace): string {
  return `${api}/api/v1/expedicao/despachados?${new URLSearchParams({ channel: canal }).toString()}`;
}

/** Media de despachados/dia da marca no canal, ou `null` se a API nao trouxe. */
export function mediaDaMarca(r: RespostaPace | null, canal: string, marca: string): number | null {
  if (!r || r.availability !== "available") return null;
  const c = r.contas.find((x) => x.channel === canal && x.brand === marca);
  return typeof c?.media_2du === "number" ? c.media_2du : null;
}

/** Dias que o backlog dura no pace atual; `null` sem backlog valido ou sem pace. */
export function diasDeBacklog(backlog: number | null | undefined, media: number | null | undefined): number | null {
  if (typeof backlog !== "number" || typeof media !== "number") return null;
  if (!Number.isFinite(backlog) || !Number.isFinite(media) || media <= 0 || backlog < 0) return null;
  return backlog / media;
}
