/**
 * Aba CX (menu principal, 04/11/2026) — atendimento ao cliente nos
 * marketplaces: Shopee e, com `?canal=ml`, Mercado Livre (10/11/2026).
 *
 * CX-IDENTIDADE (08/11/2026): mesma identidade da Gerencial. Cabecalho com
 * chips → heroi (taxa de resposta) → faixa de KPIs → "O que exige atencao
 * agora" → por que (Pareto | problemas por marca) → atendimento por loja →
 * avaliacoes de produto → Mais detalhes. (O CX do site saiu em 09/11.)
 *
 * O servidor so' le os filtros da URL; o cabecalho (cujos chips dependem da
 * resposta) e os dados vivem em `CxConteudo`, buscados pelo navegador (a API
 * vive atras do login, via `/torre-api`). Nenhum dado demonstrativo.
 */
import PageContainer from "@/components/layout/PageContainer";
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
  const barra = <FiltrosCx f={filtros} canal={canal} />;
  return (
    <PageContainer>
      {canal === "ml" ? <CxMercadoLivre filtros={filtros} barra={barra} /> : <CxConteudo filtros={filtros} barra={barra} />}
    </PageContainer>
  );
}
