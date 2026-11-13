"use client";

/**
 * Gate EXPEDICAO-UX-UNIFICADA-1 — o cabecalho que os tres canais compartilham.
 *
 * Duas faixas, com papeis diferentes:
 *
 *   1. a faixa STICKY (PageBar): o titulo (com o canal) e a fotografia —
 *      publicacao e frescor. E' o que precisa continuar visivel durante a
 *      rolagem de uma fila de 100 linhas;
 *   2. a BARRA DE FILTROS (FILTROS-PADRAO, como nas outras abas), que rola com a
 *      pagina: Canal · Marca · Período · [controles do canal] e, a direita,
 *      a profundidade (visao do gestor / detalhe operacional). No mobile,
 *      cinco seletores dentro da faixa sticky comiam metade da tela.
 *
 * O componente nao conhece canal nenhum: recebe o rotulo, a `Fotografia` que o
 * contrato do canal montou e os controles que o painel quiser pendurar.
 */
import type { ReactNode } from "react";
import { CalendarDays, Check } from "lucide-react";

import BrandFilter from "@/components/BrandFilter";
import Chip from "@/components/ui/Chip";
import Popover from "@/components/ui/Popover";
import PageBar from "@/components/ui/PageBar";
import InfoDica from "@/components/ui/InfoDica";
import Segmented from "@/components/ui/Segmented";
import { ROTULO_VISAO, VISOES, type Fotografia, type Visao } from "@/lib/expedicao-ux";
import { OPCAO_PERSONALIZADA } from "@/lib/expedicao-janela";
import { marcaUnica } from "@/lib/cx";
import { ALL_BRAND_OPTIONS, brandLabel } from "@/lib/filters/brands";

/** Ancora da faixa de controles — o convite ao detalhe leva o foco ate' ela. */
export const ID_FAIXA_DE_CONTROLES = "exp-controles";

/** "30/10, 16:10", no fuso do navegador. */
function dataHoraCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * EXPEDICAO-ULTIMA-ATUALIZACAO (pedido de 30/10/2026): no topo, UM selo —
 * "Última atualização 30/10, 16:10". "Fotografia", "Atualizada" e "Fonte até"
 * sairam da tela; a idade e a leitura da fonte ficam no `title` do selo.
 *
 * So' o aviso "Desatualizada" continua aparecendo, e ESCRITO (nao so'
 * pintado de ambar): cor nao pode ser o unico sinal de que os numeros
 * abaixo descrevem o passado. O veredito e' do contrato do canal.
 */
