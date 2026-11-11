"use client";

import { CircleDollarSign } from "lucide-react";

import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import { fmtBrlCurto } from "@/lib/formatters";
import type { LinhaCusto } from "./ChannelCostPanel";

/**
 * Os cartoes de GMV por canal de Financeiro, no padrao da Gerencial (`KpiTile`
 * gerencial, identidade `gmv`; o canal e' o ponto antes do nome, nunca cor de cartao).
 * O clique abre o detalhe com os componentes de custo CONHECIDOS do canal (antes o
 * corpo do painel por canal); o rodape do cartao diz onde o custo foi parar ("Ver custos
 * conhecidos"), ja' que ele saiu da primeira dobra. Sem periodo anterior (a tela usa `hideCompare`) e sem
 * serie por canal: sem pilula e sem grafico.
 */
export interface PainelCanal {
  canal: "tiktok" | "ml" | "shopee";
  titulo: string;
  /** Classe `bg-canal-*` do ponto de identidade (e da barra do detalhe). */
  ponto: string;
  gmv: number | null;
  linhas: LinhaCusto[];
  /** Ressalva que muda a leitura (ex.: tarifa parcial por marcas sem dado): vai para o ⓘ do cartao. */
  aviso?: string;
}

export const GRADE_FINANCEIRO = "grid grid-cols-2 lg:grid-cols-3 gap-3";

export default function FaixaGmvCanais({ paineis, onAbrir }: { paineis: PainelCanal[]; onAbrir: (canal: PainelCanal["canal"]) => void }) {
  return (
    <div className={GRADE_FINANCEIRO}>
      {paineis.map((p, i) => {
        // Em 2 colunas (celular/tablet), o ultimo cartao de uma quantidade impar fecha a linha.
        const fechaLinha = paineis.length % 2 === 1 && i === paineis.length - 1;
        return (
          <div key={p.canal} className={fechaLinha ? "col-span-2 lg:col-span-1" : undefined}>
            <KpiTile
              variante="gerencial"
              identidade="gmv"
              icone={CircleDollarSign}
              rotulo={
                <>
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${p.ponto}`} />
                  <span className="min-w-0">{p.titulo}</span>
                </>
              }
              ajuda={p.aviso ? <InfoDica emControle texto={p.aviso} /> : undefined}
              valor={p.gmv != null ? fmtBrlCurto(p.gmv) : "—"}
              comparacao={p.gmv != null ? "Ver custos conhecidos" : "Sem dado no período"}
              tom={p.gmv != null ? "neutro" : "ausente"}
              onAbrir={() => onAbrir(p.canal)}
            />
          </div>
        );
      })}
    </div>
  );
}
