"use client";

/**
 * COMPARAR-CANAIS (pedido da operacao, 09/11/2026) — "Mais vendidos por marca"
 * no modo "Comparar canais": o mesmo produto (seller SKU) em cada canal, pela
 * FATIA da receita da marca naquele canal. Nunca R$ (canais tem tamanhos
 * diferentes) e nunca 0% para quem nao vende: "—" com o motivo.
 *
 * Spec do Prumo: ate' 3 achados no topo; top 10 pela maior fatia (empate pela
 * soma) com "Ver top 20"; cada celula abre o detalhe daquele canal; selo
 * "forte no X" / "sem venda no Y" em accent (nao e' bom nem ruim).
 */
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import TableScrollHint from "@/components/TableScrollHint";
import Segmented from "@/components/ui/Segmented";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import {
  CANAL_CURTO, COBERTURA_MINIMA, achadosDaMarca, fmtFatia, noCanal, oportunidadesNoCanal, seloDoProduto,
  textoDaOportunidade, textoDoSelo,
  type CanalTop, type MarcaComparada, type ProdutoComparado,
} from "@/lib/gerencial/top-produtos";

const VISIVEIS = 10;
const TH = "py-2 px-2 text-xs font-semibold uppercase tracking-wide text-ink-faint";

export default function TopProdutosComparar({
  m, abrir,
}: {
  m: MarcaComparada;
  abrir: (p: ProdutoComparado, canal: CanalTop) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [foco, setFoco] = useState<CanalTop | "todos">("todos");
  const canais = m.canais.map((c) => c.canal);
  const parciais = m.canais.filter((c) => c.cobertura < COBERTURA_MINIMA);

  if (canais.length < 2) {
    return (
      <p className="text-sm text-ink-faint">
        Esta marca vendeu em um canal só no período: não há o que comparar.
      </p>
    );
  }
  // Canal da oportunidade so' entre os canais que a marca tem (troca de marca volta a "todos").
  const canalOp = foco !== "todos" && canais.includes(foco) ? foco : null;
  const oportunidades = canalOp ? oportunidadesNoCanal(m, canalOp) : [];
  // Com canal escolhido a tabela ja' lista as oportunidades: o topo vira UMA linha de resumo.
  const achados = !canalOp
    ? achadosDaMarca(m)
    : oportunidades.length
      ? [{
          chave: "resumo",
          texto: `${oportunidades.length} ${oportunidades.length === 1 ? "produto forte" : "produtos fortes"} em outros canais e ${oportunidades.length === 1 ? "fraco" : "fracos"} ${noCanal(canalOp)}. Maior lacuna: ${oportunidades[0].produto.produto} (${textoDaOportunidade(oportunidades[0], canalOp).slice(oportunidades[0].produto.produto.length + 2)}).`,
        }]
      : [];
  const parcialNoFoco = canalOp ? parciais.find((c) => c.canal === canalOp) : undefined;
  const lista = canalOp ? oportunidades.map((o) => o.produto) : m.produtos;
  const visiveis = aberta ? lista : lista.slice(0, VISIVEIS);

  return (
    <div className="flex flex-col gap-3">
      {parciais.length > 0 && (
        <span
          className="inline-flex w-fit items-center rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink"
          title={parciais.map((c) => `${CANAL_CURTO[c.canal]}: ${fmtFatia(c.cobertura)} da receita com SKU`).join(" · ")}
        >
          Cobertura parcial
          <span className="sr-only">
            : {parciais.map((c) => `${CANAL_CURTO[c.canal]} ${fmtFatia(c.cobertura)} da receita com SKU`).join(", ")}
          </span>
        </span>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span id={`op-${m.marca}`} className="text-sm text-ink-muted">Oportunidade em:</span>
        <Segmented
          rotulo="Oportunidade em"
          rotuladoPor={`op-${m.marca}`}
          opcoes={[
            { valor: "todos", texto: "Todos" },
            ...canais.map((c) => ({ valor: c, texto: CANAL_CURTO[c] })),
          ]}
          valor={canalOp ?? "todos"}
          aoEscolher={(v) => { setFoco(v); setAberta(false); }}
        />
      </div>

      {parcialNoFoco && canalOp && (
        <p className="text-sm text-warn-ink">
          {`${noCanal(canalOp).replace(/^n/, "N")}, só ${fmtFatia(parcialNoFoco.cobertura)} da receita tem SKU: "sem venda" pode ser produto sem SKU.`}
        </p>
      )}

      <section aria-label="Achados entre canais" className="rounded-lg bg-raised px-3 py-2">
        {achados.length ? (
          <ul className="flex flex-col gap-1">
            {achados.map((a) => (
              <li key={a.chave} className="text-sm leading-snug text-ink">{a.texto}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            {canalOp
              ? `Nenhum produto forte nos outros canais e fraco ${noCanal(canalOp)} neste período.`
              : "Sem diferença forte entre canais neste período."}
          </p>
        )}
      </section>

      <div className="hidden sm:block">
      <TableScrollHint>
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">
            Produtos da marca com a fatia de cada um na receita da marca em cada canal. Traço quando o produto não vende no canal.
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${TH} text-left`}>Produto</th>
              {canais.map((c) => (
                <th key={c} scope="col" className={`${TH} w-32 text-right ${c === canalOp ? "bg-accent-soft/60 text-accent-ink" : ""}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${CHANNEL_DOT[c]}`} />
                    {CANAL_CURTO[c]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => (
              <Linha key={p.chave} p={p} canais={canais} abrir={abrir} foco={canalOp} />
            ))}
          </tbody>
        </table>
      </TableScrollHint>
      </div>

      {/* Abaixo de sm: nome na largura toda; os % dos canais embaixo, com selo e Kit na mesma linha. */}
      {/* Legenda: no celular o canal nao pode ficar so' na cor do ponto. */}
      <p className="flex flex-wrap gap-x-3 text-xs text-ink-muted sm:hidden" aria-hidden="true">
        {canais.map((c) => (
          <span key={c} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${CHANNEL_DOT[c]}`} />
            {CANAL_CURTO[c]}
          </span>
        ))}
      </p>
      <ul className="flex flex-col sm:hidden" aria-label="Produtos da marca com a fatia em cada canal">
        {visiveis.map((p) => (
          <ItemMovel key={p.chave} p={p} canais={canais} abrir={abrir} />
        ))}
      </ul>

      {lista.length > VISIVEIS && (
        <button
          type="button"
          onClick={() => setAberta((a) => !a)}
          aria-expanded={aberta}
          className="inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-xs font-semibold text-accent hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {canalOp
            ? aberta ? `Mostrar só as ${VISIVEIS} maiores` : `Ver as ${lista.length} oportunidades`
            : aberta ? `Mostrar só o top ${VISIVEIS}` : `Ver top ${lista.length}`}
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${aberta ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

function Linha({
  p, canais, abrir, foco,
}: {
  p: ProdutoComparado; canais: CanalTop[]; abrir: (p: ProdutoComparado, canal: CanalTop) => void;
  /** Canal da oportunidade: a coluna ganha fundo. */
  foco: CanalTop | null;
}) {
  const selo = seloDoProduto(p, canais);
  const fatias = new Map(p.celulas.map((c) => [c.canal, c.fatia]));
  const maior = Math.max(...p.celulas.map((c) => c.fatia));
  return (
    <tr className="border-b border-line last:border-b-0">
      <th scope="row" className="px-2 py-2 text-left align-top font-normal">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-ink" title={p.produto}>{p.produto}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {selo && (
            <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent-ink">
              {textoDoSelo(selo)}
            </span>
          )}
          {p.kit && <span className="rounded-md bg-raised px-1.5 py-0.5 text-xs font-semibold text-ink-muted">Kit</span>}
        </span>
      </th>
      {canais.map((c) => {
        const f = fatias.get(c);
        if (f === undefined) {
          return (
            <td key={c} className={`px-2 py-2 text-right align-top text-sm text-ink-faint ${c === foco ? "bg-accent-soft/40" : ""}`} title={`Sem venda ${noCanal(c)} no período`}>
              <span aria-hidden="true">—</span>
              <span className="sr-only">sem venda {noCanal(c)} no período</span>
            </td>
          );
        }
        return (
          <td key={c} className={`px-1 py-1 text-right align-top ${c === foco ? "bg-accent-soft/40" : ""}`}>
            <button
              type="button"
              onClick={() => abrir(p, c)}
              aria-haspopup="dialog"
              aria-label={`${p.produto}: ${fmtFatia(f)} da receita da marca ${noCanal(c)}. Abrir detalhe`}
              className="inline-flex min-h-11 w-full flex-col items-end justify-center gap-1 rounded-lg px-1 hover:bg-accent-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className={`tabular-nums text-sm ${f === maior ? "font-semibold text-ink" : "text-ink-muted"}`}>
                {fmtFatia(f)}
              </span>
              <span aria-hidden="true" className="h-1 w-full max-w-20 rounded-full bg-raised">
                <span
                  className={`block h-1 rounded-full ${CHANNEL_DOT[c]}`}
                  style={{ width: `${Math.min(100, (f / maior) * 100)}%` }}
                />
              </span>
            </button>
          </td>
        );
      })}
    </tr>
  );
}

function ItemMovel({
  p, canais, abrir,
}: { p: ProdutoComparado; canais: CanalTop[]; abrir: (p: ProdutoComparado, canal: CanalTop) => void }) {
  const selo = seloDoProduto(p, canais);
  const fatias = new Map(p.celulas.map((c) => [c.canal, c.fatia]));
  const maior = Math.max(...p.celulas.map((c) => c.fatia));
  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <p className="line-clamp-2 text-sm font-medium leading-snug text-ink" title={p.produto}>{p.produto}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${canais.length}, minmax(3.25rem, auto))` }}>
          {canais.map((c) => {
            const f = fatias.get(c);
            const rotulo = (
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CHANNEL_DOT[c]}`} />
            );
            if (f === undefined) {
              return (
                <span key={c} className="inline-flex min-h-11 items-center gap-1 px-0.5 text-sm text-ink-faint" title={`Sem venda ${noCanal(c)} no período`}>
                  {rotulo}
                  <span className="sr-only">{CANAL_CURTO[c]}:</span>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">sem venda {noCanal(c)} no período</span>
                </span>
              );
            }
            return (
              <button
                key={c}
                type="button"
                onClick={() => abrir(p, c)}
                aria-haspopup="dialog"
                aria-label={`${p.produto}: ${fmtFatia(f)} da receita da marca ${noCanal(c)}. Abrir detalhe`}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-0.5 hover:bg-accent-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {rotulo}
                <span className="sr-only">{CANAL_CURTO[c]}:</span>
                <span className={`tabular-nums text-sm ${f === maior ? "font-semibold text-ink" : "text-ink-muted"}`}>{fmtFatia(f)}</span>
              </button>
            );
          })}
        </div>
        {selo && (
          <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent-ink">{textoDoSelo(selo)}</span>
        )}
        {p.kit && <span className="rounded-md bg-raised px-1.5 py-0.5 text-xs font-semibold text-ink-muted">Kit</span>}
      </div>
    </li>
  );
}
