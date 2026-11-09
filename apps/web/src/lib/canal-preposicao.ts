/**
 * Preposicao certa antes do nome do canal. "no Shopee" e' agramatical: a
 * Shopee e' feminina; o Mercado Livre (ML) e o TikTok Shop, masculinos.
 * Todo texto montado com o canal ("no X", "do X") passa por aqui, em vez de
 * fixar "no" ou "da" na frase.
 *
 * O genero vem do ID do canal, nao do rotulo: "ML", "Mercado Livre" e
 * "TikTok Shop" mudam de tela para tela; o canal nao.
 */
const FEMININOS: ReadonlySet<string> = new Set(["shopee"]);

/** "no ML", "na Shopee", "no TikTok Shop". */
export function noCanal(canal: string, rotulo: string): string {
  return `${FEMININOS.has(canal) ? "na" : "no"} ${rotulo}`;
}

/** "do ML", "da Shopee", "do TikTok Shop". */
export function doCanal(canal: string, rotulo: string): string {
  return `${FEMININOS.has(canal) ? "da" : "do"} ${rotulo}`;
}
