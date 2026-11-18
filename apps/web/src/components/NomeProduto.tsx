"use client";

import { useState } from "react";

/**
 * Nome do produto numa linha (cortado com "…"); clicar mostra o nome inteiro e
 * clicar de novo volta. O nome completo tambem fica no `title` (passar o mouse).
 */
export default function NomeProduto({ nome }: { nome: string }) {
  const [inteiro, setInteiro] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setInteiro((v) => !v)}
      aria-expanded={inteiro}
      title={nome}
      className={`block w-full text-left text-ink font-medium leading-tight rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${inteiro ? "whitespace-normal break-words" : "truncate"}`}
    >
      {nome}
    </button>
  );
}
