import type { ReactNode } from "react";

/**
 * ALVO-GRADE (aprovado em 12/11/2026) — conteudo de celula numerica com peso:
 * o valor e, embaixo, uma barrinha fina na cor de identidade (canal ou
 * indicador), alinhada a' direita como o numero. Substitui o mapa de calor
 * (fundo colorido na celula), que o dono reprovou.
 *
 * Vai DENTRO do `<td>` (ou do `<button>` da celula); `peso` e' 0..1 na escala
 * da coluna. Sem dado nao se usa este componente: a celula mostra "—".
 */
export default function CelulaBarra({ valor, peso, cor }: { valor: ReactNode; peso: number; cor: string }) {
  return (
    <span className="ml-auto grid w-full min-w-[112px] max-w-[180px] justify-items-end gap-1">
      <span className="text-sm font-medium text-ink tabular-nums">{valor}</span>
      <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-full bg-raised">
        <span className="tc-barra-dir ml-auto block h-full rounded-full" style={{ width: `${Math.min(Math.max(peso, 0.02), 1) * 100}%`, background: cor }} />
      </span>
    </span>
  );
}
