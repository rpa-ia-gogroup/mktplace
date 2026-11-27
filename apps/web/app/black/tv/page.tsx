import type { Metadata } from "next";

import TvClient from "./TvClient";

export const metadata: Metadata = { title: "Black Marketplace GoBeaute" };

/** Black Friday na TV: a receita de hoje em números grandes (pedido da Nath, 27/11). */
export default function BlackTvPage() {
  return <TvClient />;
}
