/**
 * UI-FUNDACAO (F1) — o texto do selo "Atualizado HH:MM", igual em todas as abas.
 *
 * Hoje (no fuso de Brasília) basta a hora; outro dia leva a data junto, para
 * um numero velho nunca parecer de agora. Horario ausente ou invalido devolve
 * `null`: quem chama mostra "—", nunca inventa um horario.
 */
const FUSO = "America/Sao_Paulo";

function partes(d: Date): { dia: string; hora: string } {
  const dia = d.toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
  return { dia, hora };
}

export function rotuloAtualizado(iso: string | null | undefined, agora: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = partes(d);
  return p.dia === partes(agora).dia ? p.hora : `${p.dia} ${p.hora}`;
}
