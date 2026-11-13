/**
 * UI-FUNDACAO (F1) — o selo de frescor UNICO das abas: "Atualizado 21:10".
 *
 * Substitui, aba a aba (F2/F3), o "Ao vivo · Atualizado em…" (`Freshness`) e o
 * "Última atualização 12/11, 21:10" da Expedicao. Um formato so':
 *   - com horario: "Atualizado HH:MM" (outro dia: "Atualizado dd/mm HH:MM"),
 *     com o ponto verde quando a fonte esta' ao vivo;
 *   - carregando sem horario ainda: "Atualizando…";
 *   - demonstracao (API offline): o aviso continua ESCRITO, nunca so' cor;
 *   - sem horario publicado: "Atualizado —" (ausencia nunca vira um horario).
 * O detalhe (fonte, idade) vai no `title`, nao em texto na tela.
 */
import { rotuloAtualizado } from "@/lib/atualizado";

const BASE =
  "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium ring-1 ring-inset";

export default function SeloAtualizado({
  em,
  aoVivo = null,
  carregando = false,
  detalhe,
}: {
  /** ISO do horario dos dados na tela (nunca o da requisicao anterior). */
  em: string | null;
  /** `true` ao vivo, `false` demonstracao, `null` ainda nao se sabe. */
  aoVivo?: boolean | null;
  carregando?: boolean;
  /** Fonte, idade, ressalva: vai no `title`. */
  detalhe?: string;
}) {
  if (aoVivo === false) {
    return (
      <span
        title="Modo demonstração: a API está offline e os números são de exemplo"
        className={`${BASE} bg-warn-soft text-warn-ink ring-warn/30`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
        Demonstração · API offline
      </span>
    );
  }
  const hora = rotuloAtualizado(em);
  if (!hora && carregando) {
    return (
      <span role="status" className={`${BASE} bg-raised text-ink-muted ring-line`}>
        Atualizando…
      </span>
    );
  }
  return (
    <span title={detalhe} className={`${BASE} bg-surface text-ink-muted ring-line`} data-testid="selo-atualizado">
      {aoVivo ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ok" /> : null}
      {aoVivo ? <span className="sr-only">Ao vivo · </span> : null}
      Atualizado <span className="tabular-nums text-ink">{hora ?? "—"}</span>
    </span>
  );
}
