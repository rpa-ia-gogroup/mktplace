/**
 * Base de vendas (pedido da Nath): "pagos" (padrao) ou "realizados" (pagos +
 * aguardando pagamento; cancelados sempre fora). Muda so' pedidos, GMV e ticket;
 * margem, Ads e ROAS seguem pagos (contrato do PR #407 da API).
 */
import type { Marketplace } from "./mock-data.ts";

export type BaseVendas = "pagos" | "realizados";
export type NaoPagoDisponivel = Record<Marketplace, boolean>;

/** O que a API devolve: a base que ela de fato usou e, com realizados, se cada canal tem nao pagos. */
export interface EcoBase {
  base?: BaseVendas | null;
  nao_pago_disponivel?: NaoPagoDisponivel | null;
}

export const SO_PAGOS = "Só pedidos pagos: sem cancelados nem aguardando pagamento.";
export const REALIZADOS =
  "Realizados: pagos + aguardando pagamento, sem cancelados. Não pagos só existem nos últimos 60 dias (Shopee) e 10 dias (TikTok); antes disso o período mostra só pagos.";

const CURTO: Record<Marketplace, string> = { tiktok: "TikTok", ml: "ML", shopee: "Shopee" };

export function parseBase(v: string | null | undefined): BaseVendas {
  return v === "realizados" ? "realizados" : "pagos";
}

/**
 * Texto do ⓘ pela base que a API DEVOLVEU, nao pela pedida: API sem o contrato
 * novo ignora `base` e responde pagos, e o ⓘ nao pode dizer "realizados".
 */
export function notaBase(eco: EcoBase | null | undefined, canais: readonly Marketplace[]): string {
  if (eco?.base !== "realizados") return SO_PAGOS;
  const soPagos = canais
    .filter((c) => eco.nao_pago_disponivel?.[c] === false)
    .map((c) => `${CURTO[c]}: só pagos (${c === "ml" ? "sem fonte de não pagos" : "sem não pagos no período"}).`);
  return [REALIZADOS, ...soPagos].join(" ");
}
