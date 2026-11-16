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
// - Por canal, o GMV entra SO' nos dias em que aquele canal teve Ads > 0
//   (T-0113b). Com o export de Ads parado parte do mes (Shopee de out/26: Ads
//   em 12 de 31 dias), dividir o GMV do mes inteiro pelo Ads de 12 dias inflava
//   o ROAS (Apice: 49,7x; so' nos dias com Ads, ~19,6x).
// - Cobertura: por canal incluido, dias com Ads > 0 (N) sobre o total de dias
//   do periodo (M = linhas recebidas). Se N < M em algum canal, o rotulo diz
//   ("só Shopee, 12 de 31 dias"); com cobertura completa o rotulo nao muda.
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
  /**
   * pt-BR curto: "Mercado Livre + Shopee", "só Shopee"; "" sem canal. Com Ads
   * parcial: "só Shopee, 12 de 31 dias", "Mercado Livre + Shopee (Shopee: 12 de 31 dias)".
   */
  rotulo: string;
  /** Por canal incluido: dias com Ads > 0 e dias do periodo (linhas recebidas). */
  cobertura?: Partial<Record<Marketplace, CoberturaAds>>;
}

export interface CoberturaAds {
  diasComAds: number;
  diasPeriodo: number;
}

const finito = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/**
 * "só Shopee", "Mercado Livre + Shopee"; "" para lista vazia. Com `cobertura`
 * parcial (diasComAds < diasPeriodo) em algum canal, acrescenta os dias:
 * "só Shopee, 12 de 31 dias" ou "Mercado Livre + Shopee (Shopee: 12 de 31 dias)".
 */
export function rotuloCanaisRoas(
  canais: readonly Marketplace[],
  cobertura?: Partial<Record<Marketplace, CoberturaAds>>,
): string {
  if (canais.length === 0) return "";
  const nomes = canais.map((c) => ROTULO_CANAL[c]);
  const base = nomes.length === 1 ? `só ${nomes[0]}` : nomes.join(" + ");
  const parciais = canais.filter((c) => {
    const cob = cobertura?.[c];
    return cob != null && cob.diasComAds < cob.diasPeriodo;
  });
  if (parciais.length === 0) return base;
  const dias = (c: Marketplace) => `${cobertura![c]!.diasComAds} de ${cobertura![c]!.diasPeriodo} dias`;
  if (canais.length === 1) return `${base}, ${dias(canais[0])}`;
  return `${base} (${parciais.map((c) => `${ROTULO_CANAL[c]}: ${dias(c)}`).join("; ")})`;
}

export function roasPorCanaisComAds(
  linhas: readonly LinhaRoasCanal[],
  canaisSelecionados: readonly string[],
): RoasPorCanais {
  let gmv = 0;
  let ads = 0;
  const canais: Marketplace[] = [];
  const cobertura: Partial<Record<Marketplace, CoberturaAds>> = {};

  for (const canal of ORDEM) {
    if (!canaisSelecionados.includes(canal)) continue;
    let adsCanal = 0;
    let gmvCanal = 0;
    let diasComAds = 0;
    for (const l of linhas) {
      const a = l[ADS[canal]];
      // Dia sem Ads (null, 0 ou nao finito) nao entra: nem o Ads nem o GMV.
      if (!finito(a) || !(a > 0)) continue;
      diasComAds += 1;
      adsCanal += a;
      const g = l[GMV[canal]];
      if (finito(g)) gmvCanal += g;
    }
    if (diasComAds === 0 || !(adsCanal > 0)) continue;
    canais.push(canal);
    cobertura[canal] = { diasComAds, diasPeriodo: linhas.length };
    gmv += gmvCanal;
    ads += adsCanal;
  }

  const roas = canais.length > 0 && ads > 0 ? gmv / ads : null;
  return {
    roas: finito(roas) ? roas : null,
    canais,
    rotulo: rotuloCanaisRoas(canais, cobertura),
    cobertura,
  };
}
