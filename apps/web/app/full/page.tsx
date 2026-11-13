import { abasVisiveis, resolverAba, type AbaFull } from "@/lib/full-abas";
import { shopeeFbsEnabled } from "@/lib/shopee-fbs-flag";
import MLFullEstoqueClient from "../estoque-ml-full/MLFullEstoqueClient";
import EstoqueFullClient from "../estoque-full/EstoqueFullClient";
import FullMLClient from "../full-ml/FullMLClient";
import FullShopeeClient from "../full-shopee/FullShopeeClient";
import VisaoGeralFull from "./VisaoGeralFull";

/**
 * FULL-UNIFICADO-1 — rota unica do Full, com sub-abas na URL (`?aba=`).
 *
 * Cada sub-aba e' o client da tela antiga, montado sem reescrita. So' a aba
 * escolhida e' montada, entao so' ela busca dado. "Desempenho Shopee" segue
 * atras de `NEXT_PUBLIC_SHOPEE_FBS_ENABLED`: com a flag off a aba some e o
 * `?aba=` dela cai na visao geral -- o client nunca monta.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CONTEUDO: Record<AbaFull, () => React.ReactNode> = {
  "visao-geral": () => <VisaoGeralFull />,
  "estoque-ml": () => <MLFullEstoqueClient />,
  "estoque-shopee": () => <EstoqueFullClient />,
  "envio-ml": () => <FullMLClient />,
  "desempenho-shopee": () => <FullShopeeClient />,
};

export default async function FullPage({ searchParams }: { searchParams: SearchParams }) {
  const abas = abasVisiveis({ desempenhoShopee: shopeeFbsEnabled() });
  const ativa = resolverAba((await searchParams).aba, abas);
  // ALVO-GRADE: o titulo "Full" e as sub-abas sao do `<Aba>` de cada client (useVisoesFull).
  return CONTEUDO[ativa]();
}
