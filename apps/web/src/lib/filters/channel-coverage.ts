/**
 * T-0089 — canal selecionado no filtro global que a fonte da visao nao cobre.
 *
 * Desde que todas as telas abrem com os tres canais, uma visao cuja fonte so'
 * tem parte deles (CX so' Shopee, Pedidos sem Shopee...) nao pode deixar o
 * canal de fora calado nem mostra-lo como 0: sem dado nao e' zero. O aviso diz
 * qual canal esta sem dado e o que os numeros mostram, sempre a partir da
 * SELECAO ATUAL — nunca cita canal que o usuario nao escolheu (achado B1-05:
 * "Shopee fora: so' TikTok e ML" aparecia com o filtro ML + Shopee).
 */
import { ALL_MARKETPLACES } from "../marketplace-filter.ts";
import type { Marketplace } from "../mock-data.ts";

const ROTULO: Record<Marketplace, string> = {
  tiktok: "TikTok Shop",
  ml: "Mercado Livre",
  shopee: "Shopee",
};

/** "A", "A e B", "A, B e C". */
function lista(canais: readonly Marketplace[]): string {
  const nomes = canais.map((c) => ROTULO[c]);
  return nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Canais selecionados que a fonte da visao nao cobre, na ordem canonica. */
export function canaisSemDadoNaVisao(
  selecao: readonly Marketplace[],
  cobertos: readonly Marketplace[],
): Marketplace[] {
  return ALL_MARKETPLACES.filter((c) => selecao.includes(c) && !cobertos.includes(c));
}

/**
 * Texto do aviso, ou `null` quando todo canal selecionado tem dado (nada a
 * avisar). Ex.: "TikTok Shop sem dado nesta visão · mostrando só Shopee".
 * Quando nenhum canal selecionado e' coberto, so' a primeira parte: a tela
 * ja' mostra o estado vazio dela.
 */
export function avisoCanaisSemDado(
  selecao: readonly Marketplace[],
  cobertos: readonly Marketplace[],
): string | null {
  const sem = canaisSemDadoNaVisao(selecao, cobertos);
  if (sem.length === 0) return null;
  const com = ALL_MARKETPLACES.filter((c) => selecao.includes(c) && cobertos.includes(c));
  const texto = `${lista(sem)} sem dado nesta visão`;
  return com.length ? `${texto} · mostrando só ${lista(com)}` : texto;
}
