/**
 * FULL-UNIFICADO-1 — sub-abas da rota unica `/full`.
 *
 * As quatro telas antigas viraram sub-abas (`/full?aba=...`) e as rotas antigas
 * redirecionam para a aba certa. So' "Desempenho Shopee" tem flag de web
 * (`NEXT_PUBLIC_SHOPEE_FBS_ENABLED`); os estoques perderam a deles em
 * 04/11/2026 (quem decide e' a API) e o Envio ML nunca teve.
 */

export const ABAS_FULL = [
  { chave: "visao-geral", rotulo: "Visão geral" },
  { chave: "estoque-ml", rotulo: "Estoque ML" },
  { chave: "estoque-shopee", rotulo: "Estoque Shopee" },
  { chave: "envio-ml", rotulo: "Envio ML" },
  { chave: "desempenho-shopee", rotulo: "Desempenho Shopee" },
] as const;

export type AbaFull = (typeof ABAS_FULL)[number]["chave"];

export function abasVisiveis(flags: { desempenhoShopee: boolean }) {
  return ABAS_FULL.filter((a) => a.chave !== "desempenho-shopee" || flags.desempenhoShopee);
}

/** Aba pedida na URL; desconhecida ou escondida pela flag cai na visao geral. */
export function resolverAba(
  pedida: string | string[] | undefined,
  visiveis: readonly { chave: AbaFull }[],
): AbaFull {
  const valor = Array.isArray(pedida) ? pedida[0] : pedida;
  return visiveis.find((a) => a.chave === valor)?.chave ?? "visao-geral";
}

export function hrefAba(aba: AbaFull): string {
  return aba === "visao-geral" ? "/full" : `/full?aba=${aba}`;
}
