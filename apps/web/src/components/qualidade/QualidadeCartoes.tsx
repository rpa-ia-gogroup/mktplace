"use client";

import { PackageMinus, PackageX, Truck, Undo2, type LucideIcon } from "lucide-react";

import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import InfoDica from "@/components/ui/InfoDica";
import type { QualityKpis } from "@/lib/api-client";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import { TIKTOK_UNAVAILABLE_QUALITY_METRICS } from "@/lib/quality-availability";
import { CARTOES_DO_CANAL, DEF_QUALIDADE, NOME_DO_CANAL, textoDoCartao, type CanalQualidade, type ChaveQualidade } from "@/lib/qualidade-cartoes";

/**
 * Cartoes de Qualidade no padrao da Gerencial (`KpiTile` gerencial), um grupo por
 * canal (o canal e' um ponto no titulo do grupo, nunca cor de cartao). Identidades
 * (so' as 7 existentes): entrega -> `prazo`; cancelamento, nao entregue e
 * devolucao -> `atendimento`. Sem periodo anterior nem serie nesta fonte: sem
 * pilula e sem grafico.
 */
export const VISUAL_QUALIDADE: Record<ChaveQualidade, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  tk_entrega: { icone: Truck, identidade: "prazo" },
  ml_cancelamento: { icone: PackageX, identidade: "atendimento" },
  ml_nao_entregue: { icone: PackageMinus, identidade: "atendimento" },
  ml_entrega: { icone: Truck, identidade: "prazo" },
  sh_cancelamento: { icone: PackageX, identidade: "atendimento" },
  sh_devolucao: { icone: Undo2, identidade: "atendimento" },
};

/** Cancelamento e devolucao do TikTok: a fonte nao traz; icone por tipo, sem clique. */
const ICONE_INDISPONIVEL: LucideIcon[] = [PackageX, Undo2];

export const GRADE_QUALIDADE = "grid grid-cols-2 md:grid-cols-4 gap-3";

/** Em 2 colunas (celular), o ultimo cartao de um grupo impar ocupa a linha inteira em vez de ficar sozinho em meia linha. */
const ultimoImpar = (indice: number, total: number) => total % 2 === 1 && indice === total - 1;

/** Quantos cartoes (incluindo os "N/D" do TikTok) a selecao mostra: para o esqueleto. */
export function totalDeCartoes(sel: Record<CanalQualidade, boolean>): number {
  return (
    (sel.tiktok ? CARTOES_DO_CANAL.tiktok.length + TIKTOK_UNAVAILABLE_QUALITY_METRICS.length : 0) +
    (sel.ml ? CARTOES_DO_CANAL.ml.length : 0) +
    (sel.shopee ? CARTOES_DO_CANAL.shopee.length : 0)
  );
}

export default function GrupoQualidade({
  canal, kpis, onAbrir,
}: {
  canal: CanalQualidade;
  kpis: QualityKpis | null;
  onAbrir: (chave: ChaveQualidade) => void;
}) {
  return (
    <section aria-label={NOME_DO_CANAL[canal]} className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CHANNEL_DOT[canal]}`} />
        {NOME_DO_CANAL[canal]}
      </h3>
      <div className={GRADE_QUALIDADE}>
        {CARTOES_DO_CANAL[canal].map((chave, i, todos) => {
          const def = DEF_QUALIDADE[chave];
          const { icone, identidade } = VISUAL_QUALIDADE[chave];
          const t = textoDoCartao(chave, kpis);
          return (
            <div key={chave} className={ultimoImpar(i, todos.length + (canal === "tiktok" ? TIKTOK_UNAVAILABLE_QUALITY_METRICS.length : 0)) ? "col-span-2 md:col-span-1" : undefined}>
              <KpiTile
                variante="gerencial"
                identidade={identidade}
                icone={icone}
                rotulo={def.rotulo}
                ajuda={def.dica ? <InfoDica emControle texto={def.dica} /> : undefined}
                valor={t.valor}
                comparacao={t.ausente ? "Sem dado no período" : undefined}
                tom={t.ausente ? "ausente" : "neutro"}
                onAbrir={t.ausente ? undefined : () => onAbrir(chave)}
              />
            </div>
          );
        })}
        {canal === "tiktok" &&
          TIKTOK_UNAVAILABLE_QUALITY_METRICS.map((m, i) => (
            <div key={m.label} className={ultimoImpar(CARTOES_DO_CANAL.tiktok.length + i, CARTOES_DO_CANAL.tiktok.length + TIKTOK_UNAVAILABLE_QUALITY_METRICS.length) ? "col-span-2 md:col-span-1" : undefined}>
              <KpiTile
                variante="gerencial"
                identidade="atendimento"
                icone={ICONE_INDISPONIVEL[i] ?? PackageX}
                rotulo={m.label.replace(/ TK$/, "")}
                valor={m.value}
                comparacao={m.subvalue}
                tom="ausente"
              />
            </div>
          ))}
      </div>
    </section>
  );
}
