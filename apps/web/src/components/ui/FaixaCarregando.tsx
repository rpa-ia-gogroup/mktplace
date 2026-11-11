import KpiCardSkeleton from "./KpiCardSkeleton";

/**
 * "Carregando" de uma faixa de cartoes de KPI: um aviso so' para o leitor de tela
 * (`role="status"` no contenedor) e os esqueletos no formato do cartao, mudos.
 * `className` e' a grade da propria faixa, para o esqueleto ocupar o mesmo lugar.
 */
export default function FaixaCarregando({ cartoes, className }: { cartoes: number; className: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Carregando indicadores…</span>
      {Array.from({ length: cartoes }, (_, i) => (
        <KpiCardSkeleton key={i} anunciar={false} />
      ))}
    </div>
  );
}
