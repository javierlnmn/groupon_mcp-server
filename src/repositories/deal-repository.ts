import type { Database } from "better-sqlite3";
import { Deal, DealComparison } from "@/models";

/** Optional filters for {@link DealRepository.searchActiveDeals}. */
export interface DealSearchFilters {
  /** Free-text keyword matched against title/description via FTS5. */
  query?: string;
  /** Category slug (exact). */
  category?: string;
  /** Location slug (exact). */
  location?: string;
  /** Keep deals with at least one option priced at or below this. */
  maxPrice?: number;
  /** Keep deals with at least one option discounted at or above this (%). */
  minDiscount?: number;
  /** Cap the number of results. */
  limit?: number;
}

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

/** A deal's headline price — its cheapest option (0 if it somehow has none). */
const headlinePrice = (deal: Deal): number =>
  deal.options.length ? Math.min(...deal.options.map((o) => o.price)) : 0;

/** A deal's headline discount — its largest option discount (0 if none). */
const headlineDiscount = (deal: Deal): number =>
  deal.options.length
    ? Math.max(...deal.options.map((o) => o.discount_pct))
    : 0;

/**
 * Turn a user keyword string into a safe FTS5 prefix query: alphanumeric terms
 * only, each made a prefix match, ANDed together (e.g. "thai food" → `thai* food*`).
 * Returns "" when nothing usable remains, so the caller can skip the FTS join.
 */
function toFtsQuery(raw: string): string {
  const terms = raw.match(/[a-z0-9]+/gi) ?? [];
  return terms.map((t) => `${t}*`).join(" ");
}

/**
 * Persistence access for deals.
 */
export class DealRepository {
  constructor(private readonly db: Database) {}

  /** Active deals matching the given filters (all optional). */
  searchActiveDeals(filters: DealSearchFilters = {}): Deal[] {
    const where = ["d.is_active = 1"];
    const params: Record<string, unknown> = {};
    let ftsJoin = "";
    let orderBy = "ORDER BY d.id";

    const fts = filters.query ? toFtsQuery(filters.query) : "";
    if (fts) {
      ftsJoin = "JOIN deals_fts f ON f.rowid = d.id";
      where.push("f MATCH @q");
      params.q = fts;
      orderBy = "ORDER BY f.rank"; // FTS5 relevance, best matches first
    }
    if (filters.category) {
      where.push("c.slug = @category");
      params.category = filters.category;
    }
    if (filters.location) {
      where.push("l.slug = @location");
      params.location = filters.location;
    }
    if (filters.maxPrice !== undefined) {
      where.push(
        "EXISTS (SELECT 1 FROM deal_options o WHERE o.deal_id = d.id AND o.price <= @maxPrice)",
      );
      params.maxPrice = filters.maxPrice;
    }
    if (filters.minDiscount !== undefined) {
      where.push(
        "EXISTS (SELECT 1 FROM deal_options o WHERE o.deal_id = d.id AND o.discount_pct >= @minDiscount)",
      );
      params.minDiscount = filters.minDiscount;
    }
    let limitClause = "";
    if (filters.limit !== undefined) {
      limitClause = "LIMIT @limit";
      params.limit = filters.limit;
    }

    const rows = this.db
      .prepare(
        `${DEAL_SELECT} ${ftsJoin} WHERE ${where.join(" AND ")} ${orderBy} ${limitClause}`,
      )
      .all(params) as JoinedDealRow[];
    return rows.map((r) => this.assembleDeal(r));
  }

  /** A single deal by id (active or not), or null when no such deal exists. */
  getDeal(id: number): Deal | null {
    const row = this.db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id) as
      | JoinedDealRow
      | undefined;
    return row ? this.assembleDeal(row) : null;
  }

  /** Deals for the given ids (active or not), in the order the ids were given. */
  getDealsByIds(ids: number[]): Deal[] {
    return ids.map((id) => this.getDeal(id)).filter((d): d is Deal => d !== null);
  }

  /** Fetch several deals and reduce them to a side-by-side comparison. */
  compareDeals(ids: number[]): DealComparison {
    const deals = this.getDealsByIds(ids);
    const summary = deals.map((d) => ({
      deal_id: d.id,
      title: d.title,
      price: headlinePrice(d),
      discount_pct: headlineDiscount(d),
      rating: d.rating,
      reviews_count: d.reviews_count,
    }));

    const pick = (best: (a: Deal, b: Deal) => Deal): number | null =>
      deals.length ? deals.reduce(best).id : null;

    return DealComparison.parse({
      deals,
      summary,
      cheapest_deal_id: pick((a, b) =>
        headlinePrice(a) <= headlinePrice(b) ? a : b,
      ),
      biggest_discount_deal_id: pick((a, b) =>
        headlineDiscount(a) >= headlineDiscount(b) ? a : b,
      ),
      highest_rated_deal_id: pick((a, b) =>
        (a.rating ?? -1) >= (b.rating ?? -1) ? a : b,
      ),
    });
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
