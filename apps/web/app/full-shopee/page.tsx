import { notFound, redirect } from "next/navigation";

import { hrefAba } from "@/lib/full-abas";
import { shopeeFbsEnabled } from "@/lib/shopee-fbs-flag";

/**
 * FULL-UNIFICADO-1 — a tela virou a sub-aba "Desempenho Shopee" de `/full`.
 * Com a flag off continua 404 (Gate FULL-SH-1D): o guard vem antes do redirect.
 */
export default function FullShopeePage() {
  if (!shopeeFbsEnabled()) notFound();
  redirect(hrefAba("desempenho-shopee"));
}
