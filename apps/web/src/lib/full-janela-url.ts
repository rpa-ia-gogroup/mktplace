/**
 * Full (Envio ML e Desempenho Shopee) — a janela de datas na URL. Logica PURA (testada).
 *
 * B2-02 (QA 2026-11-11): "90 dias" mudava a tela, mas nao a URL; o reload voltava
 * para 30 dias e o link nao levava o recorte. A janela vai em `date_from`/`date_to`
 * (os nomes que /financeiro e /pedidos ja' usam), sem tocar nos outros parametros
 * (`?aba=` continua). Valor invalido na URL nunca vira requisicao: cai no padrao.
 */

export interface Janela {
  from: string;
  to: string;
}

/** Janela lida da URL; ausente, incompleta ou invalida (`valida` devolve erro) = `padrao`. */
export function janelaDaUrl(
  search: string,
  padrao: Janela,
  valida: (from: string, to: string) => string | null,
): Janela {
  const p = new URLSearchParams(search);
  const from = p.get("date_from");
  const to = p.get("date_to");
  if (!from || !to || valida(from, to) != null) return padrao;
  return { from, to };
}

/** O mesmo endereco com a janela gravada (`date_from`/`date_to`), preservando o resto. */
export function urlComJanela(href: string, janela: Janela): string {
  const url = new URL(href);
  url.searchParams.set("date_from", janela.from);
  url.searchParams.set("date_to", janela.to);
  return `${url.pathname}${url.search}${url.hash}`;
}
