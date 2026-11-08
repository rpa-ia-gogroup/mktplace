import { redirect } from "next/navigation";

import { hrefAba } from "@/lib/full-abas";

/** FULL-UNIFICADO-1 — a tela virou a sub-aba "Estoque ML" de `/full`. */
export default function MLFullEstoquePage() {
  redirect(hrefAba("estoque-ml"));
}
