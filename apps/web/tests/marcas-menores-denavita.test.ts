import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import {
  ROTULO_FONTE_PROVISORIA,
  pendenciasDoTotal,
  rotuloDaFonte,
  textoSemDado,
  type MarcaMenor,
} from "../src/lib/marcas-menores.ts";
import { filtrarMarcasMenores, menoresNaGerencial, notaMenores } from "../src/lib/gerencial/marcas-menores-gerencial.ts";

// T-0119: Denavita pelo TikTok do Data Mart (fonte provisoria); Shopee e itens pendentes.
const AVISO = "TikTok via Data Mart (gold.tiktok_brand_daily); Shopee pendente: conta do Bling sem autorização.";
const denavita = (over: Partial<MarcaMenor> = {}): MarcaMenor => ({
  id: "denavita", label: "Denavita", status: "parcial_fonte_provisoria", aviso: AVISO, motivo: null,
  total: 43763.45, total_anterior: 58522.28, por_plataforma_anterior: { TIKTOK: 58522.28 },
  pedidos: 412, pedidos_por_plataforma: { TIKTOK: 412 },
  por_plataforma: [{ plataforma: "TIKTOK", faturamento: 43763.45 }], serie: [], ...over,
});
const yenzah: MarcaMenor = {
  id: "yenzah", label: "Yenzah", status: "ok", total: 150, total_anterior: 120,
  por_plataforma_anterior: { SHOPEE: 80, TIKTOK: 40 }, pedidos_por_plataforma: { SHOPEE: 2, TIKTOK: 1 },
  por_plataforma: [{ plataforma: "SHOPEE", faturamento: 100 }, { plataforma: "TIKTOK", faturamento: 50 }], serie: [],
};
const TODOS = ["ml", "shopee", "tiktok"] as const;

test("rotulo da fonte provisoria so' na Denavita provisoria", () => {
  assert.equal(rotuloDaFonte(denavita()), ROTULO_FONTE_PROVISORIA);
  assert.equal(ROTULO_FONTE_PROVISORIA, "TikTok via Data Mart; Shopee pendente");
  assert.equal(rotuloDaFonte(yenzah), null);
  assert.equal(rotuloDaFonte({ status: "aguardando_autorizacao" }), null);
});

test("sem total: o motivo certo, nunca 0", () => {
  assert.match(textoSemDado(denavita({ status: "fonte_indisponivel", total: null, motivo: "Data Mart indisponível: x" })), /Data Mart indisponível/);
  assert.equal(textoSemDado({ status: "fonte_indisponivel", motivo: null }), "Fonte indisponível.");
  assert.match(textoSemDado(denavita({ total: null })), /Shopee pendente/);
  assert.equal(textoSemDado({ status: "aguardando_autorizacao" }), "Aguardando autorização.");
  assert.equal(textoSemDado({ status: "ok" }), "Sem dado no período.");
});

test("total parcial: declarado pela API e pela Denavita so' com TikTok", () => {
  const p = pendenciasDoTotal({ parcial: true }, [denavita(), yenzah]);
  assert.equal(p.parcial, true);
  assert.deepEqual(p.itens, ["Denavita só TikTok"]);
  const fora = pendenciasDoTotal({ parcial: true }, [denavita({ status: "fonte_indisponivel", total: null }), yenzah]);
  assert.deepEqual(fora.itens, ["sem Denavita"]);
  assert.equal(pendenciasDoTotal({ parcial: false }, [yenzah]).parcial, false);
  assert.equal(pendenciasDoTotal({}, [yenzah, { ...yenzah, id: "aua", label: "Auá", total: null }]).parcial, true);
});

test("Gerencial: Denavita provisoria fica fora da soma e a nota diz de onde vem", () => {
  const d = { disponivel: true, marcas: [denavita(), yenzah] } as never;
  const m = menoresNaGerencial(d, TODOS, true);
  if (m.estado !== "ok") throw new Error("esperava ok");
  assert.equal(m.total, 150); // so' Yenzah: a Denavita (outra definicao de GMV) nao soma
  assert.deepEqual(m.marcas.map((x) => x.brand), ["yenzah"]);
  assert.deepEqual(m.provisorias, ["Denavita"]);
  assert.deepEqual(m.aguardando, []);
  const nota = notaMenores(m, true, false, (v) => `R$ ${v}`)!;
  assert.match(nota, /Denavita: fora desta soma; o pedido vem só do TikTok via Data Mart/);
  assert.match(nota, /Shopee e os itens seguem pendentes/);
  assert.doesNotMatch(nota, /Denavita: aguardando/);
  // Filtro de marca da Gerencial: a Denavita nunca entra no recorte.
  assert.deepEqual(filtrarMarcasMenores(d, ["denavita", "yenzah"], TODOS).marcas.map((x) => x.id), ["yenzah"]);
});

test("textos fixos: a Denavita vem do TikTok via Data Mart; so' Shopee e itens pendentes", () => {
  const pagina = readFileSync(new URL("../app/marcas-menores/page.tsx", import.meta.url), "utf8");
  const blocos = readFileSync(new URL("../src/components/marcas-menores/Blocos.tsx", import.meta.url), "utf8");
  for (const txt of [pagina, blocos]) {
    assert.doesNotMatch(txt, /ainda sem autorização\.|aguarda autorização da conta/);
  }
  assert.match(pagina, /Denavita entra provisoriamente pelo TikTok via Data Mart \(gold\.tiktok_brand_daily/);
  assert.match(pagina, /1,4% a 3,9% acima do mart da Torre/);
  assert.match(pagina, /a Shopee e os itens dela seguem pendentes/);
  // A regra das demais marcas fora do GMV total, da meta e da rosca continua no texto da pagina.
  assert.match(pagina, /Estas marcas ficam fora do GMV total, da meta e da rosca da Gerencial/);
  assert.match(blocos, /A Denavita não tem itens: eles só vêm do Bling/);
  assert.match(blocos, /rotuloDaFonte\(m\)/);
});
