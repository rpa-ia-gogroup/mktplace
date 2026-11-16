// AUTH-GOOGLE-4 — handlers de /api/auth/*. Chaves e segredos SINTETICOS.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { handleGoogleLogin, handleLogout, handleMe } from "../src/server/auth/handlers.ts";
import { createSessionToken, type AuthEnv } from "../src/server/auth/session.ts";

const SECRET = "s".repeat(40);
const CLIENT_ID = "client-id-sintetico.apps.googleusercontent.com";
const SERVICO = "k".repeat(32);
const ENV: AuthEnv = {
  AUTH_GOOGLE_ID: CLIENT_ID, AUTH_SECRET: SECRET, NODE_ENV: "test",
  TORRE_API_ORIGIN: "https://api.exemplo", TORRE_SERVICE_KEY: SERVICO,
};

/** API falsa de /auth/permitido: libera os e-mails da lista, guarda as URLs pedidas. */
function apiPermitido(liberados: string[], status = 200) {
  const pedidos: { url: string; chave: string | null }[] = [];
  const impl = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    pedidos.push({ url: u.toString(), chave: new Headers(init?.headers).get("x-torre-service-key") });
    const email = u.searchParams.get("email") ?? "";
    return new Response(JSON.stringify({ permitido: liberados.includes(email) }), { status });
  }) as unknown as typeof fetch;
  return { impl, pedidos };
}

async function googleSetup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt().setIssuer("https://accounts.google.com")
      .setAudience(CLIENT_ID).setExpirationTime("1h").sign(privateKey);
  return { keys, sign };
}

function post(body: unknown, raw = false): Request {
  return new Request("http://x/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function assertNoStore(res: Response) {
  assert.equal(res.headers.get("cache-control"), "no-store");
}

test("login: auth desligada -> 404", async () => {
  const res = await handleGoogleLogin(post({ credential: "x" }), {});
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "auth_desligada" });
  assertNoStore(res);
});

test("login: sem credential -> 400", async () => {
  for (const b of [{}, { credential: 5 }, { credential: "" }]) {
    const res = await handleGoogleLogin(post(b), ENV);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "credential_ausente" });
    assertNoStore(res);
  }
  const res = await handleGoogleLogin(post("nao-json", true), ENV);
  assert.equal(res.status, 400);
});

test("login: credencial invalida -> 401 sem vazar o credential", async () => {
  const { keys } = await googleSetup();
  const logs: string[] = [];
  const orig = [console.info, console.error, console.warn, console.log];
  console.info = console.error = console.warn = console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
  let res: Response; let text: string;
  try {
    res = await handleGoogleLogin(post({ credential: "credencial-secreta-lixo" }), ENV, keys);
    text = await res.text();
  } finally {
    [console.info, console.error, console.warn, console.log] = orig;
  }
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(text), { error: "credencial_invalida" });
  assert.ok(!text.includes("credencial-secreta-lixo"));
  assert.ok(!logs.join("\n").includes("credencial-secreta-lixo"));
  assert.equal(res.headers.get("set-cookie"), null);
  assertNoStore(res);
});

test("login: email nao verificado -> 403", async () => {
  const { keys, sign } = await googleSetup();
  const res = await handleGoogleLogin(post({ credential: await sign({ email: "a@gocase.com", email_verified: false }) }), ENV, keys);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "email_nao_verificado" });
  assert.equal(res.headers.get("set-cookie"), null);
  assertNoStore(res);
});

test("login: token sem email nunca recebe cookie", async () => {
  const { keys, sign } = await googleSetup();
  const res = await handleGoogleLogin(post({ credential: await sign({ email_verified: true }) }), ENV, keys);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("set-cookie"), null);
  assertNoStore(res);
});

test("login: API diz nao permitido -> 403 sem listar dominios nem e-mails", async () => {
  const { keys, sign } = await googleSetup();
  const api = apiPermitido(["joao@gocase.com"]);
  const res = await handleGoogleLogin(post({ credential: await sign({ email: "x@gmail.com", email_verified: true }) }), ENV, keys, api.impl);
  assert.equal(res.status, 403);
  const corpo = await res.json();
  assert.equal(corpo.error, "dominio_nao_permitido");
  assert.ok(!/@|gocase|gobeaute/.test(corpo.message), corpo.message);
  assert.deepEqual(api.pedidos, [{ url: "https://api.exemplo/auth/permitido?email=x%40gmail.com", chave: SERVICO }]);
  assert.equal(res.headers.get("set-cookie"), null);
  assertNoStore(res);
});

