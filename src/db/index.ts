/**
 * The database handle, created on first use rather than at import.
 *
 * opus-1 built the pool at module scope, which was fine while only CLI scripts
 * imported it. opus-2 adds an API route (the standalone TTS endpoint), and
 * `next build` imports every route module to analyse it — so a module-scope
 * `databaseUrl()` would turn a missing DATABASE_URL into a build failure.
 * Plan §4 is explicit that a missing env value degrades and never blocks, and a
 * build that cannot run without a database is the opposite of that.
 *
 * The exported `db` is a proxy so existing call sites are unchanged; the pool
 * is still created exactly once, just at the first query instead of the first
 * import.
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { databaseUrl } from "@/config/env";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

function createDatabase() {
  // connectionLimit stays small: Hostinger MySQL caps concurrent connections per user.
  const pool = mysql.createPool({
    uri: databaseUrl(),
    connectionLimit: 8,
    timezone: "Z",
  });
  return drizzle(pool, { schema, mode: "default" });
}

let instance: Database | null = null;

export function getDb(): Database {
  instance ??= createDatabase();
  return instance;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const database = getDb();
    const value = Reflect.get(database as object, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export { schema };
