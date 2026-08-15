import os
import tempfile
import unittest
from pathlib import Path

import app


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        app.DATA_DIR = Path(self.temp.name)
        app.DB_PATH = app.DATA_DIR / "test.sqlite3"
        app.init_db()

    def tearDown(self):
        self.temp.cleanup()

    def test_schema_accepts_people_and_relationships(self):
        with app.connect() as db:
            now = "2026-01-01T00:00:00"
            first = db.execute(
                "INSERT INTO people(first_name, created_at, updated_at) VALUES(?,?,?)",
                ("Ana", now, now),
            ).lastrowid
            second = db.execute(
                "INSERT INTO people(first_name, created_at, updated_at) VALUES(?,?,?)",
                ("María", now, now),
            ).lastrowid
            db.execute(
                "INSERT INTO relationships(person_id, relative_id, relation_type) VALUES(?,?,?)",
                (first, second, "parent"),
            )
            self.assertEqual(db.execute("SELECT COUNT(*) FROM people").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM relationships").fetchone()[0], 1)

    def test_relationship_to_self_is_rejected(self):
        with app.connect() as db:
            now = "2026-01-01T00:00:00"
            person = db.execute(
                "INSERT INTO people(first_name, created_at, updated_at) VALUES(?,?,?)",
                ("Luis", now, now),
            ).lastrowid
            with self.assertRaises(Exception):
                db.execute(
                    "INSERT INTO relationships(person_id, relative_id, relation_type) VALUES(?,?,?)",
                    (person, person, "parent"),
                )

    def test_parent_role_is_available_after_initialization(self):
        with app.connect() as db:
            columns = {row[1] for row in db.execute("PRAGMA table_info(relationships)")}
        self.assertIn("parent_role", columns)


if __name__ == "__main__":
    unittest.main()
