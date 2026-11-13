"use client";

import {
  Eye,
  LayoutGrid,
  Percent,
  Radio,
  Repeat,
  UserPlus,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import CartaoIndicador from "@/components/ui/CartaoIndicador";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import { KPI_CANAL, textoDoCartao, type KpiCanalChave } from "@/lib/canais-kpi-detalhe";
import type { CanaisKpis } from "@/lib/api-client";

/**
 * Icone e cor de identidade de cada indicador de Canais. So' as 7 identidades
 * que ja' existem (decisao de 10/11/2026): o canal NAO vira cor de cartao, so'
 * um ponto antes do rotulo.
 *   gmv     — mix de GMV (video, live, card)
 *   pedidos — quem compra (novos, recompra)
 *   ticket  — GMV por comprador
 *   atendimento — alcance (visitantes)
 *   roas    — taxa de conversao
 */
export const VISUAL_DO_KPI_CANAL: Record<KpiCanalChave, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  tiktok_video: { icone: Video, identidade: "gmv" },
  tiktok_live: { icone: Radio, identidade: "gmv" },
  tiktok_card: { icone: LayoutGrid, identidade: "gmv" },
  tiktok_conversao: { icone: Percent, identidade: "roas" },
  ml_novos: { icone: UserPlus, identidade: "pedidos" },
  ml_recompra: { icone: Repeat, identidade: "pedidos" },
  ml_gmv_comprador: { icone: Wallet, identidade: "ticket" },
  shopee_novos: { icone: UserPlus, identidade: "pedidos" },
  shopee_recompra: { icone: Repeat, identidade: "pedidos" },
  shopee_gmv_comprador: { icone: Wallet, identidade: "ticket" },
  shopee_visitantes: { icone: Eye, identidade: "atendimento" },
  shopee_conversao: { icone: Percent, identidade: "roas" },
};

/** O cartao unico das abas (`CartaoIndicador`) para um indicador de Canais; o clique abre o detalhe por marca. */
export default function CartaoKpiCanal({
  chave,
  kpis,
  onAbrir,
}: {
  chave: KpiCanalChave;
  kpis: CanaisKpis | null;
  onAbrir: (chave: KpiCanalChave) => void;
}) {
  const def = KPI_CANAL[chave];
  const { icone, identidade } = VISUAL_DO_KPI_CANAL[chave];
  const texto = textoDoCartao(chave, kpis);
  return (
    <CartaoIndicador
      rotulo={def.rotulo}
      icone={icone}
      cor={`rgb(var(--tc-kpi-${identidade}))`}
      valor={texto.ausente ? null : texto.valor}
      legenda={texto.comparacao}
      onAbrir={() => onAbrir(chave)}
    />
  );
}
