/**
 * Secao "Qualidade da resposta" do detalhe da Taxa de resposta (Shopee e ML):
 * por marca, o tempo ate' a 1a resposta (SLA de 1 dia) e a fila de agora.
 * Acima do SLA = texto vermelho + "fora do SLA" (cor nunca sozinha).
 */
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import InfoDica from "@/components/ui/InfoDica";
import type { QualidadeResposta as Dados } from "@/lib/cx-qualidade";

const TH = "px-2 py-1.5 text-left text-xs font-medium text-ink-muted";
const TD = "px-2 py-2 align-top tabular-nums";

function Valor({ texto, fora, detalhe }: { texto: string; fora: boolean; detalhe: string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={fora ? "font-semibold text-crit-ink" : "font-semibold text-ink"}>{texto}</span>
      {fora && <span className="text-xs font-medium text-crit-ink">fora do SLA</span>}
      {detalhe.map((d) => (
        <span key={d} className="text-xs text-ink-faint">{d}</span>
      ))}
    </div>
  );
}

export default function QualidadeResposta({ v, ajuda }: { v: Dados; ajuda: string }) {
  if (!v.linhas.length) return null;
  return (
    <DrilldownSecao titulo="Qualidade da resposta" acao={<InfoDica titulo="Qualidade da resposta" texto={`${ajuda} Acima de 1 dia = fora do SLA (vermelho).`} />}>
      <div>
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Tempo até a primeira resposta e fila de agora, por marca</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${TH} w-[28%]`}>Marca</th>
              <th scope="col" className={TH}>1ª resposta (média)</th>
              <th scope="col" className={TH}>Aguardando agora</th>
            </tr>
          </thead>
          <tbody>
            {v.linhas.map((l) => (
              <tr key={l.chave} className="border-b border-line last:border-0">
                <th scope="row" className={`${TD} break-words text-left font-medium text-ink`}>{l.marca}</th>
                <td className={TD}><Valor texto={l.tempo} fora={l.tempoFora} detalhe={l.tempoDetalhe} /></td>
                <td className={TD}><Valor texto={l.fila} fora={l.filaFora} detalhe={l.filaDetalhe} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">{v.semFonte}</p>
    </DrilldownSecao>
  );
}
