import { redirect } from "next/navigation";

import { hrefAba } from "@/lib/full-abas";

/** FULL-UNIFICADO-1 — a tela virou a sub-aba "Envio ML" de `/full`. */
export default function FullMLPage() {
  redirect(hrefAba("envio-ml"));
}
