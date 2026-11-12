import Chip from "@/components/ui/Chip";
import {
  CLASSIFICACAO_CHIP,
  STATUS_CHIP,
  juntarNomes,
  textoPrevia,
  type AvisoMargem as AvisoMargemDados,
  type Classificacao,
  type StatusComponente,
} from "@/lib/dre";

/**
 * DRE-UX-1 — selos da DRE. O texto vem SEMPRE junto da cor: "Não calculável"
 * pintado so' de vermelho seria ilegivel para quem nao distingue a cor.
 *
 * DRE-UX-2: os selos nao carregam mais o motivo em `title`. Tooltip nativo nao
 * abre por toque nem por teclado; o motivo aparece escrito ao lado de cada
 * selo, onde ele importa.
 *
 * T-0090: competencia imatura vira o selo "Prévia · fecha em DD/MM/AAAA". Na
 * previa a completude nao entra no selo (ficaria longo demais para o mobile);
 * ela continua escrita onde a tela ja' a mostra por extenso.
 */
export function ClassificacaoChip({
  classificacao,
  completude,
  fechaEm,
  previa,
}: {
  classificacao: Classificacao;
  /** "4 de 6 custos". `null` = nao exibir (agregado nao calculavel). */
  completude?: string | null;
  /** T-0090 — `fecha_em` da celula (opcional). */
  fechaEm?: string | null;
  /** T-0090 — `previa` da celula (opcional). */
  previa?: boolean | null;
}) {
  const selo = textoPrevia({ classificacao, previa, fecha_em: fechaEm });
  if (classificacao === "PREVIA") {
    return (
      <Chip tom={CLASSIFICACAO_CHIP.PREVIA.tom} ponto>
        {selo}
      </Chip>
    );
  }
  const c = CLASSIFICACAO_CHIP[classificacao];
  const principal = (
    <Chip tom={c.tom} ponto>
      {c.rotulo}
      {completude && classificacao !== "NAO_CALCULAVEL" ? ` · ${completude}` : ""}
    </Chip>
  );
  if (!selo) return principal;
  // `previa: true` com outra classificacao: o selo de previa vem ao lado.
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {principal}
      <Chip tom={CLASSIFICACAO_CHIP.PREVIA.tom}>{selo}</Chip>
    </span>
  );
}

/**
 * T-0101 — margem suspensa por insumo vencido/ausente. Tom de aviso ja'
 * existente; o texto ao lado diz desde quando.
 */
export function MargemSuspensaChip() {
  return <Chip tom="atencao">Margem suspensa</Chip>;
}

export function StatusChip({ status }: { status: StatusComponente }) {
  const c = STATUS_CHIP[status];
  if (!c) return null;
  return <Chip tom={c.tom}>{c.rotulo}</Chip>;
}

/**
 * T-0090 — margem conhecida que inclui custo parcial DIZ isso, com o aviso do
 * backend. `aviso = null` (API anterior ou nada a avisar): nao renderiza.
 */
export function AvisoMargem({ aviso, className = "" }: { aviso: AvisoMargemDados | null; className?: string }) {
  if (!aviso) return null;
  return (
    <span className={`flex flex-col items-start gap-1 text-xs font-normal text-ink-muted ${className}`}>
      {aviso.parciais.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <Chip tom="atencao">Inclui custos parciais</Chip>
          <span>{juntarNomes(aviso.parciais)}</span>
        </span>
      )}
      {aviso.aviso && <span>{aviso.aviso}</span>}
    </span>
  );
}
