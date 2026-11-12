"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseBase, type BaseVendas } from "@/lib/base-vendas";

/** Base de vendas na URL (`?base=realizados`); "pagos" e' o padrao e sai da URL. */
export function useBaseVendas(): [BaseVendas, (b: BaseVendas) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const base = parseBase(searchParams.get("base"));
  const setBase = useCallback(
    (b: BaseVendas) => {
      const params = new URLSearchParams(searchParams.toString());
      if (b === "realizados") params.set("base", b);
      else params.delete("base");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );
  return [base, setBase];
}
