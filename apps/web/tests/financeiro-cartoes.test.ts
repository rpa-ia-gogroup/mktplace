/**
 * Financeiro no padrao da Gerencial (decisao de 10/11/2026): os 3 paineis por canal viram 3
 * cartoes de GMV (KpiTile gerencial), e o clique abre o detalhe com os componentes de custo
 * CONHECIDOS do canal. Nada e' somado; ausencia nunca vira zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { gmvExato } from "../src/lib/financeiro-cartoes.ts";
import { serieQueConfere } from "../src/lib/serie-que-confere.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("GMV exato no topo do detalhe (o cartao mostra o curto); sem GMV, nada (nunca R$ 0)", () => {
  assert.equal(gmvExato(3_920_000)?.split(String.fromCharCode(160)).join(" "), "R$ 3.920.000");
  assert.equal(gmvExato(null), null);
});

test("linha de tendencia so' quando a soma da serie confere com o numero do cartao (0,5%)", () => {
  const dias = [100, 120, 90, 110, 80];
  assert.deepEqual(serieQueConfere(dias, 500), dias);
  assert.deepEqual(serieQueConfere(dias, 502), dias, "arredondamento");
  assert.equal(serieQueConfere(dias, 560), null, "outra linhagem: sem linha");
  assert.equal(serieQueConfere([200, 200, 100], 500), null, "menos de 4 pontos");
  assert.equal(serieQueConfere(dias, null), null);
  assert.equal(serieQueConfere([0, 0, 0, 0], 0), null, "sem receita, sem linha");
});

test("cartoes (ALVO-GRADE): sempre quatro CartaoIndicador, soma + um por canal; cor e' identidade em token", () => {
  const src = ler("src/components/financeiro/FinanceiroCartoes.tsx");
  assert.ok(src.includes("<CartaoIndicador") && !src.includes("KpiTile"));
  assert.ok(src.includes('cor="rgb(var(--tc-kpi-gmv))"') && src.includes("cor={`rgb(var(--tc-canal-${canal}))`}"));
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/, "cor por token: vale no tema escuro");
  assert.ok(src.includes("onAbrir={p ? () => onAbrir(canal) : undefined}"));
  assert.ok(src.includes('"Fora do filtro"') && src.includes('"Sem dado no período"'), "ausencia tem motivo, nunca zero");
  assert.ok(src.includes("valor={p?.gmv != null ? fmtBrlCurto(p.gmv) : null}"));
  assert.ok(src.includes("serie={serieTotal}") && src.includes("serie={paineis.length === 1 ? serieTotal : null}") && (src.match(/serie=/g) ?? []).length === 2, "linha so' no cartao da soma, ou no do canal quando o filtro e' so' ele (taxa nao tem serie)");
  assert.ok(src.includes("p.linhas.slice(0, 3)") && src.includes("daAba.linhas.slice(0, 3)") && !/reduce\(/.test(src), "rodape e aba do canal leem as linhas do detalhe; custos nunca somam");
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
  assert.ok(pag.includes("<Aba<Visao>") && pag.includes("<FaixaFinanceiro") && pag.includes("<FaixaCarregando cartoes={4}"));
  assert.ok(pag.includes("serieQueConfere(serie.pontos, receita)") && pag.includes("serie?.key === requestKey"), "linha so' do recorte atual e so' se confere");
  assert.equal((pag.match(/fetchTrend\(/g) ?? []).length, 1, "uma chamada a mais, no maximo");
  assert.ok(!pag.includes("recharts") && !pag.includes("FeeByBrandChart"));
  for (const ancora of ['"#tiktok"', '"#mercado-livre"', '"#shopee"', '"/canais#afiliados"']) assert.ok(pag.includes(ancora), ancora);
  assert.ok(pag.includes('identidade="gmv"') && pag.includes("{painelAberto && dataIsFresh && ("), "detalhe so' com dado fresco");
  assert.ok(pag.includes("Receita por canal") && pag.includes("Taxas por marca") && pag.includes("<CelulaBarra"));
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
