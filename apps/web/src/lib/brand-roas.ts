// ROAS da Marca 360 por canais COM Ads (T-0113, defeito A1-18).
//
// O defeito: o ROAS do cartao de Ad Spend era `cur.gmv / cur.adSpend`. O
// numerador somava o GMV de TODOS os canais selecionados; o denominador so'
// tinha o Ads dos canais com fonte de Ads no periodo. Canal sem Ads inflava o
// numerador sem contrapartida (Apice: ~248,8x na tela, 10-16x por canal).
//
// A regra aqui: numerador e denominador saem do MESMO conjunto de canais.
// - Entra o canal SELECIONADO que teve Ads > 0 em pelo menos um dia.
// - Ads `null`/ausente (sem fonte) nao e' Ads 0, e nenhum dos dois inclui o
//   canal: sem gasto nao ha retorno sobre gasto.
// - Nenhum canal com Ads => `roas: null` (a tela mostra "—"), nunca 0.
// - O GMV do canal incluido e' o do periodo inteiro, nao so' dos dias com Ads.
//
// Le os campos de Ads POR CANAL (`<canal>_ad_spend`). O `ad_spend` combinado
// da linha diaria NAO e' lido: ele nao diz de que canal veio o gasto, que e'
// justamente o que este calculo precisa saber.
//
// O mesmo helper serve ao periodo atual e ao anterior. Modulo puro (sem React).

import type { Marketplace } from "./mock-data.ts";

/** Ordem canonica da UI (a mesma de `ALL_MARKETPLACES`). */
const ORDEM: readonly Marketplace[] = ["tiktok", "ml", "shopee"];

/** Nomes de exibicao — os mesmos de `CHANNEL_LABEL` em `brand/period-changes.ts` (nao exportado la'). */
const ROTULO_CANAL: Record<Marketplace, string> = {
  tiktok: "TikTok Shop",
  ml: "Mercado Livre",
  shopee: "Shopee",
};

/**
 * Minimo que o calculo le de uma linha diaria. `DailyRow` ja' satisfaz o GMV;
 * os campos de Ads por canal sao opcionais: ausente = sem fonte.
 */
export interface LinhaRoasCanal {
  tiktok_gmv: number | null;
  ml_gmv: number | null;
  shopee_gmv: number | null;
  tiktok_ad_spend?: number | null;
  ml_ad_spend?: number | null;
  shopee_ad_spend?: number | null;
}

const GMV: Record<Marketplace, "tiktok_gmv" | "ml_gmv" | "shopee_gmv"> = {
  tiktok: "tiktok_gmv",
  ml: "ml_gmv",
  shopee: "shopee_gmv",
};

const ADS: Record<Marketplace, "tiktok_ad_spend" | "ml_ad_spend" | "shopee_ad_spend"> = {
  tiktok: "tiktok_ad_spend",
  ml: "ml_ad_spend",
  shopee: "shopee_ad_spend",
};

export interface RoasPorCanais {
  /** Σ GMV ÷ Σ Ads dos canais incluidos; `null` sem canal com Ads. */
  roas: number | null;
  /** Canais que entraram no calculo, na ordem canonica. */
  canais: Marketplace[];
  /** pt-BR curto: "Mercado Livre + Shopee", "só Shopee"; "" sem canal. */
  rotulo: string;
}

const finito = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** "só Shopee", "Mercado Livre + Shopee"; "" para lista vazia. */
export function rotuloCanaisRoas(canais: readonly Marketplace[]): string {
  if (canais.length === 0) return "";
  const nomes = canais.map((c) => ROTULO_CANAL[c]);
  return nomes.length === 1 ? `só ${nomes[0]}` : nomes.join(" + ");
}

export function roasPorCanaisComAds(
  linhas: readonly LinhaRoasCanal[],
  canaisSelecionados: readonly string[],
): RoasPorCanais {
  let gmv = 0;
  let ads = 0;
  const canais: Marketplace[] = [];

  for (const canal of ORDEM) {
    if (!canaisSelecionados.includes(canal)) continue;
    let adsCanal = 0;
    let teveGasto = false;
    let gmvCanal = 0;
    for (const l of linhas) {
      const a = l[ADS[canal]];
      if (finito(a)) {
        adsCanal += a;
        if (a > 0) teveGasto = true;
      }
      const g = l[GMV[canal]];
      if (finito(g)) gmvCanal += g;
    }
    if (!teveGasto || !(adsCanal > 0)) continue;
    canais.push(canal);
    gmv += gmvCanal;
    ads += adsCanal;
  }

  const roas = canais.length > 0 && ads > 0 ? gmv / ads : null;
  return { roas: finito(roas) ? roas : null, canais, rotulo: rotuloCanaisRoas(canais) };
}
