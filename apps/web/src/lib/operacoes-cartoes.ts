/**
 * Operacoes — Velocidade ML no padrao da Gerencial. Logica PURA (testada): a regra
 * de leitura do ROAS e' a que ja' existia na tela (< 3x com gasto = baixo, >= 8x =
 * bom, resto = atencao); so' passou do literal de cor para o tom do cartao.
 * Ausencia nunca vira zero: ROAS sem valor mostra "—".
 */
import { fmtBrlCurto, fmtNumCurto, fmtVezes } from "./formatters.ts";

export type TomRoas = "critico" | "bom" | "atencao" | "ausente";

export interface LeituraRoas {
  /** "ROAS baixo": abaixo de 3x E com gasto no periodo. */
  baixo: boolean;
  tom: TomRoas;
  texto: string;
}

export function leituraRoas(roas7d: number | null, adSpend7d: number): LeituraRoas {
  if (roas7d == null) return { baixo: false, tom: "ausente", texto: "—" };
  const baixo = roas7d < 3 && adSpend7d > 0;
  const tom: TomRoas = baixo ? "critico" : roas7d >= 8 ? "bom" : "atencao";
  return { baixo, tom, texto: fmtVezes(roas7d) };
}

export interface LinhaVelocidade {
  brand: string;
  gmv_7d: number;
  ad_spend_7d: number;
  roas_7d: number | null;
  orders_7d: number;
}

/** Os 4 valores do grupo de uma marca, no formato da casa. */
export function valoresVelocidade(r: LinhaVelocidade) {
  return {
    gmv: fmtBrlCurto(r.gmv_7d),
    adSpend: fmtBrlCurto(r.ad_spend_7d),
    roas: leituraRoas(r.roas_7d, r.ad_spend_7d),
    pedidos: fmtNumCurto(r.orders_7d),
  };
}