export function ChipsFotografia({ fotografia: f }: { fotografia: Fotografia }) {
  const detalhe = [
    f.idade !== null ? `Publicada há ${f.idade}.` : null,
    f.fonteLidaAte ? `Fonte lida até ${dataHoraCurta(f.fonteLidaAte)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <Chip title={detalhe || undefined}>
        Última atualização{" "}
        {f.publicadaEm ? <time dateTime={f.publicadaEm}>{dataHoraCurta(f.publicadaEm)}</time> : "—"}
      </Chip>
      {f.publicadaEm && f.desatualizada ? (
        <Chip ponto tom="atencao" title="Os números descrevem o instante da publicação, não agora.">
          Desatualizada
        </Chip>
      ) : null}
    </>
  );
}

/**
 * Filtro de marca comum aos tres canais. Opcoes: o mapa canonico de marcas
 * mais qualquer marca que o payload trouxer (nunca some uma marca nova).
 * FILTROS-PADRAO: o mesmo gatilho de Marca das outras abas (`BrandFilter`
 * menu); a Expedicao le' UMA marca, entao vale a ultima escolhida (`marcaUnica`).
 */
export function SeletorMarca({
  marca,
  marcasPresentes,
  aoTrocar,
}: {
  marca: string | null;
  marcasPresentes: readonly string[];
  aoTrocar: (m: string | null) => void;
}) {
  const opcoes = [...new Set([...ALL_BRAND_OPTIONS.map((b) => b.value), ...marcasPresentes, ...(marca ? [marca] : [])])];
  return (
    <BrandFilter
      variante="menu"
      opcoes={opcoes.map((m) => ({ value: m, label: brandLabel(m) }))}
      value={marca ? [marca] : []}
      onChange={(escolha) => aoTrocar(marcaUnica(escolha, marca))}
    />
  );
}

/** Mesmas classes das opcoes do Periodo nas outras abas (`DateRangeFilter` menu). */
const OPCAO =
  "inline-flex w-full shrink-0 items-center justify-between min-h-11 min-w-11 px-3 rounded-md text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const OPCAO_ATIVA = "bg-surface font-semibold text-ink shadow-sm ring-1 ring-inset ring-line-strong";
const OPCAO_INATIVA = "text-ink-muted hover:bg-surface/70 hover:text-ink";

/**
 * FILTROS-PADRAO — a janela da Expedicao (24 h / 72 h / 7 d / Personalizado)
 * no mesmo gatilho de Periodo das outras abas. "Personalizado" nao fecha: o
 * campo "Últimos N dias" aparece no proprio painel. Regra e URL sao do painel.
 */
export function SeletorPeriodo({
  opcoes,
  valor,
  dias,
  aoEscolher,
  personalizado,
  ajuda,
}: {
  opcoes: readonly { valor: string; texto: string }[];
  /** Opcao acesa (`valorDoSeletor`). */
  valor: string;
  /** Janela em vigor, para o gatilho dizer "Últimos N dias" no personalizado. */
  dias: number;
  aoEscolher: (valor: string) => void;
  /** O campo `JanelaPersonalizada`, montado pelo painel. */
  personalizado: ReactNode;
  /** "ⓘ" do periodo consultado, ao lado do gatilho. */
  ajuda?: ReactNode;
}) {
  const atual =
    valor === OPCAO_PERSONALIZADA
      ? `Últimos ${dias} ${dias === 1 ? "dia" : "dias"}`
      : (opcoes.find((o) => o.valor === valor)?.texto ?? "—");
  return (
    <span className="inline-flex items-center gap-1">
      <Popover
        rotulo="Período"
        valor={atual}
        icone={<CalendarDays aria-hidden="true" className="h-4 w-4 text-ink-faint" />}
        largura="w-60"
      >
        {(fechar) => (
          <div className="flex flex-col gap-1">
            <div role="group" aria-label="Janela da Expedição" className="flex flex-col gap-0.5">
              {opcoes.map((o) => {
                const ativo = o.valor === valor;
                return (
                  <button
                    key={o.valor}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => {
                      aoEscolher(o.valor);
                      if (o.valor !== OPCAO_PERSONALIZADA) fechar();
                    }}
                    className={`${OPCAO} ${ativo ? OPCAO_ATIVA : OPCAO_INATIVA}`}
                  >
                    {o.texto}
                    {ativo && <Check aria-hidden="true" className="h-4 w-4 text-accent" />}
                  </button>
                );
              })}
            </div>
            {valor === OPCAO_PERSONALIZADA ? <div className="border-t border-line px-1 pt-2">{personalizado}</div> : null}
          </div>
        )}
      </Popover>
      {ajuda}
    </span>
  );
}

export default function CabecalhoExpedicao({
  canal,
  seletorCanal,
  fotografia,
  visao,
  aoTrocarVisao,
  controles,
  definicao,
  filtroMarca,
}: {
  /** Rotulo do canal, que vai NO TITULO: numero de uma loja sob o titulo de
   *  outra foi o defeito do EXP-3C2-R/V. */
  canal: string;
  seletorCanal?: ReactNode;
  fotografia: Fotografia | null;
  visao: Visao;
  aoTrocarVisao?: (v: Visao) => void;
  controles?: ReactNode;
  /** Uma linha: o que esta tela mede neste canal (EXPEDICAO-UX-3). */
  definicao?: string;
  /** `SeletorMarca` montado pelo painel, com as marcas do payload. */
  filtroMarca?: ReactNode;
}) {
  return (
    <>
      <PageBar
        titulo={
          <>
            {/* h2, nao h1: o h1 da pagina e' do shell. */}
            <h2 className="text-base font-semibold tracking-tight text-ink">
              Expedição — {canal}
            </h2>
            {/* UI-EXPEDICAO-1: a definicao vira um "ⓘ" ao lado do titulo. */}
            {definicao ? (
              <span data-testid="exp-definicao" className="inline-flex">
                <InfoDica texto={definicao} />
              </span>
            ) : null}
          </>
        }
        meta={fotografia ? <ChipsFotografia fotografia={fotografia} /> : undefined}
      />
      {/* FILTROS-PADRAO: a ordem das outras abas — Canal · Marca · Período ·
          [controles do canal] e, a direita, a profundidade. Sem rotulos soltos:
          cada controle diz o que e' (gatilho com nome, ou rotulo acessivel). */}
      {seletorCanal || aoTrocarVisao || controles || filtroMarca ? (
        <div
          id={ID_FAIXA_DE_CONTROLES}
          className="flex scroll-mt-24 flex-wrap items-center gap-x-2 gap-y-2"
        >
          {seletorCanal}
          {filtroMarca}
          {controles}
          {aoTrocarVisao ? (
            <div className="sm:ml-auto">
              <Segmented
                rotulo="Profundidade"
                opcoes={VISOES.map((v) => ({ valor: v, texto: ROTULO_VISAO[v] }))}
                valor={visao}
                aoEscolher={aoTrocarVisao}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
