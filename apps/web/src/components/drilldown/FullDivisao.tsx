import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import InfoDica from "@/components/ui/InfoDica";

/** Um pedaco de barra: a classe de cor e o valor (a largura sai do valor). */
export type Segmento = { cls: string; v: number };

const soma = (s: Segmento[]) => s.reduce((a, x) => a + x.v, 0);
const pctTxt = (p: number) => `${Math.round(p * 100)}%`;

/** Resumo do topo: "86% Full" antes do absoluto, a barra, e o "Sem Full" ao lado. */
export function FullResumo({
  full,
  semFull,
  semMedida = 0,
  fmt,
  dica,
}: {
  full: number;
  semFull: number;
  /** Parte que nao tem medida de Full: fica fora do %, nunca entra em Sem Full. */
  semMedida?: number;
  fmt: (v: number) => string;
  dica: string;
}) {
  const medido = full + semFull;
  if (!(medido > 0)) return null;
  const p = full / medido;
  return (
    <DrilldownSecao titulo="Full" acao={<InfoDica texto={dica} />}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm tabular-nums">
        <span className="text-ink">
          <b className="font-semibold">{pctTxt(p)} Full</b> · {fmt(full)}
        </span>
        <span className="text-ink-muted">
          {pctTxt(1 - p)} Sem Full · {fmt(semFull)}
        </span>
      </div>
      <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-raised">
        <span className="tc-barra block h-full rounded-full bg-accent" style={{ width: `${p * 100}%` }} />
      </span>
      {semMedida > 0 && <span className="text-xs text-ink-faint tabular-nums">Sem medida de Full: {fmt(semMedida)}</span>}
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
          <Barra rotulo="Full" segs={full} pct={sf / medido} escala={escala} fmt={fmt} />
          <Barra rotulo="Sem Full" segs={semFull} pct={ss / medido} escala={escala} fmt={fmt} />
        </>
      )}
      {nd > 0 && (
        <Barra
          rotulo={nomeSemDado ?? "Sem medida"}
          dica="Sem medida de Full: a Kokeshi na Shopee chega por arquivo, sem a modalidade de envio de cada pedido."
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
  escala,
  fmt,
  dica,
}: {
  rotulo: string;
  segs: Segmento[];
  pct?: number;
  escala: number;
  fmt: (v: number) => string;
  dica?: string;
}) {
  const total = soma(segs);
  return (
    <span className="grid grid-cols-[56px_minmax(48px,1fr)_auto] items-center gap-2 text-xs text-ink-muted" title={dica}>
      <span className="truncate whitespace-nowrap">{rotulo}</span>
      <span className="relative h-2 rounded-full bg-raised" aria-hidden="true">
        <span
          className="tc-barra absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
          style={{ width: `${escala > 0 ? (total / escala) * 100 : 0}%` }}
        >
          {segs.map((s, i) => (s.v > 0 ? <span key={i} className={s.cls} style={{ flex: s.v }} /> : null))}
        </span>
      </span>
      <span className="whitespace-nowrap text-right tabular-nums">
        {pct != null && <b className="font-semibold text-ink">{pctTxt(pct)} · </b>}
        {fmt(total)}
      </span>
    </span>
  );
}
