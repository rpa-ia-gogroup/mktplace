"""Carga unica dos tokens do TikTok Shop em audit.tiktok_oauth_token (migration 050).

Le os JSON salvos na troca do link de retorno (`<data>_<marca>.json`, resposta inteira do
TikTok) e grava a linha de cada marca; com mais de um arquivo da mesma marca, vale o mais novo.
Uso:  DATABASE_URL=... python -m tools.tiktok_tokens_carregar <pasta>
Nao imprime token: so' marca, loja e validade.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from app.services.tiktok_token import de_resposta, gravar


def ler_pasta(pasta: Path) -> dict[str, dict]:
    """{marca: linha} do arquivo mais novo de cada marca (nome `AAAAMMDD-HHMMSS_marca.json`)."""
    out: dict[str, dict] = {}
    for f in sorted(pasta.glob("*_*.json")):  # ordem do nome = ordem da troca
        marca = f.stem.split("_", 1)[1]
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("code") == 0 and (d.get("data") or {}).get("access_token"):
            out[marca] = de_resposta(d["data"])
    return out


def main() -> None:
    from app.database import SessionLocal

    linhas = ler_pasta(Path(sys.argv[1]))
    with SessionLocal() as db:
        for marca, t in linhas.items():
            gravar(db, marca, t)
        db.commit()
    for marca, t in sorted(linhas.items()):
        print(f"{marca}: {t['seller_name']} | access vence {t['access_expires_at']:%d/%m %H:%M} UTC")


if __name__ == "__main__":
    main()
