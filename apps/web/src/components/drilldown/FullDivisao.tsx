import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import InfoDica from "@/components/ui/InfoDica";

/** Um pedaco de barra: a classe de cor e o valor (a largura sai do valor). */
export type Segmento = { cls: string; v: number };

const soma = (s: Segmento[]) => s.reduce((a, x) => a + x.v, 0);
/** Percentuais inteiros que fecham em 100: o Sem Full e' o que falta do Full arredondado. */
const pctFull = (full: number, medido: number) => Math.round((full / medido) * 100);

/** Resumo do topo: "86% Full" antes do absoluto, a barra, e o "Sem Full" ao lado. */
export function FullResumo({
  full,
  semFull,
  semMedida = 0,
  fmt,
  dica,
  estimado = false,
}: {
  /** Estimativa (proporcao aplicada ao valor), nao contagem: o titulo diz. */
  estimado?: boolean;
  full: number;
  semFull: number;
  /** Parte que nao tem medida de Full: fica fora do %, nunca entra em Sem Full. */
  semMedida?: number;
  fmt: (v: number) => string;
  dica: string;
}) {
  const medido = full + semFull;
  if (!(medido > 0)) return null;
  const p = pctFull(full, medido);
  return (
    <DrilldownSecao titulo={estimado ? "Full · estimado" : "Full"} acao={<InfoDica texto={dica} />}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm tabular-nums">
        <span className="text-ink">
          <b className="font-semibold">{p}% Full</b> · {fmt(full)}
        </span>
        <span className="text-ink-muted">
          {100 - p}% Sem Full · {fmt(semFull)}
        </span>
      </div>
      <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-raised">
        <span className="tc-barra block h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
      </span>
      {semMedida > 0 && <span className="text-xs text-ink-muted tabular-nums">Sem medida de Full: {fmt(semMedida)}</span>}
    </DrilldownSecao>
  );
}

/** Barra dupla da marca (Full e Sem Full), no desenho do bloco Marcas da Gerencial. */
export function BarrasFull({
  full,
  semFull,
  semDado,
  nomeSemDado,
  escala,
  fmt,
}: {
  full: Segmento[];
  semFull: Segmento[];
  semDado?: Segmento[];
  nomeSemDado?: string;
  /** Maior valor de barra entre as marcas: todas na mesma escala. */
  escala: number;
  fmt: (v: number) => string;
}) {
  const sf = soma(full);
  const ss = soma(semFull);
  const medido = sf + ss;
  const nd = semDado ? soma(semDado) : 0;
  return (
    <div className="flex flex-col gap-1 pb-1">
      {medido > 0 && (
        <>
          {/* O % so' na linha Full: o Sem Full e' o que falta. */}
          <Barra rotulo="Full" segs={full} pct={pctFull(sf, medido)} escala={escala} fmt={fmt} />
          <Barra rotulo="Sem Full" segs={semFull} escala={escala} fmt={fmt} />
        </>
      )}
      {nd > 0 && (
        <Barra
          rotulo="Sem medida"
          nome={nomeSemDado}
          segs={semDado!}
          escala={escala}
          fmt={fmt}
        />
      )}
    </div>
  );
}

function Barra({
  rotulo,
  segs,
  pct,
  nome,
  escala,
  fmt,
}: {
  rotulo: string;
  segs: Segmento[];
  /** Percentual inteiro, so' na linha Full. */
  pct?: number;
  /** Canal da parte sem medida, visivel (nao em title: nao abre no toque). */
  nome?: string;
  escala: number;
  fmt: (v: number) => string;
}) {
  const total = soma(segs);
  return (
    <span className="grid grid-cols-[64px_minmax(48px,1fr)_auto] items-center gap-2 text-xs text-ink-muted">
      <span className="whitespace-nowrap">{rotulo}</span>
      <span className="relative h-2 rounded-full bg-raised" aria-hidden="true">
        <span
          className="tc-barra absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
          style={{ width: `${escala > 0 ? (total / escala) * 100 : 0}%` }}
        >
          {segs.map((s, i) => (s.v > 0 ? <span key={i} className={s.cls} style={{ flex: s.v }} /> : null))}
        </span>
      </span>
      <span className="whitespace-nowrap text-right tabular-nums">
        {pct != null && <b className="font-semibold text-ink">{pct}% · </b>}
        {nome ? `${nome} · ` : ""}
        {fmt(total)}
      </span>
    </span>
  );
}
