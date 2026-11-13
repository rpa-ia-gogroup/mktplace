/**
 * UI-FUNDACAO (F1) — a tabela padrao das abas.
 *
 *   - classes unicas de tabela, cabecalho e linha (o hover de linha e' global);
 *   - ordenacao: `SortHeader` mostra a seta so' na coluna ativa (e no
 *     hover/foco das outras);
 *   - vazio e' "—", nunca 0 nem celula em branco (`ouVazio`);
 *   - linha de total no `<tfoot>`, sempre a ultima (`LinhaTotal`).
 */
import type { ReactNode } from "react";

export const VAZIO = "—";

export const CLASSE_TABELA = "w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2";
export const CLASSE_CABECALHO = "text-left text-xs font-semibold uppercase tracking-wide text-ink-faint";
export const CLASSE_LINHA = "border-t border-line";

/** Formata o valor, ou "—" quando ele nao existe (null, undefined, NaN, infinito). */
export function ouVazio<T>(valor: T | null | undefined, formatar: (v: T) => string): string {
  if (valor == null) return VAZIO;
  if (typeof valor === "number" && !Number.isFinite(valor)) return VAZIO;
  return formatar(valor);
}

/** Total da tabela: rotulo na 1ª coluna, numeros alinhados a' direita. */
export function LinhaTotal({ rotulo = "Total", celulas }: { rotulo?: string; celulas: ReactNode[] }) {
  return (
    <tfoot>
      <tr className="border-t-2 border-line-strong font-semibold text-ink" data-testid="linha-total">
        <th scope="row" className="text-left">
          {rotulo}
        </th>
        {celulas.map((c, i) => (
          <td key={i} className="text-right tabular-nums">
            {c}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}
