/**
 * Financeiro no padrao da Gerencial (decisao de 10/11/2026): os 3 paineis por canal viram 3
 * cartoes de GMV (KpiTile gerencial), e o clique abre o detalhe com os componentes de custo
 * CONHECIDOS do canal. Nada e' somado; ausencia nunca vira zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { gmvExato } from "../src/lib/financeiro-cartoes.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("GMV exato no topo do detalhe (o cartao mostra o curto); sem GMV, nada (nunca R$ 0)", () => {
  assert.equal(gmvExato(3_920_000)?.split(String.fromCharCode(160)).join(" "), "R$ 3.920.000");
  assert.equal(gmvExato(null), null);
});

test("cartoes: KpiTile gerencial gmv, canal e' ponto, um por canal selecionado, sempre clicavel", () => {
  const src = ler("src/components/financeiro/FinanceiroCartoes.tsx");
  assert.ok(src.includes('variante="gerencial"') && src.includes('identidade="gmv"') && src.includes("icone={CircleDollarSign}"));
  assert.ok(src.includes("${p.ponto}") && !/bg-canal-[a-z]+\/|border-canal/.test(src), "canal so' como ponto, nunca cor de cartao");
  assert.ok(src.includes("onAbrir={() => onAbrir(p.canal)}"));
  assert.ok(src.includes('comparacao={p.gmv != null ? "Ver custos conhecidos" : "Sem dado no período"}') && src.includes('tom={p.gmv != null ? "neutro" : "ausente"}'), "sem GMV: motivo visivel, nunca zero");
  assert.ok(src.includes('"col-span-2 lg:col-span-1"') && src.includes("paineis.length % 2 === 1"), "cartao impar fecha a linha no celular");
  assert.ok(src.includes("<InfoDica emControle texto={p.aviso} />"), "ressalva de tarifa parcial no ⓘ do cartao");
});

test("detalhe: valor exato, periodo e frescor, e os componentes conhecidos (lista reaproveitada do painel antigo)", () => {
  const det = ler("src/components/financeiro/FinanceiroDrilldownContent.tsx");
  assert.ok(det.includes("<ListaDeCustos linhas={painel.linhas} barra={painel.ponto} />") && det.includes('titulo="Componentes conhecidos"'));
  assert.ok(det.includes("<DrilldownContextLine") && det.includes("NumeroAnimado"));
  const lista = ler("src/components/financeiro/ChannelCostPanel.tsx");
  assert.ok(lista.includes("export default function ListaDeCustos") && !lista.includes("export default function ChannelCostPanel"), "o painel por canal saiu");
  // as linhas continuam sem soma e com ausencia declarada (nunca zero)
  assert.ok(lista.includes("l.ausente ?") && lista.includes("border-dashed"));
  assert.doesNotMatch(lista, /reduce\(|\+ \w+\.valor|total/, "nada e' somado");
});

test("pagina: cartoes e dialogo unico; painel antigo e formatos ingleses fora; estados e rotulos de custo preservados", () => {
  const pag = ler("app/financeiro/page.tsx");
  assert.ok(!pag.includes("ChannelCostPanel") && !/\bfmtBrl\(/.test(pag) && !/\.toFixed\(/.test(pag));
  assert.equal((pag.match(/<KpiDrilldownDialog/g) ?? []).length, 1);
  assert.ok(pag.includes("<FaixaGmvCanais paineis={paineis} onAbrir={setDetalhe} />") && pag.includes("<FaixaCarregando cartoes={paineis.length || 1}"));
  assert.ok(pag.includes('identidade="gmv"') && pag.includes("{painelAberto && dataIsFresh && ("), "detalhe so' com dado fresco");
  assert.ok(pag.includes("Receita (GMV) por canal"));
  // a tela segue sem fechar margem: nenhum total de custos
  for (const rotulo of ["Taxas e encargos", "Repasse recebido", "Tarifa ML", "Ads + frete / GMV", "Frete do seller", "Competências podem divergir."]) assert.ok(pag.includes(rotulo), rotulo);
  assert.ok(pag.includes("Margem ainda não fechada."));
  assert.ok(pag.includes('tipo="erro"') && pag.includes('tipo="vazio"'));
});

test("formato da casa nos percentuais e no ROAS da tela ('29,9%', '12,8x'), ausencia '—'", () => {
  const pag = ler("app/financeiro/page.tsx");
  assert.ok(pag.includes("return v == null ? \"—\" : fmtPctSimples(v);") && pag.includes("return v == null ? \"—\" : fmtVezes(v);"));
});

test("o cartao diz onde o custo foi parar; o ⓘ do ML diz de qual numero fala; percentual antes do valor; sem selo repetido", () => {
  const cartoes = ler("src/components/financeiro/FinanceiroCartoes.tsx");
  assert.ok(cartoes.includes('"Ver custos conhecidos"'));
  const pag = ler("app/financeiro/page.tsx");
  assert.ok(pag.includes("`Custos: tarifa parcial, ${mlSemTarifa}") && pag.includes("Veja no detalhe."));
  const det = ler("src/components/financeiro/FinanceiroDrilldownContent.tsx");
  assert.ok(!det.includes('leading="GMV"'), "o titulo do modal ja' diz GMV");
  const lista = ler("src/components/financeiro/ChannelCostPanel.tsx");
  assert.ok(lista.indexOf("{l.pctTexto &&") < lista.indexOf("{l.valor &&"), "percentual antes do valor absoluto");
});
