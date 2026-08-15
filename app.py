#!/usr/bin/env python3
"""Mi Árbol Familiar: aplicación web local y autocontenida."""

from __future__ import annotations

import json
import mimetypes
import os
import errno
import sqlite3
import threading
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.environ.get("ARBOL_DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "familia.sqlite3"
HOST = "127.0.0.1"
PORT = int(os.environ.get("ARBOL_PORT", "8765"))


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL DEFAULT '',
                birth_date TEXT NOT NULL DEFAULT '',
                death_date TEXT NOT NULL DEFAULT '',
                birth_place TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                is_tree_root INTEGER NOT NULL DEFAULT 0 CHECK(is_tree_root IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
                relative_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
                relation_type TEXT NOT NULL CHECK(relation_type IN ('parent', 'partner')),
                parent_role TEXT CHECK(parent_role IN ('father', 'mother') OR parent_role IS NULL),
                UNIQUE(person_id, relative_id, relation_type),
                CHECK(person_id <> relative_id)
            );
            """
        )
        columns = {row[1] for row in db.execute("PRAGMA table_info(relationships)")}
        if "parent_role" not in columns:
            db.execute("ALTER TABLE relationships ADD COLUMN parent_role TEXT")
        people_columns = {row[1] for row in db.execute("PRAGMA table_info(people)")}
        if "is_tree_root" not in people_columns:
            db.execute("ALTER TABLE people ADD COLUMN is_tree_root INTEGER NOT NULL DEFAULT 0")
            db.execute(
                """UPDATE people SET is_tree_root = 1
                WHERE id NOT IN (
                    SELECT relative_id FROM relationships WHERE relation_type = 'parent'
                )"""
            )


def row_dict(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


class Handler(BaseHTTPRequestHandler):
    server_version = "MiArbol/0.1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            size = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(size) or b"{}")
        except (ValueError, json.JSONDecodeError):
            raise ApiError(400, "Los datos enviados no son válidos")

    def do_GET(self) -> None:
        try:
            path = urlparse(self.path).path
            if path == "/api/people":
                return self.list_people()
            if path == "/api/tree":
                return self.get_tree()
            self.serve_static(path)
        except ApiError as exc:
            self.send_json({"error": exc.message}, exc.status)
        except Exception as exc:
            print(f"Error: {exc}")
            self.send_json({"error": "Ha ocurrido un error inesperado"}, 500)

    def do_POST(self) -> None:
        try:
            path = urlparse(self.path).path
            if path == "/api/people":
                return self.create_person()
            if path == "/api/relationships":
                return self.create_relationship()
            raise ApiError(404, "No encontrado")
        except ApiError as exc:
            self.send_json({"error": exc.message}, exc.status)
        except sqlite3.IntegrityError:
            self.send_json({"error": "Esa relación ya existe o no es válida"}, 409)

    def do_PUT(self) -> None:
        try:
            path = urlparse(self.path).path
            if path.startswith("/api/people/"):
                return self.update_person(int(path.rsplit("/", 1)[1]))
            raise ApiError(404, "No encontrado")
        except (ValueError, ApiError) as exc:
            if isinstance(exc, ApiError):
                self.send_json({"error": exc.message}, exc.status)
            else:
                self.send_json({"error": "Identificador no válido"}, 400)

    def do_DELETE(self) -> None:
        try:
            path = urlparse(self.path).path
            if path.startswith("/api/relationships/"):
                relation_id = int(path.rsplit("/", 1)[1])
                with connect() as db:
                    db.execute("DELETE FROM relationships WHERE id = ?", (relation_id,))
                return self.send_json({"ok": True})
            if path.startswith("/api/trees/"):
                root_id = int(path.rsplit("/", 1)[1])
                with connect() as db:
                    if not db.execute("SELECT 1 FROM people WHERE id = ?", (root_id,)).fetchone():
                        raise ApiError(404, "No se encuentra esa persona")
                    pending, members = [root_id], set()
                    while pending:
                        person_id = pending.pop()
                        if person_id in members:
                            continue
                        members.add(person_id)
                        pending.extend(
                            row[0] for row in db.execute(
                                "SELECT relative_id FROM relationships WHERE person_id = ? AND relation_type = 'parent'",
                                (person_id,),
                            )
                        )
                    placeholders = ", ".join("?" for _ in members)
                    db.execute(f"DELETE FROM people WHERE id IN ({placeholders})", tuple(members))
                return self.send_json({"ok": True, "deleted_people": len(members)})
            if path.startswith("/api/people/"):
                person_id = int(path.rsplit("/", 1)[1])
                with connect() as db:
                    cursor = db.execute("DELETE FROM people WHERE id = ?", (person_id,))
                    if not cursor.rowcount:
                        raise ApiError(404, "No se encuentra esa persona")
                return self.send_json({"ok": True})
            raise ApiError(404, "No encontrado")
        except (ValueError, ApiError):
            self.send_json({"error": "No se pudo eliminar la relación"}, 400)

    def list_people(self) -> None:
        with connect() as db:
            rows = db.execute(
                "SELECT * FROM people ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE"
            ).fetchall()
        self.send_json([row_dict(row) for row in rows])

    def get_tree(self) -> None:
        with connect() as db:
            people = [row_dict(r) for r in db.execute("SELECT * FROM people").fetchall()]
            relations = [row_dict(r) for r in db.execute("SELECT * FROM relationships").fetchall()]
        self.send_json({"people": people, "relationships": relations})

    @staticmethod
    def person_values(data: dict) -> tuple[str, ...]:
        first_name = str(data.get("first_name", "")).strip()
        if not first_name:
            raise ApiError(400, "Escribe al menos el nombre")
        return (
            first_name,
            str(data.get("last_name", "")).strip(),
            str(data.get("birth_date", "")).strip(),
            str(data.get("death_date", "")).strip(),
            str(data.get("birth_place", "")).strip(),
            str(data.get("notes", "")).strip(),
        )

    def create_person(self) -> None:
        data = self.read_json()
        values = self.person_values(data)
        is_tree_root = 1 if data.get("is_tree_root") else 0
        now = datetime.now().isoformat(timespec="seconds")
        with connect() as db:
            cursor = db.execute(
                """INSERT INTO people
                (first_name, last_name, birth_date, death_date, birth_place, notes, is_tree_root, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (*values, is_tree_root, now, now),
            )
            person = db.execute("SELECT * FROM people WHERE id = ?", (cursor.lastrowid,)).fetchone()
        self.send_json(row_dict(person), HTTPStatus.CREATED)

    def update_person(self, person_id: int) -> None:
        values = self.person_values(self.read_json())
        with connect() as db:
            cursor = db.execute(
                """UPDATE people SET first_name=?, last_name=?, birth_date=?, death_date=?,
                birth_place=?, notes=?, updated_at=? WHERE id=?""",
                (*values, datetime.now().isoformat(timespec="seconds"), person_id),
            )
            if not cursor.rowcount:
                raise ApiError(404, "No se encuentra esa persona")
            person = db.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone()
        self.send_json(row_dict(person))

    def create_relationship(self) -> None:
        data = self.read_json()
        try:
            person_id = int(data["person_id"])
            relative_id = int(data["relative_id"])
        except (KeyError, TypeError, ValueError):
            raise ApiError(400, "Selecciona las dos personas")
        relation_type = data.get("relation_type")
        parent_role = data.get("parent_role") if relation_type == "parent" else None
        if relation_type not in ("parent", "partner"):
            raise ApiError(400, "El tipo de relación no es válido")
        if parent_role not in (None, "father", "mother"):
            raise ApiError(400, "El rol de progenitor no es válido")
        if person_id == relative_id:
            raise ApiError(400, "Una persona no puede relacionarse consigo misma")
        with connect() as db:
            valid = db.execute(
                "SELECT COUNT(*) FROM people WHERE id IN (?, ?)", (person_id, relative_id)
            ).fetchone()[0]
            if valid != 2:
                raise ApiError(404, "No se encuentra una de las personas")
            if relation_type == "parent":
                # A circular ancestry would make an infinite visual tree impossible.
                pending, visited = [relative_id], set()
                while pending:
                    ancestor = pending.pop()
                    if ancestor == person_id:
                        raise ApiError(400, "Esta relación crearía un ciclo en el árbol")
                    if ancestor in visited:
                        continue
                    visited.add(ancestor)
                    pending.extend(
                        row[0]
                        for row in db.execute(
                            "SELECT relative_id FROM relationships WHERE person_id = ? AND relation_type = 'parent'",
                            (ancestor,),
                        )
                    )
            cursor = db.execute(
                "INSERT INTO relationships(person_id, relative_id, relation_type, parent_role) VALUES (?, ?, ?, ?)",
                (person_id, relative_id, relation_type, parent_role),
            )
            if relation_type == "partner":
                db.execute(
                    "INSERT OR IGNORE INTO relationships(person_id, relative_id, relation_type) VALUES (?, ?, 'partner')",
                    (relative_id, person_id),
                )
        self.send_json({"id": cursor.lastrowid}, HTTPStatus.CREATED)

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path == "/" else unquote(path.lstrip("/"))
        target = (STATIC_DIR / relative).resolve()
        if STATIC_DIR.resolve() not in target.parents and target != STATIC_DIR.resolve():
            raise ApiError(403, "Acceso no permitido")
        if not target.is_file():
            raise ApiError(404, "Página no encontrada")
        body = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    init_db()
    server = None
    active_port = PORT
    for candidate_port in range(PORT, PORT + 20):
        try:
            server = ThreadingHTTPServer((HOST, candidate_port), Handler)
            active_port = candidate_port
            break
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
    if server is None:
        raise OSError(
            f"No se pudo abrir ningún puerto local entre {PORT} y {PORT + 19}. "
            "Cierra otras instancias de Mi Árbol Familiar e inténtalo de nuevo."
        )
    url = f"http://{HOST}:{active_port}"
    print(f"Mi Árbol Familiar está disponible en {url}")
    if os.environ.get("ARBOL_NO_BROWSER") != "1":
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAplicación cerrada")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
