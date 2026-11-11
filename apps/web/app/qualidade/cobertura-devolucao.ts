/**
 * T-0088 (C2-01) — Qualidade: devolucao Shopee sem dado e cobertura do consolidado.
 *
 * Logica PURA (testada no `node --test`), no mesmo contrato da T-0085 no
 * Financeiro: taxa nula vira "—" (nunca 0,0%), e o % consolidado que so' cobre
 * parte das marcas diz "parcial (N de M marcas)".
 */
import type { CoberturaMarcas, QualityBrandRow } from "../../src/lib/api-client.ts";
import { fmtPctSimples } from "../../src/lib/formatters.ts";
import { textoCoberturaFinanceiro } from "../../src/lib/full-visao-geral.ts";

/** Taxa da linha: "—" quando nao ha' valor (nunca "0,0%"). */
export function fmtRate(v: number | null): string {
  if (v == null) return "—";
  return fmtPctSimples(v);
}

export interface AvisoCobertura {
  /** "Devolução: parcial (1 de 5 marcas)". */
  texto: string;
  /** Quais marcas ficaram fora do consolidado e por que. */
  dica: string;
}

/**
 * Aviso do cartao de devolucao Shopee quando o consolidado so' cobre parte das
 * marcas. `null` com cobertura completa, sem dado (o cartao ja' mostra "—") ou
 * ausente (API antiga / Shopee sem pedido).
 */
export function avisoCoberturaDevolucao(
  c: CoberturaMarcas | null | undefined,
  marcas: Pick<QualityBrandRow, "brand" | "label">[] = [],
): AvisoCobertura | null {
  const parcial = textoCoberturaFinanceiro(c);
  if (!c || !parcial) return null;
  const rotulo = new Map(marcas.map((m) => [m.brand, m.label]));
  const fora = (c.marcas_sem_dado ?? []).map((b) => rotulo.get(b) ?? b.toUpperCase());
  const quem = fora.length ? `Sem devolução medida: ${fora.join(", ")}. ` : "";
  return {
    texto: `Devolução: ${parcial}`,
    dica: `${quem}O % do cartão divide os devolvidos só pelos pedidos das marcas com o dado.`,
  };
}
