"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { abasVisiveis, hrefAba, resolverAba, type AbaFull } from "@/lib/full-abas";
import { shopeeFbsEnabled } from "@/lib/shopee-fbs-flag";

/**
 * ALVO-GRADE — as 5 sub-abas do Full como as abas da moldura (`<Aba visoes>`),
 * sob o titulo unico "Full". As URLs nao mudam (`/full?aba=...`).
 */
export function useVisoesFull() {
  const router = useRouter();
  const busca = useSearchParams();
  const abas = abasVisiveis({ desempenhoShopee: shopeeFbsEnabled() });
  return {
    titulo: "Full",
    visoes: abas.map((a) => ({ id: a.chave, rotulo: a.rotulo })),
    visao: resolverAba(busca.get("aba") ?? undefined, abas),
    onVisao: (id: AbaFull) => router.push(hrefAba(id)),
  };
}
