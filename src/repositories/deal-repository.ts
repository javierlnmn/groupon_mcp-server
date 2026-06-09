import type { Database } from "better-sqlite3";
import { Deal } from "@/models";

/** Deal joined with its category, merchant, and location (one flat row). */
interface JoinedDealRow {
  id: number;
  title: string;
  description: string;
  fine_print: string | null;
  valid_until: string | null;
  is_active: number;
  c_id: number;
  c_slug: string;
  c_name: string;
  m_id: number;
  m_name: string;
  m_location_id: number;
  l_id: number;
  l_slug: string;
  l_name: string;
  l_region: string;
}

/** SQL query to join deals with categories, merchants, and locations. */
const DEAL_SELECT = `
  SELECT
    d.id, d.title, d.description, d.fine_print, d.valid_until, d.is_active,
    c.id AS c_id, c.slug AS c_slug, c.name AS c_name,
    m.id AS m_id, m.name AS m_name, m.location_id AS m_location_id,
    l.id AS l_id, l.slug AS l_slug, l.name AS l_name, l.region AS l_region
  FROM deals d
  JOIN categories c ON c.id = d.category_id
  JOIN merchants  m ON m.id = d.merchant_id
  JOIN locations  l ON l.id = d.location_id
`;

/**
 * Persistence access for deals.
 */
export class DealRepository {
  constructor(private readonly db: Database) {}

  /** Active deals, optionally filtered by a keyword in the title/description. */
  searchActiveDeals(query?: string): Deal[] {
    const q = query?.trim();
    const rows = q
      ? (this.db
          .prepare(
            `${DEAL_SELECT}
             WHERE d.is_active = 1 AND (d.title LIKE @q OR d.description LIKE @q)
             ORDER BY d.id`,
          )
          .all({ q: `%${q}%` }) as JoinedDealRow[])
      : (this.db
          .prepare(`${DEAL_SELECT} WHERE d.is_active = 1 ORDER BY d.id`)
          .all() as JoinedDealRow[]);
    return rows.map((r) => this.assembleDeal(r));
  }

  /** A single deal by id (active or not), or null when no such deal exists. */
  getDeal(id: number): Deal | null {
    const row = this.db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id) as
      | JoinedDealRow
      | undefined;
    return row ? this.assembleDeal(row) : null;
  }

  /** Every deal including inactive ones — a merchant-side management view. */
  listAllDeals(): Deal[] {
    const rows = this.db
      .prepare(`${DEAL_SELECT} ORDER BY d.is_active DESC, d.id`)
      .all() as JoinedDealRow[];
    return rows.map((r) => this.assembleDeal(r));
  }

  /** Build the nested domain Deal for one joined row, then validate it. */
  private assembleDeal(row: JoinedDealRow): Deal {
    const options = this.db
      .prepare(
        `SELECT id, deal_id, title, price, original_price, discount_pct
         FROM deal_options WHERE deal_id = ?`,
      )
      .all(row.id);

    const review = this.db
      .prepare(
        "SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM deal_reviews WHERE deal_id = ?",
      )
      .get(row.id) as { avg: number | null; cnt: number };

    return Deal.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      category: { id: row.c_id, slug: row.c_slug, name: row.c_name },
      merchant: {
        id: row.m_id,
        name: row.m_name,
        location_id: row.m_location_id,
      },
      location: {
        id: row.l_id,
        slug: row.l_slug,
        name: row.l_name,
        region: row.l_region,
      },
      options,
      rating: review.avg === null ? null : Math.round(review.avg * 10) / 10,
      reviews_count: review.cnt,
      fine_print: row.fine_print,
      valid_until: row.valid_until,
      is_active: row.is_active === 1,
    });
  }
}
