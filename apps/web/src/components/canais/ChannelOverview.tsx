import { Columns3 } from "lucide-react";
import Panel from "@/components/ui/Panel";
import CelulaBarra from "@/components/ui/CelulaBarra";
import InfoDica from "@/components/ui/InfoDica";
import { SO_PAGOS } from "@/lib/base-vendas";
import TableScrollHint from "@/components/TableScrollHint";
import type { CanaisChannelMedian } from "@/lib/api-client";
import { formatChannelMetric, type FormattedMetric } from "@/lib/canais-channel-metrics";
import { fmtPctSimples, fmtVezes } from "@/lib/formatters";

/**
 * UX-TORRE-B2B-1 — os canais lado a lado, na primeira dobra de Canais.
 *
 * Uma COLUNA por canal selecionado, uma LINHA por medida. Nada aqui e'
 * calculado de novo:
 *
 *   - GMV e pedidos sao a SOMA das linhas marca x canal que a pagina ja'
 *     recebe (a mesma base da matriz logo abaixo);
 *   - custo, Ads, ROAS e frete sao as MEDIANAS que a API ja' devolve em
 *     `channel_medians` — a mesma referencia que os sinais da matriz usam;
 *   - compradores e conversao sao os KPIs de canal que a pagina ja' exibia.
 *
 * Os tres estados de ausencia vem de `formatChannelMetric`, o mesmo helper da
 * matriz: "N/A" (nao se aplica ao canal), "Sem dado" (deveria existir) e "—"
 * (indefinido). Ausencia nunca vira zero.
 *
 * Nenhuma linha ranqueia canais por cor: a comparacao e' de leitura, e as
 * fontes de cada canal medem coisas ligeiramente diferentes.
 */
export type CanalId = "tiktok" | "ml" | "shopee";

export interface ColunaCanal {
  canal: CanalId;
  rotulo: string;
  /**
   * `null` quando o canal selecionado nao tem NENHUMA linha marca x canal no
   * recorte: ausencia de medicao, exibida como "Sem dado" — nunca R$ 0, e o
   * canal sai do denominador da participacao em vez de virar 0%.
   */
  gmv: number | null;
  pedidos: number | null;
  mediana: CanaisChannelMedian | null;
  aplicavel: { ads: boolean; custo: boolean; frete: boolean };
  disponivel: { ads: boolean; custo: boolean; frete: boolean };
  /** Ja' formatados pela pagina, no formato que ela sempre usou. */
  novosPct: string;
  recompraPct: string;
  gmvPorComprador: string;
  conversao: string;
}

const PONTO: Record<CanalId, string> = {
  tiktok: "bg-canal-tiktok",
  ml: "bg-canal-ml",
  shopee: "bg-canal-shopee",
};

function Celula({ m }: { m: FormattedMetric }) {
  if (m.tone === "warning") {
    return <span className="rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn-ink">{m.text}</span>;
  }
  if (m.tone === "muted") return <span className="text-xs text-ink-faint">{m.text}</span>;
  return <span className="font-semibold text-ink">{m.text}</span>;
}

