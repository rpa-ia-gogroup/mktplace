/**
 * T-0124 — Financeiro: estado e procedencia do repasse Shopee por marca.
 *
 * Logica PURA (testada no `node --test`). A API publica, por marca,
 * `shopee_settlement_status` ("completa" | "parcial" | "sem_dado") e, no
 * consolidado, `shopee_settlement_aviso` so' quando algum repasse veio do
 * escrow. Nenhuma regra de calculo mora aqui: so' o que a tela diz.
 */
import type { FinanceiroBrandRow, FinanceiroKpis } from "../../src/lib/api-client.ts";

/** Texto de reserva quando a API (antiga ou sem escrow) nao manda o aviso. */
export const AJUDA_REPASSE_SHOPEE_PADRAO =
  "nas lojas com API, repasse do escrow da Shopee (escrow_amount, antes de ajustes posteriores)";

/**
 * Selo ao lado do repasse da marca. So' "parcial" ganha selo (escrow cobre
 * parte dos pedidos); "sem_dado" continua "—" pelo valor nulo; "completa",
 * ausente ou valor novo nao geram selo.
 */
export function seloRepasseShopee(
  row: Pick<FinanceiroBrandRow, "shopee_settlement" | "shopee_settlement_status">,
): string | null {
  if (row.shopee_settlement == null) return null;
  return row.shopee_settlement_status === "parcial" ? "parcial" : null;
}

/** Procedencia do repasse: o `aviso` da API quando presente; senao o texto fixo. */
export function procedenciaRepasseShopee(
  kpis: Pick<FinanceiroKpis, "shopee_settlement_aviso"> | null | undefined,
): string {
  const aviso = kpis?.shopee_settlement_aviso?.trim();
  return aviso ? aviso : AJUDA_REPASSE_SHOPEE_PADRAO;
}
