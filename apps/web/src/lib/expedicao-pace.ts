/**
 * Ritmo de despacho e "Dias de backlog" = backlog / media de despachados por
 * dia nos 2 ultimos dias uteis fechados.
 *
 * A API (`/api/v1/expedicao/despachados`) publica a media; a divisao e' feita
 * aqui. Sem dado = `null` ("—"), nunca zero nem infinito.
 *
 * SHOPEE: o ritmo exclui FBS, entao so' o backlog do VENDEDOR fecha com ele. A
 * tela mostra essa fila numa coluna propria (`backlogVendedor`) e divide por
 * ela; sem a divisao vendedor x FBS, a coluna de dias some (`paceDisponivel`).
 */

export type CanalPace = "shopee" | "mercadolivre";

export interface DiaPace {
  dia: string;
  despachados: number | null;
}

export interface ContaPace {
  channel: string;
  brand: string;
  media_2du: number | null;
}

export interface RespostaPace {
  availability: string;
  business_days?: string[];
  contas: ContaPace[];
  totais?: { channel: string; dias: DiaPace[] }[];
}

/** Aviso visivel (rodape do painel) quando a Shopee nao tem a fila do vendedor. */
export const AVISO_PACE_INDISPONIVEL =
  "Dias de backlog indisponíveis: a fila do vendedor não veio separada do FBS.";

export function urlPace(api: string, canal: CanalPace): string {
  return `${api}/api/v1/expedicao/despachados?${new URLSearchParams({ channel: canal }).toString()}`;
}

/** As colunas de ritmo/dias aparecem? Shopee so' com a fila do vendedor separada do FBS. */
export function paceDisponivel(canal: string, temDivisaoVendedor: boolean): boolean {
  return canal !== "shopee" || temDivisaoVendedor;
}

/** Media de despachados/dia da marca no canal, ou `null` se a API nao trouxe. */
export function mediaDaMarca(r: RespostaPace | null, canal: string, marca: string): number | null {
  if (!r || r.availability !== "available") return null;
  const c = r.contas.find((x) => x.channel === canal && x.brand === marca);
  return typeof c?.media_2du === "number" ? c.media_2du : null;
}

/** Backlog dividido pelo ritmo; `null` sem backlog valido ou sem ritmo (media 0 ou ausente). */
export function diasDeBacklog(backlog: number | null | undefined, media: number | null | undefined): number | null {
  if (typeof backlog !== "number" || typeof media !== "number") return null;
  if (!Number.isFinite(backlog) || !Number.isFinite(media) || media <= 0 || backlog < 0) return null;
  return backlog / media;
}

/**
 * Dias de backlog de UMA linha (conta). Marca com mais de uma conta: o ritmo
 * e' da marca, o backlog e' da conta — nao se divide (`null`). Shopee divide a
 * fila do vendedor (a mesma que a coluna propria mostra).
 */
export function diasDaLinha(o: {
  canal: string;
  backlog: number | null | undefined;
  backlogVendedor: number | null | undefined;
  media: number | null | undefined;
  variasContas: boolean;
}): number | null {
  if (o.variasContas) return null;
  return diasDeBacklog(o.canal === "shopee" ? o.backlogVendedor : o.backlog, o.media);
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "2026-11-05" -> "qui 05" (dia civil, sem fuso). */
export function rotuloDoDia(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${SEMANA[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Texto do "ⓘ": quais dias entraram na media (um dia sem dado nao conta). */
export function textoDoPace(canal: string, r: RespostaPace | null): string {
  const fora = canal === "shopee" ? "FBS" : "Full";
  const dias = r?.totais?.find((t) => t.channel === canal)?.dias ?? [];
  const com = dias.filter((d) => d.despachados !== null).map((d) => rotuloDoDia(d.dia));
  const sem = dias.filter((d) => d.despachados === null).map((d) => rotuloDoDia(d.dia));
  const divisao = canal === "shopee" ? "Backlog sem FBS ÷ ritmo" : "backlog ÷ ritmo";
  let media = "Média dos 2 últimos dias úteis fechados";
  if (com.length === 2) media = `Média de ${com[0]} e ${com[1]}`;
  else if (com.length === 1) media = `Média só ${com[0]}${sem.length ? ` (${sem[0].split(" ")[0]} sem dado)` : ""}`;
  else if (dias.length) media = `Sem dado em ${sem.join(" e ")}: ritmo indisponível`;
  return (
    `Ritmo/dia: média de pedidos despachados por dia. ${media} (seg–sex, sem feriado nacional). ` +
    `Dias de backlog = ${divisao}. Só a operação do vendedor (sem ${fora}); dia sem dado não conta.`
  );
}
