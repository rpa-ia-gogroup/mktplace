/**
 * Esqueleto do cartao de KPI da Gerencial (`KpiBand`), para toda aba usar o
 * mesmo "carregando" no formato do cartao: rotulo, valor e rodape em `mt-auto`.
 * O brilho que atravessa os blocos vem do CSS (`.animate-pulse :is(.bg-raised)`).
 * Mesmas classes do `KpiCardSkeleton` privado da `KpiBand`, que segue como esta'.
 *
 * `anunciar={false}`: numa faixa de varios cartoes, quem anuncia "Carregando" e'
 * o contenedor (um `role="status"` so'), senao o leitor de tela le' N vezes.
 */
export default function KpiCardSkeleton({ anunciar = true }: { anunciar?: boolean }) {
  return (
    <div
      className="h-full bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 animate-pulse"
      role={anunciar ? "status" : undefined}
      aria-busy={anunciar ? "true" : undefined}
    >
      {anunciar && <span className="sr-only">Carregando indicador…</span>}
      <div className="h-3 w-20 bg-raised rounded" />
      <div className="h-7 w-32 bg-raised rounded" />
      <div className="h-3 w-24 bg-raised rounded mt-auto" />
    </div>
  );
}
