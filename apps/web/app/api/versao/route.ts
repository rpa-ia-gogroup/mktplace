/** Versão publicada (commit do deploy da Vercel): a TV compara com a dela e recarrega quando muda. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { versao: process.env.VERCEL_GIT_COMMIT_SHA ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
