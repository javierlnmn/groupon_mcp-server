import Database from "better-sqlite3";
import { SCHEMA_SQL } from "@/db/schema";
import { seed } from "@/db/seed";

/**
 * Singleton class that owns the whole DB lifecycle.
 * The DB is always in-memory, rebuilt and seeded on each launch.
 */
export class DbClient {
  private static instance: DbClient | null = null;

  readonly connection: Database.Database;

  private constructor() {
    this.connection = new Database(":memory:");
    this.connection.pragma("foreign_keys = ON");
    this.connection.exec(SCHEMA_SQL);
    seed(this.connection);
  }

  static getInstance(): DbClient {
    if (!DbClient.instance) DbClient.instance = new DbClient();
    return DbClient.instance;
  }

  close(): void {
    this.connection.close();
    DbClient.instance = null;
  }
}
