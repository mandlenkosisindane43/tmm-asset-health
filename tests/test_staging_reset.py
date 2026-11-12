import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('reset', Path(__file__).resolve().parents[1] / 'scripts/tmm_clear_staging_demo.py')
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)

class ResetTests(unittest.TestCase):
    def test_tenant_isolation_backup_restore_and_child_order(self):
        db = sqlite3.connect(':memory:')
        db.executescript('''PRAGMA foreign_keys=ON;
        CREATE TABLE machines(id INTEGER PRIMARY KEY,company_id INTEGER,fleet_number TEXT);
        CREATE TABLE events(id INTEGER PRIMARY KEY,company_id INTEGER,machine INTEGER REFERENCES machines(id));
        CREATE TABLE contractor_accounts(id INTEGER PRIMARY KEY,company_id INTEGER);
        INSERT INTO machines VALUES(1,7,'demo'),(2,8,'real');
        INSERT INTO events VALUES(1,7,1),(2,8,2);
        INSERT INTO contractor_accounts VALUES(1,7);''')
        schema = {n: {'columns': [r[1] for r in db.execute(f'PRAGMA table_info({n})')],
                       'parents': [r[2] for r in db.execute(f'PRAGMA foreign_key_list({n})')]}
                  for n in ['machines', 'events', 'contractor_accounts']}
        tables, backup, delete = reset.plan(schema, 7)
        self.assertNotIn('contractor_accounts', tables)
        for q in backup + delete:
            db.execute(q['sql'], q['params'])
        self.assertEqual(db.execute('SELECT * FROM machines').fetchall(), [(2,8,'real')])
        self.assertEqual(db.execute('SELECT * FROM events').fetchall(), [(2,8,2)])
        self.assertEqual(db.execute('SELECT count(*) FROM contractor_accounts').fetchone()[0], 1)
        for name in ['machines', 'events']:
            db.execute(f'INSERT INTO {name} SELECT * FROM {reset.PREFIX+name}')
        self.assertEqual(db.execute('SELECT count(*) FROM machines').fetchone()[0], 2)
    def test_reject_missing_tenant_key(self):
        with self.assertRaises(ValueError):
            reset.plan({'machines': {'columns': ['id'], 'parents': []}}, 7)
    def test_reject_unsafe_identifier(self):
        with self.assertRaises(ValueError):
            reset.ident('machines; DROP TABLE companies')

if __name__ == '__main__':
    unittest.main()
