/**
 * Clique na barra da "Evolução por dia de vencimento" no Mercado Livre e na
 * Shopee: os pedidos que entraram no numerador da LDR daquele dia
 * (`GET /api/v1/expedicao/{ml|shopee}/ldr/pedidos`). Mesma regra da taxa.
 * Sem React aqui: testável com `node --test`.
 */

import { celula } from "./expedicao-tiktok-abertos.ts";

export type CanalAtrasados = "mercadolivre" | "shopee";

export interface PedidoAtrasado {
  brand: string;
  /** ML: número da venda; Shopee: número do pedido. `null` com a chave de publicação desligada. */
  order_id: string | null;
  status: string | null;
  /** Horário de Brasília, sem fuso. */
  deadline_at: string | null;
  collected_at: string | null;
}

export interface RespostaAtrasadosDia {
  availability: "available" | "unavailable";
  unavailable_reason?: string;
  channel: CanalAtrasados;
  deadline: string;
  brands: { brand: string; missed: number; still_waiting: number }[];
  all_brands: string[];
  list_total: number;
  still_waiting: number;
  orders: PedidoAtrasado[];
  page: number;
  page_size: number;
  has_more: boolean;
}

const ROTA: Record<CanalAtrasados, string> = {
  mercadolivre: "/api/v1/expedicao/ml/ldr/pedidos",
  shopee: "/api/v1/expedicao/shopee/ldr/pedidos",
};

export const NOME_CANAL: Record<CanalAtrasados, string> = { mercadolivre: "Mercado Livre", shopee: "Shopee" };

export function queryAtrasadosDia(canal: CanalAtrasados, vencimento: string, marca: string | null, pagina = 1): string {
  const p = new URLSearchParams({ vencimento });
  if (marca) p.set("brands", marca);
  if (pagina > 1) p.set("page", String(pagina));
  return `${ROTA[canal]}?${p.toString()}`;
}

/** Status atual, no nome que o painel de cada canal mostra. Desconhecido = o código cru. */
const ROTULO_STATUS: Record<CanalAtrasados, Record<string, string>> = {
  mercadolivre: {
    handling: "Em preparação",
    ready_to_ship: "Pronto para envio",
    shipped: "A caminho",
    delivered: "Entregue",
    not_delivered: "Não entregue",
    cancelled: "Cancelado",
  },
  shopee: {
    ready_to_ship: "A enviar",
    processed: "Aguardando coleta",
    retry_ship: "Reenvio",
    shipped: "Enviado",
    to_confirm_receive: "Enviado",
    completed: "Concluído",
    to_return: "Devolução",
    in_cancel: "Cancelando",
    cancelled: "Cancelado",
    invoice_pending: "Aguardando NF-e",
  },
};

export function rotuloStatus(canal: CanalAtrasados, status: string | null): string {
  if (!status) return "—";
  return ROTULO_STATUS[canal][status.toLowerCase()] ?? status;
}

/** Dia que dá para clicar: fechado (antes de hoje, em Brasília). Hoje ainda está no prazo. */
export function diaFechado(dia: string, agora: Date = new Date()): boolean {
  const hoje = new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
  return dia < hoje;
}

/** CSV com `;` (Excel pt-BR), mesmas convenções do CSV do TikTok. */
export function csvDosAtrasados(canal: CanalAtrasados, pedidos: PedidoAtrasado[], vencimento: string): string {
  const cab = ["pedido", "marca", "status_hoje", "dia_do_prazo", "prazo", "coletado_em", "situacao"];
  const linhas = pedidos.map((p) =>
    [
      p.order_id ?? "",
      p.brand,
      rotuloStatus(canal, p.status),
      vencimento,
      (p.deadline_at ?? "").replace("T", " "),
      (p.collected_at ?? "").replace("T", " "),
      p.collected_at ? "coletado depois do prazo" : "ainda sem coleta",
    ]
      .map(celula)
      .join(";"),
  );
  return "﻿" + [cab.join(";"), ...linhas].join("\n");
}
