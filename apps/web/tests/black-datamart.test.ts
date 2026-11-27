/**
 * /black lê HOJE direto do Data Mart (a TV e a Gerencial seguem na Torre): "até HH:MM (Data Mart)",
 * o ⓘ explica por que pode ficar acima da Gerencial, e "fonte: Torre" quando o Data Mart falhou.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DICA_DATAMART, rotuloAte } from "../src/lib/black-hora.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("rótulo: 'até 10:31 (Data Mart)' só quando a fonte é o Data Mart", () => {
  assert.equal(rotuloAte("10:31", "datamart"), "10:31 (Data Mart)");
  assert.equal(rotuloAte("10:31", "torre"), "10:31");
  assert.equal(rotuloAte("10h", undefined), "10h");
  assert.equal(rotuloAte(null, "datamart"), null);
});

test("ⓘ do Data Mart e selo 'fonte: Torre' na /black; a TV não muda", () => {
  assert.equal(
    DICA_DATAMART,
    "Lido direto do Data Mart: inclui pedidos pagos depois da última carga da Torre, por isso pode ficar um pouco acima da Gerencial e da TV.",
  );
  const bc = ler("app/black/BlackClient.tsx");
  assert.ok(bc.includes('dados.fonte === "datamart" ? `${DICA_META} ${DICA_DATAMART}` : DICA_META'));
  assert.ok(bc.includes('dados?.fonte === "torre" && <span className="text-xs text-ink-faint">fonte: Torre</span>'));
  assert.ok(bc.includes("rotuloAte(r.ate ??"));
  const tv = ler("app/black/tv/TvClient.tsx");
  assert.ok(!tv.includes("Data Mart") && !tv.includes("rotuloAte"), "TV segue na fonte da Gerencial");
});