test("login: ok -> 200 + cookie + log sem credential", async () => {
  const { keys, sign } = await googleSetup();
  const credential = await sign({ email: "Joao@Gocase.com", email_verified: true, name: "Joao", picture: "p" });
  const calls: unknown[][] = [];
  const orig = console.info;
  console.info = (...a: unknown[]) => { calls.push(a); };
  let res: Response; let text: string;
  try {
    res = await handleGoogleLogin(post({ credential }), ENV, keys, apiPermitido(["joao@gocase.com"]).impl);
    text = await res.text();
  } finally {
    console.info = orig;
  }
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { ok: true, email: "joao@gocase.com", name: "Joao", picture: "p" });
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.ok(cookie.startsWith("torre_session="));
  assert.ok(cookie.includes("HttpOnly") && cookie.includes("Max-Age=604800"));
  assertNoStore(res);
  assert.deepEqual(calls, [["auth_login email=%s", "joao@gocase.com"]]);
  assert.ok(!text.includes(credential));
});

test("logout: sempre 200 e cookie Max-Age=0", async () => {
  const res = await handleLogout(new Request("http://x/api/auth/logout", { method: "POST" }), ENV);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.ok(cookie.startsWith("torre_session=;"));
  assert.ok(cookie.includes("Max-Age=0"));
  assertNoStore(res);
  const off = await handleLogout(new Request("http://x/api/auth/logout", { method: "POST" }), {});
  assert.equal(off.status, 200);
});

test("me: auth desligada", async () => {
  const res = await handleMe(new Request("http://x/api/auth/me"), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authEnabled: false, email: "dev@local" });
  assertNoStore(res);
});

test("me: sessao valida", async () => {
  const token = await createSessionToken({ email: "joao@gocase.com", name: "Joao", picture: "p" }, ENV);
  const res = await handleMe(new Request("http://x/api/auth/me", { headers: { cookie: `torre_session=${token}` } }), ENV);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authEnabled: true, email: "joao@gocase.com", name: "Joao", picture: "p" });
  assertNoStore(res);
});

test("me: sem sessao ou sessao invalida -> 401 com clientId", async () => {
  for (const headers of [{}, { cookie: "torre_session=lixo" }] as HeadersInit[]) {
    const res = await handleMe(new Request("http://x/api/auth/me", { headers }), ENV);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "nao_autenticado", clientId: CLIENT_ID });
    assertNoStore(res);
  }
});

test("login: content-type text/plain -> 415 sem cookie (anti login-CSRF)", async () => {
  const req = new Request("http://x/api/auth/google", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ credential: "x" }),
  });
  const res = await handleGoogleLogin(req, ENV);
  assert.equal(res.status, 415);
  assert.deepEqual(await res.json(), { error: "content_type_invalido" });
  assertNoStore(res);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("login: application/json; charset=utf-8 segue o fluxo normal", async () => {
  const req = new Request("http://x/api/auth/google", {
    method: "POST",
    headers: { "content-type": "Application/JSON; charset=utf-8" },
    body: JSON.stringify({}),
  });
  const res = await handleGoogleLogin(req, ENV);
  assert.equal(res.status, 400); // passou do content-type; falta credential
});

test("login: e-mail avulso liberado na API (lista so no Render) entra", async () => {
  const { keys, sign } = await googleSetup();
  const credential = await sign({ email: "larissa@gmail.com", email_verified: true });
  const res = await handleGoogleLogin(post({ credential }), ENV, keys, apiPermitido(["larissa@gmail.com"]).impl);
  assert.equal(res.status, 200);
  assert.ok((res.headers.get("set-cookie") ?? "").startsWith("torre_session="));
});

test("login: chave de servico cai em MCP_BACKEND_SERVICE_KEY", async () => {
  const { keys, sign } = await googleSetup();
  const api = apiPermitido(["joao@gocase.com"]);
  const env = { ...ENV, TORRE_SERVICE_KEY: undefined, MCP_BACKEND_SERVICE_KEY: SERVICO };
  const res = await handleGoogleLogin(post({ credential: await sign({ email: "joao@gocase.com", email_verified: true }) }), env, keys, api.impl);
  assert.equal(res.status, 200);
  assert.equal(api.pedidos[0].chave, SERVICO);
});

test("login: API fora, status estranho ou sem config -> 503 'tente de novo', nunca cookie", async () => {
  const { keys, sign } = await googleSetup();
  const credential = await sign({ email: "joao@gocase.com", email_verified: true });
  const rede = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  const lixo = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
  const casos: [AuthEnv, typeof fetch][] = [
    [ENV, rede],
    [ENV, apiPermitido(["joao@gocase.com"], 500).impl],
    [ENV, apiPermitido(["joao@gocase.com"], 401).impl],
    [ENV, lixo],
    [{ ...ENV, TORRE_API_ORIGIN: undefined }, apiPermitido(["joao@gocase.com"]).impl],
    [{ ...ENV, TORRE_SERVICE_KEY: undefined }, apiPermitido(["joao@gocase.com"]).impl],
  ];
  for (const [env, impl] of casos) {
    const res = await handleGoogleLogin(post({ credential }), env, keys, impl);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "verificacao_indisponivel");
    assert.equal(res.headers.get("set-cookie"), null);
    assertNoStore(res);
  }
});
