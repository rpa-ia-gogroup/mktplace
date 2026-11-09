/**
 * Aba CX (menu principal, 04/11/2026) — atendimento ao cliente nos
 * marketplaces. Primeira versao: so' Shopee.
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
import { lerFiltrosCx } from "@/lib/cx";
import { ALL_BRAND_KEYS } from "@/lib/filters/brands";

import CxConteudo from "./CxConteudo";
import FiltrosCx from "./FiltrosCx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CxPage({ searchParams }: { searchParams: SearchParams }) {
  const filtros = lerFiltrosCx(await searchParams, ALL_BRAND_KEYS);
  return (
    <PageContainer>
      <CxConteudo filtros={filtros} barra={<FiltrosCx f={filtros} />} />
    </PageContainer>
  );
}
