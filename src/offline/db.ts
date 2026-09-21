import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// SQLite (not AsyncStorage) so that saving an order is a single atomic write
// that survives the app being killed mid-way.
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('outbox.db');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS outbox (
          client_ref TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          display TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}
