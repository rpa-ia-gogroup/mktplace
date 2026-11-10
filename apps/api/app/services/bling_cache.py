"""Cache persistente do Bling (marcas menores): lista de pedidos, itens e marcas de sincronizacao.

As tabelas vem da migration 043 (`audit.bling_*`). `ArmazemCachePg` e' a implementacao em
Postgres; os testes usam uma em memoria com a mesma interface. Nunca guarda nem loga token.
"""
from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import date, datetime
from typing import Iterable, Iterator, Optional, Protocol

#: Chave do advisory lock da rotina de aquecimento (so' uma instancia sincroniza por vez).
CHAVE_LOCK = 4242043


class CacheBling(Protocol):
    def pedidos(self, lojas: Iterable[int], inicio: date, fim: date) -> list[dict]:
        """{id, loja_id, data (date), total (float), situacao_id (int|None)} das lojas na janela."""

    def salvar_pedidos(self, linhas: Iterable[dict]) -> None: ...

    def itens(self, ids: Iterable[int]) -> dict[int, list[dict]]: ...

    def salvar_itens(self, pedido_id: int, itens: list[dict]) -> None: ...

    def ids_sem_itens(self, lojas: Iterable[int], inicio: date, fim: date, cancelado: int) -> list[int]:
        """Pedidos nao cancelados da janela que ainda nao tem itens guardados (mais novos primeiro)."""

    def ler_sync(self, chave: str) -> Optional[tuple[Optional[str], datetime]]: ...

    def ler_sync_prefixo(self, prefixo: str) -> dict[str, tuple[Optional[str], datetime]]:
        """Todas as marcas que comecam com `prefixo`, numa unica consulta (a leitura nao pode custar 6 idas ao banco)."""

    def marcar_sync(self, chave: str, valor: Optional[str]) -> None: ...

    def trava(self) -> "contextmanager[bool]":
        """Lock da rotina: `with cache.trava() as ok:`; `ok` False = outra instancia ja' esta sincronizando."""


class ArmazemCachePg:
    def __init__(self, db):
        self.db = db

    def _fim(self) -> None:
        self.db.commit()

    def pedidos(self, lojas, inicio, fim):
        from sqlalchemy import text

        rows = self.db.execute(
            text(
                "SELECT id, loja_id, data, total, situacao_id FROM audit.bling_pedido "
                "WHERE loja_id = ANY(:lojas) AND data BETWEEN :i AND :f"
            ),
            {"lojas": list(lojas), "i": inicio, "f": fim},
        ).mappings().all()
        self.db.rollback()
        return [{**dict(r), "total": float(r["total"])} for r in rows]

    def salvar_pedidos(self, linhas):
        from sqlalchemy import text

        linhas = list(linhas)
        if not linhas:
            return
        try:
            self.db.execute(
                text(
                    "INSERT INTO audit.bling_pedido (id, loja_id, data, total, situacao_id, atualizado_em) "
                    "VALUES (:id, :loja_id, :data, :total, :situacao_id, now()) "
                    "ON CONFLICT (id) DO UPDATE SET loja_id = EXCLUDED.loja_id, data = EXCLUDED.data, "
                    "total = EXCLUDED.total, situacao_id = EXCLUDED.situacao_id, atualizado_em = now()"
                ),
                linhas,
            )
            self._fim()
        except Exception:
            self.db.rollback()
            raise

    def itens(self, ids):
        from sqlalchemy import text

        ids = list(ids)
        if not ids:
            return {}
        rows = self.db.execute(
            text("SELECT pedido_id, itens FROM audit.bling_pedido_itens WHERE pedido_id = ANY(:ids)"), {"ids": ids}
        ).all()
        self.db.rollback()
        return {int(pid): (it if isinstance(it, list) else json.loads(it)) for pid, it in rows}

    def salvar_itens(self, pedido_id, itens):
        from sqlalchemy import text

        try:
            self.db.execute(
                text(
                    "INSERT INTO audit.bling_pedido_itens (pedido_id, itens, lido_em) VALUES (:p, CAST(:i AS JSONB), now()) "
                    "ON CONFLICT (pedido_id) DO NOTHING"
                ),
                {"p": pedido_id, "i": json.dumps(itens)},
            )
            self._fim()
        except Exception:
            self.db.rollback()
            raise

    def ids_sem_itens(self, lojas, inicio, fim, cancelado):
        from sqlalchemy import text

        rows = self.db.execute(
            text(
                "SELECT p.id FROM audit.bling_pedido p "
                "LEFT JOIN audit.bling_pedido_itens i ON i.pedido_id = p.id "
                "WHERE p.loja_id = ANY(:lojas) AND p.data BETWEEN :i AND :f "
                "AND COALESCE(p.situacao_id, -1) <> :c AND i.pedido_id IS NULL ORDER BY p.data DESC, p.id DESC"
            ),
            {"lojas": list(lojas), "i": inicio, "f": fim, "c": cancelado},
        ).all()
        self.db.rollback()
        return [int(r[0]) for r in rows]

    def ler_sync(self, chave):
        from sqlalchemy import text

        r = self.db.execute(text("SELECT valor, atualizado_em FROM audit.bling_sync WHERE chave = :c"), {"c": chave}).first()
        self.db.rollback()
        return (r[0], r[1]) if r else None

    def ler_sync_prefixo(self, prefixo):
        from sqlalchemy import text

        rows = self.db.execute(
            text("SELECT chave, valor, atualizado_em FROM audit.bling_sync WHERE chave LIKE :p"), {"p": prefixo + "%"}
        ).all()
        self.db.rollback()
        return {r[0]: (r[1], r[2]) for r in rows}

    def marcar_sync(self, chave, valor):
        from sqlalchemy import text

        try:
            self.db.execute(
                text(
                    "INSERT INTO audit.bling_sync (chave, valor, atualizado_em) VALUES (:c, :v, now()) "
                    "ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()"
                ),
                {"c": chave, "v": valor},
            )
            self._fim()
        except Exception:
            self.db.rollback()
            raise

    @contextmanager
    def trava(self) -> Iterator[bool]:
        """Advisory lock de SESSAO numa conexao PROPRIA: a Session devolve a conexao ao pool a cada commit,
        e um lock de sessao so' se solta na mesma conexao que o pegou."""
        from sqlalchemy import text

        conn = self.db.get_bind().connect()
        try:
            ok = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": CHAVE_LOCK}).scalar())
            conn.commit()
            try:
                yield ok
            finally:
                if ok:
                    conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": CHAVE_LOCK})
                    conn.commit()
        finally:
            conn.close()
