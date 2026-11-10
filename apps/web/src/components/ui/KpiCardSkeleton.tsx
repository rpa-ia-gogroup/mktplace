/**
 * Esqueleto do cartao de KPI da Gerencial (`KpiBand`), para toda aba usar o
 * mesmo "carregando" no formato do cartao: rotulo, valor e rodape em `mt-auto`.
 * O brilho que atravessa os blocos vem do CSS (`.animate-pulse :is(.bg-raised)`).
 * Mesmas classes do `KpiCardSkeleton` privado da `KpiBand`, que segue como esta'.
 */
export default function KpiCardSkeleton() {
  return (
    <div
      className="h-full bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 animate-pulse"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Carregando indicador…</span>
      <div className="h-3 w-20 bg-raised rounded" />
      <div className="h-7 w-32 bg-raised rounded" />
      <div className="h-3 w-24 bg-raised rounded mt-auto" />
    </div>
  );
}
