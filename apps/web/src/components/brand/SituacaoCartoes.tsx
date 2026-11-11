"use client";

import { CircleDollarSign, Megaphone, Receipt, ShoppingBag, type LucideIcon } from "lucide-react";

import DeltaBadge from "@/components/ui/DeltaBadge";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import {
  ROTULO_SITUACAO, valorCurto, type CartaoSituacao, type ChaveSituacao,
} from "@/lib/brand/situacao-cartoes";

/**
 * Cartoes da "Situacao da marca" no padrao da Gerencial (`KpiTile` gerencial).
 * Identidades (so' as 7 existentes): GMV -> `gmv`, Pedidos -> `pedidos`, Ticket ->
 * `ticket`, Ad Spend -> `ads`. A cor da marca deixou de pintar o cartao.
 */
export const VISUAL_SITUACAO: Record<ChaveSituacao, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  gmv: { icone: CircleDollarSign, identidade: "gmv" },
  pedidos: { icone: ShoppingBag, identidade: "pedidos" },
  ticket: { icone: Receipt, identidade: "ticket" },
  adspend: { icone: Megaphone, identidade: "ads" },
};

const GRADE = "grid grid-cols-2 gap-3 md:grid-cols-4";

export function FaixaSituacao({
  cartoes, roas, aoAbrir,
}: {
  cartoes: readonly CartaoSituacao[];
  /** ROAS aproximado (GMV ÷ Ad Spend), so' quando ha Ad Spend. */
  roas: string | null;
  aoAbrir: (chave: ChaveSituacao) => void;
}) {
  return (
    <div className={GRADE}>
      {cartoes.map((c) => {
        const { icone, identidade } = VISUAL_SITUACAO[c.chave];
        const ausente = c.valor == null;
        const comparacao =
          c.chave !== "adspend" ? undefined : ausente ? "N/D para TikTok Shop" : roas != null ? `ROAS ~${roas}` : undefined;
        return (
          <KpiTile
            key={c.chave}
            variante="gerencial"
            identidade={identidade}
            icone={icone}
            rotulo={ROTULO_SITUACAO[c.chave]}
            valor={ausente ? "—" : valorCurto(c.chave, c.valor as number)}
            tom={ausente ? "ausente" : "neutro"}
            comparacao={comparacao}
            // Gasto maior nao e' bom nem ruim por si: pilula sem cor de juizo.
            delta={c.deltaPct != null ? <DeltaBadge pct={c.deltaPct} tone={c.chave === "adspend" ? "neutral" : "higher_is_better"} /> : undefined}
            antes={c.antes != null ? `antes ${valorCurto(c.chave, c.antes)}` : undefined}
            serie={c.serie}
            onAbrir={ausente ? undefined : () => aoAbrir(c.chave)}
          />
        );
      })}
    </div>
  );
}
