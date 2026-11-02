import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { schema } from './native-vault';

describe('catalog SQL on real Node SQLite (not native disk acceptance)', () => {
  it('preserves quoted private text via bound values and enforces ownership/unique save requests', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(schema);
      const title = "Synthetic '); DROP TABLE lectures; --";
      db.prepare('INSERT INTO lectures VALUES(?,?,?)').run('lecture', title, '2026-11-02T00:00:00Z');
      expect(db.prepare('SELECT title FROM lectures').get()?.title).toBe(title);
      const insert = db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?)');
      expect(() => insert.run('a', 'unknown', 'request', 'time', 'path', 1, '0'.repeat(64))).toThrow();
      insert.run('a', 'lecture', 'request', 'time', 'path', 1, '0'.repeat(64));
      expect(() => insert.run('b', 'lecture', 'request', 'time', 'other', 1, '0'.repeat(64))).toThrow();
      expect(db.prepare('SELECT count(*) AS count FROM captures').get()?.count).toBe(1);
    } finally { db.close(); }
  });
  it('rolls back a capture insert when the later pending-record change fails', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(schema);
      db.prepare('INSERT INTO lectures VALUES(?,?,?)').run('lecture', 'Synthetic', 'time');
      db.prepare('INSERT INTO pending_saves VALUES(?,?,?,?,?,?,?,?)').run('a', 'lecture', 'request', 'time', 'path', 1, '0'.repeat(64), 'file:///synthetic');
      db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON pending_saves BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?)').run('a', 'lecture', 'request', 'time', 'path', 1, '0'.repeat(64));
        db.prepare('DELETE FROM pending_saves WHERE request_id=?').run('request');
        db.exec('COMMIT');
      } catch { db.exec('ROLLBACK'); }
      expect(db.prepare('SELECT count(*) AS count FROM captures').get()?.count).toBe(0);
      expect(db.prepare('SELECT count(*) AS count FROM pending_saves').get()?.count).toBe(1);
    } finally { db.close(); }
  });
});
