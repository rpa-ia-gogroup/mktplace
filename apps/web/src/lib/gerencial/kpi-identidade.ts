import { CircleDollarSign, Gauge, Megaphone, Receipt, ShoppingBag, type LucideIcon } from "lucide-react";

import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import type { KpiKind } from "@/lib/kpi-drilldown";

/**
 * Icone e cor de identidade de cada KPI da Gerencial, os mesmos do `ICONE_KPI`
 * da `KpiBand`. Servem ao detalhe (KpiDrilldownDialog), que herda o ladrilho e a
 * cor do cartao que o abriu. Cor de identidade, nao de estado.
 */
export const IDENTIDADE_DO_KPI: Record<KpiKind, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  gmv: { icone: CircleDollarSign, identidade: "gmv" },
  orders: { icone: ShoppingBag, identidade: "pedidos" },
  avg_ticket: { icone: Receipt, identidade: "ticket" },
  ad_spend: { icone: Megaphone, identidade: "ads" },
  roas: { icone: Gauge, identidade: "roas" },
};
