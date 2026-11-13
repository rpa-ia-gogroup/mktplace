/**
 * Aba CX (menu principal, 04/11/2026) — atendimento ao cliente nos
 * marketplaces: Shopee e, com `?canal=ml`, Mercado Livre (10/11/2026).
 *
 * ALVO-GRADE (12/11/2026): a grade unica das abas. Titulo + selo → canais
 * como abas → filtros → 4 cartoes → Pareto | O que exige atencao → problemas
 * por marca → atendimento por loja → avaliacoes de produto → Mais detalhes.
 *
 * O servidor so' le os filtros da URL; o cabecalho (cujos chips dependem da
 * resposta) e os dados vivem em `CxConteudo`, buscados pelo navegador (a API
 * vive atras do login, via `/torre-api`). Nenhum dado demonstrativo.
 */
import { lerCanalCx, lerFiltrosCx } from "@/lib/cx";
import { ALL_BRAND_KEYS } from "@/lib/filters/brands";

import CxConteudo from "./CxConteudo";
import CxMercadoLivre from "./CxMercadoLivre";
import FiltrosCx from "./FiltrosCx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CxPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filtros = lerFiltrosCx(params, ALL_BRAND_KEYS);
  const canal = lerCanalCx(params);
  // key: o elemento nasce no servidor e entra na lista de filhos da barra da `Aba` (sem ela, o React avisa)
  const barra = <FiltrosCx key="filtros" f={filtros} canal={canal} />;
  // o respiro e a ordem dos blocos sao da `Aba` (ALVO-GRADE), montada por cada canal
  return canal === "ml" ? <CxMercadoLivre filtros={filtros} barra={barra} /> : <CxConteudo filtros={filtros} barra={barra} />;
}
