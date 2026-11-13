"use client";

import { PackageMinus, PackageX, Truck, Undo2, type LucideIcon } from "lucide-react";

import CartaoIndicador from "@/components/ui/CartaoIndicador";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import InfoDica from "@/components/ui/InfoDica";
import type { QualityBrandRow, QualityKpis } from "@/lib/api-client";
import { CANAL_CURTO, DEF_QUALIDADE, textoDoCartao, type CanalQualidade, type ChaveQualidade } from "@/lib/qualidade-cartoes";

/**
 * ALVO-GRADE (12/11/2026) — a faixa da Qualidade: SEMPRE quatro cartoes iguais
 * (`CartaoIndicador`): Cancelamento e Nao entregue do Mercado Livre,
 * Cancelamento e Devolucao da Shopee. O canal vai escrito no ROTULO
 * ("Cancelamento · ML"); a cor do cartao e' a do indicador, nunca bom/ruim.
 *
 * Esta fonte nao traz serie nem periodo anterior: sem linha de tendencia e sem
 * pilula de variacao. A lista por marca fica no painel e na tabela, nao se repete aqui.
 * Entrega (dias) fica no painel "Prazo de entrega"; os N/D do TikTok, em
 * "Mais detalhes".
 */
export const VISUAL_QUALIDADE: Record<ChaveQualidade, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  tk_entrega: { icone: Truck, identidade: "prazo" },
  ml_cancelamento: { icone: PackageX, identidade: "ads" },
  ml_nao_entregue: { icone: PackageMinus, identidade: "pedidos" },
  ml_entrega: { icone: Truck, identidade: "prazo" },
  sh_cancelamento: { icone: PackageX, identidade: "ads" },
  sh_devolucao: { icone: Undo2, identidade: "prazo" },
};

/** Os quatro cartoes da faixa, nesta ordem. */
export const CARTOES_DA_FAIXA: ChaveQualidade[] = ["ml_cancelamento", "ml_nao_entregue", "sh_cancelamento", "sh_devolucao"];

export const GRADE_QUALIDADE = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";

export default function FaixaQualidade({
  kpis,
  canais,
  onAbrir,
}: {
  kpis: QualityKpis | null;
  marcas: QualityBrandRow[];
  /** Canais dentro do filtro: cartao de canal fora dele fica sem numero, com o motivo escrito. */
  canais: Record<CanalQualidade, boolean>;
  onAbrir: (chave: ChaveQualidade) => void;
}) {
  return (
    <section aria-label="Indicadores do período">
      <div className={GRADE_QUALIDADE}>
        {CARTOES_DA_FAIXA.map((chave) => {
          const def = DEF_QUALIDADE[chave];
          const { icone, identidade } = VISUAL_QUALIDADE[chave];
          const noFiltro = canais[def.canal];
          const t = textoDoCartao(chave, noFiltro ? kpis : null);
          return (
            <CartaoIndicador
              key={chave}
              rotulo={`${def.rotulo} · ${CANAL_CURTO[def.canal]}`}
              icone={icone}
              cor={`rgb(var(--tc-kpi-${identidade}))`}
              valor={t.ausente ? null : t.valor}
              // ausencia nunca vira zero: o motivo fica escrito
              legenda={t.ausente ? (noFiltro ? "sem dado no período" : "fora do filtro de canal") : undefined}
              ajuda={def.dica ? <InfoDica emControle={!t.ausente} texto={def.dica} /> : undefined}
              onAbrir={t.ausente ? undefined : () => onAbrir(chave)}
            />
          );
        })}
      </div>
    </section>
  );
}
