import { NOME_CANAL_LONGO, SELO_CANAL, type Canal } from "@/lib/full-visao-geral";

/**
 * FULL-CARINHO -- selo do canal na fila ("● Mercado Livre", "● Shopee"): ponto
 * e pilula na cor de IDENTIDADE do canal, a mesma da Gerencial. Nao e' status.
 */
export default function SeloCanal({ canal, className = "" }: { canal: Canal; className?: string }) {
  const s = SELO_CANAL[canal];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium text-ink ${s.pilula} ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.ponto}`} />
      {NOME_CANAL_LONGO[canal]}
    </span>
  );
}
