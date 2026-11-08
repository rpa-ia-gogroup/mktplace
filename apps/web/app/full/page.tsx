import Link from "next/link";

import { abasVisiveis, hrefAba, resolverAba, type AbaFull } from "@/lib/full-abas";
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
  return (
    <>
      <nav aria-label="Seções do Full" className="px-4 pt-4">
        <ul className="flex gap-1 overflow-x-auto rounded-full border border-line bg-raised p-1 w-fit max-w-full">
          {abas.map((a) => {
            const atual = a.chave === ativa;
            return (
              <li key={a.chave} className="shrink-0">
                <Link
                  href={hrefAba(a.chave)}
                  aria-current={atual ? "page" : undefined}
                  className={`flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    atual
                      ? "bg-surface font-semibold text-ink shadow-sm ring-1 ring-line-strong"
                      : "text-ink-muted hover:bg-surface/70 hover:text-ink"
                  }`}
                >
                  {a.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {CONTEUDO[ativa]()}
    </>
  );
}
