/**
 * T-0039 D1 — estado de carregando da rota.
 *
 * A busca roda no SERVIDOR (`carregarPerformanceContas`) antes do render; sem
 * este arquivo a tela anterior ficava parada, sem sinal, enquanto a API
 * respondia. O Next mostra isto ate' a pagina chegar.
 *
 * Nenhum numero aqui (nem zero): so' o titulo da tela e o StateBlock
 * "carregando" (role="status" + aria-busy), o mesmo dos outros estados.
 */
import Aba from "@/components/layout/Aba";
import StateBlock from "@/components/ui/StateBlock";

export default function CarregandoPerformanceContas() {
  return (
    <Aba titulo="Performance das contas">
      <StateBlock tipo="carregando" titulo="Carregando a performance das contas…" />
    </Aba>
  );
}
