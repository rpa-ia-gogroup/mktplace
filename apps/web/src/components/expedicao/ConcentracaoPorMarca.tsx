"use client";

/**
 * "Concentração por marca" — LDR por loja ao lado da evolução por vencimento,
 * comum aos canais da Expedição (antes so' no TikTok).
 *
 * Nao recalcula taxa: mostra base, atrasados e `rate` que a API publicou. Cada
 * canal diz a severidade da linha (TikTok: `above_target` da API; Shopee e ML:
 * meta/teto confirmados). Ordenacao client-side sobre a lista inteira.
 */

import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import Panel from "@/components/ui/Panel";
import SortHeader from "@/components/ui/SortHeader";
import SortHeaderComAjuda from "@/components/expedicao/SortHeaderComAjuda";
import { TaxaComBase } from "@/components/expedicao/KpiComAjuda";
import { TEXTO_SEVERIDADE } from "@/components/expedicao/EvolucaoPorVencimento";
import { CLASSE_CABECALHO, CLASSE_TABELA } from "@/components/expedicao/LayoutExpedicao";
import type { ChaveMetrica } from "@/lib/expedicao-definicoes";
import { formatarInteiro } from "@/lib/expedicao-formato";
import type { Severidade } from "@/lib/expedicao-tiktok-contract";
import { useSortableTable, type SortColumnType } from "@/lib/use-sortable-table";

export interface LinhaConcentracao {
  chave: string;
  nome: string;
  base: number;
  late: number;
  rate: number | null;
  severidade: Severidade;
}

const SO_TELA_LARGA = "hidden sm:table-cell";

const COLUNAS: Record<string, SortColumnType> = { loja: "text", base: "numeric", late: "numeric", rate: "numeric" };

function valor(m: LinhaConcentracao, coluna: string): string | number | null {
  if (coluna === "loja") return m.nome;
  if (coluna === "base") return m.base;
  if (coluna === "late") return m.late;
  return m.rate;
}

export default function ConcentracaoPorMarca({
  linhas,
  ajudas,
  dica,
  vazio,
  className = "h-full",
}: {
  linhas: readonly LinhaConcentracao[];
  ajudas: { base: ChaveMetrica; late: ChaveMetrica; rate: ChaveMetrica };
  dica: string;
  vazio: string;
  className?: string;
}) {
  const { sort, toggleSort, sortedRows } = useSortableTable<LinhaConcentracao>(linhas, valor, COLUNAS);
  const acima = linhas.filter((m) => m.severidade === "fora_da_meta" || m.severidade === "critico").length;
  // Mesma cor da tabela: vermelho so' com alguma marca acima do teto; acima da meta e' atencao.
  const tomChip = linhas.some((m) => m.severidade === "critico") ? "critico" : acima ? "atencao" : "neutro";
  return (
    <Panel
      className={className}
      semPadding
      titulo={
        <span className="flex items-center gap-2">
          Concentração por marca
          {linhas.length ? (
            <Chip tom={tomChip} ponto title={`De ${formatarInteiro(linhas.length)} com base.`}>
              {acima} acima da meta
              <span className="sr-only"> de {formatarInteiro(linhas.length)} lojas com base</span>
            </Chip>
          ) : null}
        </span>
      }
      acao={<InfoDica texto={dica} />}
    >
      {/* Sem loja elegivel, um cabecalho de tabela sem linha so' ocuparia espaco. */}
      {sortedRows.length === 0 ? (
        <p role="status" className="px-4 py-3 text-sm text-ink-muted">
          {vazio}
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className={CLASSE_TABELA}>
            <caption className="sr-only">LDR por loja no período</caption>
            <thead className={CLASSE_CABECALHO}>
              <tr>
                <SortHeader rotulo="Loja" coluna="loja" sort={sort} aoOrdenar={toggleSort} alinhamento="left" />
                {/* O "ⓘ" fica FORA do botao de ordenar. No celular so' Loja e LDR:
                    a celula da LDR ja' diz "X de Y" e a coluna da taxa nao some na rolagem. */}
                <SortHeaderComAjuda rotulo="Venciam" coluna="base" sort={sort} aoOrdenar={toggleSort} ajuda={ajudas.base} className={SO_TELA_LARGA} />
                <SortHeaderComAjuda rotulo="Atrasados" coluna="late" sort={sort} aoOrdenar={toggleSort} ajuda={ajudas.late} className={SO_TELA_LARGA} />
                <SortHeaderComAjuda rotulo="LDR" coluna="rate" sort={sort} aoOrdenar={toggleSort} ajuda={ajudas.rate} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((m) => (
                <tr key={m.chave} className="border-t border-line">
                  <th scope="row" className="text-left font-medium text-ink">
                    {m.nome}
                  </th>
                  <td className={`text-right tabular-nums text-ink ${SO_TELA_LARGA}`}>{formatarInteiro(m.base)}</td>
                  <td className={`text-right tabular-nums text-ink ${SO_TELA_LARGA}`}>{formatarInteiro(m.late)}</td>
                  <td className={`text-right font-semibold tabular-nums ${TEXTO_SEVERIDADE[m.severidade]}`}>
                    <TaxaComBase numerador={m.late} base={m.base} taxa={m.rate} linha />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