export default function ChannelOverview({
  colunas,
  fmtBrl,
  fmtNumber,
  carregando,
  notaVendas = SO_PAGOS,
}: {
  colunas: ColunaCanal[];
  fmtBrl: (v: number) => string;
  fmtNumber: (v: number) => string;
  carregando: boolean;
  /** O que GMV e pedidos contam (pagos ou realizados). */
  notaVendas?: string;
}) {
  // Mesmo recorte da "participacao no GMV" que a Gerencial ja' exibe: fatia
  // de cada canal entre os canais selecionados COM dado.
  const total = colunas.reduce((s, c) => s + (c.gmv ?? 0), 0);
  const share = (c: ColunaCanal) => (c.gmv != null && total > 0 ? (c.gmv / total) * 100 : null);
  // Barrinha na cor do canal: o peso e' o valor sobre o maior entre os canais.
  const maior = (f: (c: ColunaCanal) => number | null) => Math.max(0, ...colunas.map((c) => f(c) ?? 0));
  const maiorGmv = maior((c) => c.gmv);
  const maiorPedidos = maior((c) => c.pedidos);
  const cor = (c: ColunaCanal) => `rgb(var(--tc-canal-${c.canal}))`;
  const semDado = <span className="rounded bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn-ink">Sem dado</span>;

  type Linha = { rotulo: string; dica?: string; valor: (c: ColunaCanal) => React.ReactNode };
  const grupos: { titulo: string; linhas: Linha[] }[] = [
    {
      titulo: "Volume",
      linhas: [
        { rotulo: "GMV", valor: (c) => (c.gmv == null ? semDado : <CelulaBarra valor={fmtBrl(c.gmv)} peso={maiorGmv > 0 ? c.gmv / maiorGmv : 0} cor={cor(c)} />) },
        {
          rotulo: "Participação no GMV",
          dica: "Entre os canais selecionados",
          valor: (c) => {
            const s = share(c);
            return s == null ? <span className="text-xs text-ink-faint">—</span> : <span className="text-ink-muted">{fmtPctSimples(s)}</span>;
          },
        },
        { rotulo: "Pedidos", valor: (c) => (c.pedidos == null ? semDado : <CelulaBarra valor={fmtNumber(c.pedidos)} peso={maiorPedidos > 0 ? c.pedidos / maiorPedidos : 0} cor={cor(c)} />) },
      ],
    },
    {
      titulo: "Custo · mediana das marcas",
      linhas: [
        {
          rotulo: "Custo marketplace / GMV",
          valor: (c) => (
            <span className="inline-flex items-baseline gap-1.5">
              <Celula m={formatChannelMetric(c.mediana?.marketplace_cost_pct_median ?? null, c.aplicavel.custo, c.disponivel.custo, fmtPctSimples)} />
              {c.mediana?.marketplace_cost_pct_p75 != null && c.aplicavel.custo && c.disponivel.custo && (
                <span className="text-xs text-ink-faint">p75 {fmtPctSimples(c.mediana.marketplace_cost_pct_p75)}</span>
              )}
            </span>
          ),
        },
        {
          rotulo: "Ads / GMV",
          valor: (c) => <Celula m={formatChannelMetric(c.mediana?.ads_gmv_pct_median ?? null, c.aplicavel.ads, c.disponivel.ads, fmtPctSimples)} />,
        },
        {
          rotulo: "ROAS",
          valor: (c) => <Celula m={formatChannelMetric(c.mediana?.roas_median ?? null, c.aplicavel.ads, c.disponivel.ads, fmtVezes)} />,
        },
        {
          rotulo: "Frete seller / GMV",
          valor: (c) => <Celula m={formatChannelMetric(c.mediana?.seller_shipping_pct_median ?? null, c.aplicavel.frete, c.disponivel.frete, fmtPctSimples)} />,
        },
      ],
    },
    {
      titulo: "Compradores",
      linhas: [
        { rotulo: "Novos compradores", valor: (c) => <span className="text-ink-muted">{c.novosPct}</span> },
        { rotulo: "Recompra", valor: (c) => <span className="text-ink-muted">{c.recompraPct}</span> },
        { rotulo: "GMV por comprador", valor: (c) => <span className="text-ink-muted">{c.gmvPorComprador}</span> },
        { rotulo: "Conversão", valor: (c) => <span className="text-ink-muted">{c.conversao}</span> },
      ],
    },
  ];

  return (
    <Panel
      id="comparativo-canais"
      titulo={
        <>
          Canais lado a lado
          <InfoDica
            texto={`GMV e pedidos — ${notaVendas} Custo, Ads, ROAS e frete: mediana das marcas de cada canal${
              carregando ? "" : ` (${colunas.map((c) => `${c.rotulo}: ${c.mediana?.brands_with_data ?? 0} marcas`).join(" · ")})`
            }. N/A = não se aplica · Sem dado = deveria existir, mas falta.`}
          />
        </>
      }
      icone={Columns3}
      semPadding
    >
      <TableScrollHint>
        <table className="w-full text-data" aria-label="Canais lado a lado">
          <thead>
            <tr className="bg-raised">
              <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Medida
              </th>
              {colunas.map((c) => (
                <th key={c.canal} scope="col" className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${PONTO[c.canal]}`} />
                    {c.rotulo}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {grupos.map((g) => (
            <tbody key={g.titulo} className="divide-y divide-line border-t border-line">
              <tr>
                <th
                  scope="colgroup"
                  colSpan={colunas.length + 1}
                  className="bg-surface px-4 pb-1 pt-2.5 text-left text-xs font-semibold text-ink-muted"
                >
                  {g.titulo}
                </th>
              </tr>
              {g.linhas.map((l) => (
                <tr key={l.rotulo} className="hover:bg-raised/70 transition-colors">
                  <th scope="row" className="px-4 py-2 text-left font-normal text-ink-muted whitespace-nowrap" title={l.dica}>
                    {l.rotulo}
                  </th>
                  {colunas.map((c) => (
                    <td key={c.canal} className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                      {carregando ? (
                        <span className="ml-auto block h-3 w-16 animate-pulse rounded bg-raised" aria-hidden="true" />
                      ) : (
                        l.valor(c)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </TableScrollHint>
    </Panel>
  );
}
