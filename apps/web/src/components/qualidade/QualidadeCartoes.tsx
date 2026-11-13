"use client";

import { PackageMinus, PackageX, Truck, Undo2, type LucideIcon } from "lucide-react";

import CartaoIndicador from "@/components/ui/CartaoIndicador";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import InfoDica from "@/components/ui/InfoDica";
import type { QualityBrandRow, QualityKpis } from "@/lib/api-client";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import { DEF_QUALIDADE, NOME_DO_CANAL, linhasPorMarca, textoDoCartao, type CanalQualidade, type ChaveQualidade } from "@/lib/qualidade-cartoes";

/**
 * ALVO-GRADE (12/11/2026) — a faixa da Qualidade: SEMPRE quatro cartoes iguais
 * (`CartaoIndicador`): Cancelamento e Nao entregue do Mercado Livre,
 * Cancelamento e Devolucao da Shopee. O canal vai escrito na legenda (com o
 * ponto de identidade); a cor do cartao e' a do indicador, nunca bom/ruim.
 *
 * Esta fonte nao traz serie nem periodo anterior: sem linha de tendencia e sem
 * pilula de variacao. No lugar da linha, as marcas com a maior taxa (o mesmo
 * dado da tabela). Entrega (dias) fica no painel "Prazo de entrega"; os N/D do
 * TikTok, em "Mais detalhes".
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

const MARCAS_NO_RODAPE = 3;

export default function FaixaQualidade({
  kpis,
  marcas,
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
          // maior -> menor, so' as marcas com valor; o texto da linha e' "3,1% · 68 de 2,2 mil pedidos"
          const topo = noFiltro && !t.ausente ? linhasPorMarca(chave, marcas).filter((l) => !l.ausente).slice(0, MARCAS_NO_RODAPE) : [];
          return (
            <CartaoIndicador
              key={chave}
              rotulo={def.rotulo}
              icone={icone}
              cor={`rgb(var(--tc-kpi-${identidade}))`}
              valor={t.ausente ? null : t.valor}
              legenda={
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CHANNEL_DOT[def.canal]}`} />
                  {NOME_DO_CANAL[def.canal]}
                  {/* ausencia nunca vira zero: o motivo fica escrito */}
                  {t.ausente && <span className="text-ink-faint">· {noFiltro ? "sem dado no período" : "fora do filtro de canal"}</span>}
                </span>
              }
              rodape={topo.length ? topo.map((l) => `${l.label} ${l.valor.split(" · ")[0]}`).join(" · ") : undefined}
              ajuda={def.dica ? <InfoDica emControle={!t.ausente} texto={def.dica} /> : undefined}
              onAbrir={t.ausente ? undefined : () => onAbrir(chave)}
            />
          );
        })}
      </div>
    </section>
  );
}
