import type { Database } from "better-sqlite3";
import { Location } from "@/models";

/** Persistence access for locations — the valid location filter values. */
export class LocationRepository {
  constructor(private readonly db: Database) {}

  /** Every location, alphabetical by name. */
  listAll(): Location[] {
    const rows = this.db
      .prepare("SELECT id, slug, name, region FROM locations ORDER BY name")
      .all();
    return rows.map((r) => Location.parse(r));
  }
}
