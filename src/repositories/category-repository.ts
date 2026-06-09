import type { Database } from "better-sqlite3";
import { Category } from "@/models";

/** Persistence access for categories — the valid category filter values. */
export class CategoryRepository {
  constructor(private readonly db: Database) {}

  /** Every category, alphabetical by name. */
  listAll(): Category[] {
    const rows = this.db
      .prepare("SELECT id, slug, name FROM categories ORDER BY name")
      .all();
    return rows.map((r) => Category.parse(r));
  }
}
