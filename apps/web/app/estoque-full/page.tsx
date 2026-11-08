import { redirect } from "next/navigation";

import { hrefAba } from "@/lib/full-abas";

/** FULL-UNIFICADO-1 — a tela virou a sub-aba "Estoque Shopee" de `/full`. */
export default function EstoqueFullPage() {
  redirect(hrefAba("estoque-shopee"));
}
