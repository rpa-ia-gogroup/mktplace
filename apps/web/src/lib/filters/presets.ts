import type { DatePreset } from "./types";

/** Formata em YYYY-MM-DD usando componentes LOCAIS (nunca toISOString/UTC —
 * em fuso negativo como America/Sao_Paulo, toISOString() pode voltar um dia). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Ultimo dia fechado (D-1). A fato diaria so' publica dias fechados: um
 * preset que terminasse hoje somaria um dia vazio e compararia N-1 dias com
 * N, puxando comparacao e ritmo para baixo. Por isso os presets de janela
 * terminam aqui; "Hoje" e' o unico que olha o dia corrente. */
function lastClosedDay(today: Date): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
}

/** Segunda-feira da semana de `d` (a semana comeca na segunda). */
function startOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

function lastNDays(today: Date, n: number): { dateFrom: string; dateTo: string } {
  const to = lastClosedDay(today);
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (n - 1));
  return { dateFrom: toISODate(from), dateTo: toISODate(to) };
}

export function presetRange(preset: DatePreset, today: Date = new Date()): { dateFrom: string; dateTo: string } {
  switch (preset) {
    case "hoje": {
      const iso = toISODate(today);
      return { dateFrom: iso, dateTo: iso };
    }
    case "ontem":
      return lastNDays(today, 1);
    case "semana_atual": {
      // Como o mes_atual: na segunda a semana nova ainda nao tem dia fechado e
      // ancorar em D-1 devolve a semana anterior inteira.
      const to = lastClosedDay(today);
      return { dateFrom: toISODate(startOfWeek(to)), dateTo: toISODate(to) };
    }
    case "semana_passada": {
      const from = startOfWeek(today);
      from.setDate(from.getDate() - 7);
      const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
      return { dateFrom: toISODate(from), dateTo: toISODate(to) };
    }
    case "7d":
      return lastNDays(today, 7);
    case "90d":
      return lastNDays(today, 90);
    case "mes_atual": {
      // No dia 1 o mes novo ainda nao tem dia fechado: ancorar em D-1 devolve
      // o mes anterior inteiro em vez de um intervalo invertido.
      const to = lastClosedDay(today);
      return { dateFrom: toISODate(startOfMonth(to)), dateTo: toISODate(to) };
    }
    case "mes_anterior": {
      const anchor = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { dateFrom: toISODate(startOfMonth(anchor)), dateTo: toISODate(endOfMonth(anchor)) };
    }
    case "30d":
    case "personalizado":
    default:
      return lastNDays(today, 30);
  }
}

/** `grupo` separa os presets com um divisor fino no filtro (sem titulos). */
export const DATE_PRESET_OPTIONS: { value: DatePreset; label: string; grupo: number }[] = [
  { value: "hoje", label: "Hoje", grupo: 0 },
  { value: "ontem", label: "Ontem", grupo: 0 },
  { value: "semana_atual", label: "Semana atual", grupo: 1 },
  { value: "semana_passada", label: "Semana passada", grupo: 1 },
  { value: "mes_atual", label: "Mês atual", grupo: 2 },
  { value: "mes_anterior", label: "Mês anterior", grupo: 2 },
  { value: "7d", label: "7 dias", grupo: 3 },
  { value: "30d", label: "30 dias", grupo: 3 },
  { value: "90d", label: "90 dias", grupo: 3 },
  { value: "personalizado", label: "Personalizado", grupo: 4 },
];

/** Periodo imediatamente anterior de mesma duracao — espelha
 * resolve_previous_period no backend (app/deps/period.py). */
export function previousEquivalentRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { dateFrom: toISODate(prevFrom), dateTo: toISODate(prevTo) };
}

/** Quando dois presets dao o mesmo intervalo, vence o primeiro daqui: os antigos
 * mantem a precedencia de antes (numa segunda, 7 dias = semana atual = semana
 * passada, e segue "7 dias"); "Ontem" ganha do "Mes atual" de um dia so'. */
const ORDEM_DETECCAO: DatePreset[] = ["hoje", "ontem", "7d", "30d", "90d", "mes_atual", "mes_anterior", "semana_passada", "semana_atual"];

/** Detecta se um par (dateFrom, dateTo) corresponde a algum preset conhecido
 * (para destacar o botao ativo) — "personalizado" quando nao corresponde a
 * nenhum preset fixo. */
export function detectPreset(dateFrom: string, dateTo: string, today: Date = new Date()): DatePreset {
  for (const preset of ORDEM_DETECCAO) {
    const range = presetRange(preset, today);
    if (range.dateFrom === dateFrom && range.dateTo === dateTo) return preset;
  }
  return "personalizado";
}

/** Preset aceso: o CLICADO (`periodo` na URL) enquanto o intervalo ainda bater
 * com ele; sem preset guardado (ou se o dia virou e ele nao bate mais), cai na
 * deteccao. Sem isso, numa segunda "Semana atual" acendia "7 dias". */
export function resolveActivePreset(
  dateFrom: string,
  dateTo: string,
  periodo: DatePreset | undefined,
  today: Date = new Date(),
): DatePreset {
  if (periodo && periodo !== "personalizado") {
    const r = presetRange(periodo, today);
    if (r.dateFrom === dateFrom && r.dateTo === dateTo) return periodo;
  }
  return detectPreset(dateFrom, dateTo, today);
}

/** Intervalo curto para o gatilho: "10/11", "09–15/11", "28/12–03/01". */
export function intervaloCurto(dateFrom: string, dateTo: string): string {
  const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (dateFrom === dateTo) return dm(dateFrom);
  if (dateFrom.slice(0, 7) === dateTo.slice(0, 7)) return `${dateFrom.slice(8, 10)}–${dm(dateTo)}`;
  return `${dm(dateFrom)}–${dm(dateTo)}`;
}
