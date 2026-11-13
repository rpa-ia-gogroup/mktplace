"use client";

import { Banknote, CircleDollarSign, Handshake, Megaphone, Music2, Percent, Receipt, ShoppingBag, Truck, type LucideIcon } from "lucide-react";

import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";
import { fmtBrlCurto } from "@/lib/formatters";
import type { LinhaCusto } from "./ChannelCostPanel";

/**
 * A faixa do Financeiro na grade unica (ALVO-GRADE): sempre QUATRO cartoes
 * iguais. Na Visao geral, a receita somada e um por canal, com os custos
 * CONHECIDOS do canal no rodape; na aba de um canal, o GMV e os tres primeiros
 * componentes de custo dele. Tudo sai de `painel.linhas`, a mesma lista do
 * detalhe: nada e' calculado aqui e custos nunca sao somados (so' o GMV).
 * A cor do cartao e' identidade; bom/ruim fica so' na pilula da taxa, com os
 * limiares de sempre. Linha de tendencia so' com serie real que confere com o
 * numero do cartao (`serieQueConfere`).
 */
export interface PainelCanal {
  canal: "tiktok" | "ml" | "shopee";
  titulo: string;
  /** Classe `bg-canal-*` do ponto de identidade (e da barra do detalhe). */
  ponto: string;
  gmv: number | null;
  linhas: LinhaCusto[];
  /** Taxa do canal sobre o GMV, ja' formatada, com o tom da regra de negocio. */
  pilula?: { texto: string; tom: TomPilula } | null;
  /** Ressalva que muda a leitura (ex.: tarifa parcial por marcas sem dado): vai para o ⓘ do cartao. */
  aviso?: string;
}

export const GRADE_FINANCEIRO = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";

const CANAIS: { canal: PainelCanal["canal"]; titulo: string; icone: LucideIcon }[] = [
  { canal: "tiktok", titulo: "TikTok Shop", icone: Music2 },
  { canal: "ml", titulo: "Mercado Livre", icone: Handshake },
  { canal: "shopee", titulo: "Shopee", icone: ShoppingBag },
];

const ICONE_DA_LINHA: Record<string, LucideIcon> = {
  "Taxas e encargos": Percent,
  "Tarifa ML": Percent,
  "Repasse recebido": Banknote,
  "Ads (mídia)": Megaphone,
  "Ads + frete / GMV": Truck,
  "Frete do seller": Truck,
};
/** Identidade dos tres cartoes de custo na aba de um canal (o do GMV leva a cor do canal). */
const COR_DA_LINHA = ["rgb(var(--tc-kpi-ads))", "rgb(var(--tc-kpi-ticket))", "rgb(var(--tc-kpi-pedidos))"];

const tem = (t?: string | null): t is string => !!t && t !== "—";

export default function FaixaFinanceiro({
  paineis,
  total,
  serieTotal,
  foraDaConta,
  canalDaAba,
  onAbrir,
}: {
  /** Um por canal SELECIONADO no filtro. */
  paineis: PainelCanal[];
  /** Soma do GMV dos canais selecionados; `null` = nenhum com dado. */
  total: number | null;
  /** GMV por dia do recorte inteiro, ja' conferido com `total`. */
  serieTotal: number[] | null;
  /** O que nao entra na conta (margem nao fechada): ⓘ do cartao da soma. */
  foraDaConta: string;
  /** Aba de um canal: os quatro cartoes sao dele. */
  canalDaAba?: PainelCanal["canal"] | null;
  onAbrir: (canal: PainelCanal["canal"]) => void;
}) {
  const daAba = canalDaAba ? paineis.find((p) => p.canal === canalDaAba) : null;
  if (daAba) {
    const { icone } = CANAIS.find((c) => c.canal === daAba.canal)!;
    return (
      <div className={GRADE_FINANCEIRO}>
        <CartaoIndicador
          rotulo={`Receita · ${daAba.titulo}`}
          icone={icone}
          cor={`rgb(var(--tc-canal-${daAba.canal}))`}
          valor={daAba.gmv != null ? fmtBrlCurto(daAba.gmv) : null}
          legenda={daAba.gmv != null ? "Ver custos conhecidos" : "Sem dado no período"}
          // Com o filtro so' neste canal, a serie do recorte E' a dele.
          serie={paineis.length === 1 ? serieTotal : null}
          ajuda={daAba.aviso ? <InfoDica emControle texto={daAba.aviso} /> : null}
          onAbrir={() => onAbrir(daAba.canal)}
        />
        {daAba.linhas.slice(0, 3).map((l, i) => {
          const valor = l.ausente ? null : tem(l.valor) ? l.valor : tem(l.pctTexto) ? l.pctTexto : null;
          return (
            <CartaoIndicador
              key={l.rotulo}
              rotulo={l.rotulo}
              icone={ICONE_DA_LINHA[l.rotulo] ?? Receipt}
              cor={COR_DA_LINHA[i]}
              valor={valor}
              // A primeira linha e' a taxa do canal: a pilula dela ja' vem com o tom da regra.
              pilula={!valor ? null : i === 0 ? daAba.pilula : tem(l.valor) && tem(l.pctTexto) ? { texto: l.pctTexto, tom: "neutro" } : null}
              legenda={l.ausente ?? (valor ? l.detalhe : "Sem dado no período")}
            />
          );
        })}
      </div>
    );
  }
  return (
    <div className={GRADE_FINANCEIRO}>
      <CartaoIndicador
        rotulo={paineis.length > 1 ? `Receita dos ${paineis.length} canais` : "Receita (GMV)"}
        icone={CircleDollarSign}
        cor="rgb(var(--tc-kpi-gmv))"
        valor={total != null ? fmtBrlCurto(total) : null}
        legenda={total != null ? "margem não fechada" : "Sem dado no período"}
        serie={serieTotal}
        ajuda={<InfoDica texto={foraDaConta} />}
      />
      {CANAIS.map(({ canal, titulo, icone }) => {
        const p = paineis.find((x) => x.canal === canal);
        return (
          <CartaoIndicador
            key={canal}
            rotulo={titulo}
            icone={icone}
            cor={`rgb(var(--tc-canal-${canal}))`}
            valor={p?.gmv != null ? fmtBrlCurto(p.gmv) : null}
            pilula={p?.gmv != null ? p.pilula : null}
            legenda={!p ? "Fora do filtro" : p.gmv != null ? "Ver custos conhecidos" : "Sem dado no período"}
            rodape={
              p?.gmv != null ? (
                <span className="grid gap-0.5 tabular-nums">
                  {p.linhas.slice(0, 3).map((l) => {
                    const v = l.ausente ? null : tem(l.valor) ? l.valor : tem(l.pctTexto) ? l.pctTexto : null;
                    return (
                      <span key={l.rotulo} className="flex items-baseline justify-between gap-3">
                        <span>{l.rotulo}</span>
                        <b className={v ? "font-semibold text-ink" : "font-normal text-ink-faint"}>{v ?? l.ausente ?? "—"}</b>
                      </span>
                    );
                  })}
                </span>
              ) : null
            }
            ajuda={p?.aviso ? <InfoDica emControle texto={p.aviso} /> : null}
            onAbrir={p ? () => onAbrir(canal) : undefined}
          />
        );
      })}
    </div>
  );
}
