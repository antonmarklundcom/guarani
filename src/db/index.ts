import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { databaseUrl } from "@/config/env";
import * as schema from "./schema";

// connectionLimit stays small: Hostinger MySQL caps concurrent connections per user.
const pool = mysql.createPool({
  uri: databaseUrl(),
  connectionLimit: 8,
  timezone: "Z",
});

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
