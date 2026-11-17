// CHAVES-PESSOAIS — bearer `torre_pat_...` no MCP, validado na API. Sem rede: fetch falso.
import { test } from "node:test";
import assert from "node:assert/strict";

import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

import type { AccessEnv } from "../src/server/oracle/access.ts";
import { handleMcpRequest } from "../src/server/oracle/handler.ts";
import type { OracleMcpEvent } from "../src/server/oracle/observability.ts";
import {
  ALLOWED_AUTH_ISSUER_HOSTNAME,
  apiPersonalKeyValidator,
  CANONICAL_MCP_RESOURCE,
  createAuth0Verifier,
  parseOAuthConfig,
  type PersonalKeyValidator,
} from "../src/server/oracle/oauth.ts";

const CHAVE = `torre_pat_${"A".repeat(43)}`;
const SERVICO = "k".repeat(32);
const ISSUER = `https://${ALLOWED_AUTH_ISSUER_HOSTNAME}/`;
const OAUTH_ENV = {
  ORACLE_AUTH_ISSUER: ISSUER,
  ORACLE_AUTH_AUDIENCE: CANONICAL_MCP_RESOURCE,
  ORACLE_AUTH_REQUIRED_SCOPE: "oracle:read",
};
const PROD_ENV: AccessEnv = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "production",
  ORACLE_MCP_ENABLED: "1",
  MCP_BACKEND_API_URL: "https://mktplace-api.onrender.com",
  MCP_BACKEND_SERVICE_KEY: SERVICO,
  ...OAUTH_ENV,
};
const DONO = { nome: "Simulador", dono: "nathalia@gocase.com", expiraEm: Math.floor(Date.now() / 1000) + 3600 };

const cfg = parseOAuthConfig(OAUTH_ENV)!;
// Resolvedor que falha se chamado: prova que a chave pessoal nao passa pelo JWT.
const semJwks = (async () => {
  throw new Error("jwks nao deveria ser consultado");
}) as never;

function verificador(validar?: PersonalKeyValidator) {
  return createAuth0Verifier(cfg, { keyResolver: semJwks, validatePersonalKey: validar });
}

const invalido = (e: unknown) =>
  e instanceof OAuthError && e.code === OAuthErrorCode.InvalidToken && !String(e.message).includes(CHAVE);

test("chave valida vira AuthInfo com oracle:read e nome/dono, sem passar pelo JWT", async () => {
  const info = await verificador(async () => DONO).verifyAccessToken(CHAVE);
  assert.deepEqual(info.scopes, ["oracle:read"]);
  assert.equal(info.expiresAt, DONO.expiraEm);
  assert.deepEqual(info.extra, { chave_pessoal: { nome: DONO.nome, dono: DONO.dono } });
});

test("revogada, vencida ou inexistente (API diz nao) = invalid_token", async () => {
  await assert.rejects(verificador(async () => null).verifyAccessToken(CHAVE), invalido);
});

test("sem validador ou com falha de rede = invalid_token", async () => {
  await assert.rejects(verificador().verifyAccessToken(CHAVE), invalido);
  await assert.rejects(
    verificador(async () => {
      throw new Error(`rede caiu ${CHAVE}`);
    }).verifyAccessToken(CHAVE),
    invalido,
  );
});

test("prefixo errado nao chama a API: segue o JWT e falha", async () => {
  let chamou = false;
  const v = verificador(async () => {
    chamou = true;
    return DONO;
  });
  for (const t of [`torre_key_${"A".repeat(43)}`, `Torre_pat_${"A".repeat(43)}`, `x${CHAVE}`]) {
    await assert.rejects(v.verifyAccessToken(t), invalido);
  }
  assert.equal(chamou, false);
});

test("validador da API: POST com chave de servico; 401 = null; sem chave de servico nao chama", async () => {
  const pedidos: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const fetchFalso = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response(JSON.stringify({ nome: "Sim", dono_email: "n@gocase.com", expira_em: 99 }), { status });
  }) as unknown as typeof fetch;

  const validar = apiPersonalKeyValidator("https://mktplace-api.onrender.com", SERVICO, fetchFalso);
  assert.deepEqual(await validar(CHAVE), { nome: "Sim", dono: "n@gocase.com", expiraEm: 99 });
  assert.equal(pedidos[0].url, "https://mktplace-api.onrender.com/api/v1/chaves/validar");
  assert.equal(pedidos[0].init.method, "POST");
  assert.equal((pedidos[0].init.headers as Record<string, string>)["x-torre-service-key"], SERVICO);
  assert.deepEqual(JSON.parse(String(pedidos[0].init.body)), { chave: CHAVE });

  status = 401;
  assert.equal(await validar(CHAVE), null);

  const n = pedidos.length;
  assert.equal(await apiPersonalKeyValidator("https://mktplace-api.onrender.com", undefined, fetchFalso)(CHAVE), null);
  assert.equal(pedidos.length, n);
});

function mcpRequest(authorization: string): Request {
  return new Request("https://mktplace-ten.vercel.app/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-method": "tools/list",
      authorization,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "pat-test", version: "0.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

async function chamar(valida: boolean) {
  const eventos: OracleMcpEvent[] = [];
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return valida
      ? new Response(JSON.stringify({ nome: DONO.nome, dono_email: DONO.dono, expira_em: DONO.expiraEm }))
      : new Response("{}", { status: 401 });
  }) as unknown as typeof fetch;
  const res = await handleMcpRequest(mcpRequest(`Bearer ${CHAVE}`), PROD_ENV, {
    fetchImpl,
    logger: (e) => eventos.push(e),
    verifierOptions: { keyResolver: semJwks },
  });
  return { res, eventos, urls };
}

test("MCP ponta a ponta: chave valida lista as tools e o log tem nome/dono, nunca a chave", async () => {
  const { res, eventos, urls } = await chamar(true);
  assert.equal(res.status, 200);
  assert.deepEqual(urls, ["https://mktplace-api.onrender.com/api/v1/chaves/validar"]);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0].chave_pessoal, { nome: DONO.nome, dono: DONO.dono });
  assert.ok(!JSON.stringify(eventos).includes(CHAVE));
});

test("MCP ponta a ponta: chave recusada pela API = 401, sem nome/dono no log", async () => {
  const { res, eventos } = await chamar(false);
  assert.equal(res.status, 401);
  assert.equal(eventos[0].chave_pessoal, undefined);
  assert.ok(!(await res.text()).includes(CHAVE));
  assert.ok(!JSON.stringify(eventos).includes(CHAVE));
});

test("/admin/chaves: a topbar mostra 'Chaves', nao repete a marca", async () => {
  const { getRouteTitle } = await import("../src/components/shell/nav-config.ts");
  assert.equal(getRouteTitle("/admin/chaves"), "Chaves");
});
