"use client";

import Segmented from "@/components/ui/Segmented";
import { useBaseVendas } from "@/hooks/useBaseVendas";
import type { BaseVendas } from "@/lib/base-vendas";

const OPCOES = [
  { valor: "pagos", texto: "Pagos" },
  { valor: "realizados", texto: "Realizados" },
] as const;

/** Pagos | Realizados ao lado do periodo (Gerencial e Canais); o que cada um conta vai no ⓘ dos cards. */
export default function SeletorBase() {
  const [base, setBase] = useBaseVendas();
  return <Segmented<BaseVendas> rotulo="Base de vendas" opcoes={OPCOES} valor={base} aoEscolher={setBase} />;
}
