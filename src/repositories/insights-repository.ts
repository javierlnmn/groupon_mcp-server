import type { Database } from "better-sqlite3";
import {
  CategoryInsights,
  MarketGaps,
  PricePositioning,
  type Category,
  type Location,
} from "@/models";

/**
 * Read-only analytics over deals/options/reviews for the merchant intelligence
 * tools. Returns computed read-models (see models/insights.ts), or null when a
 * referenced category/location/deal slug or id doesn't exist.
 */
export class InsightsRepository {
  constructor(private readonly db: Database) {}

  /** Benchmarking stats for a category, optionally narrowed to one location. */
  categoryInsights(
    categorySlug: string,
    locationSlug?: string,
  ): CategoryInsights | null {
    const category = this.findCategory(categorySlug);
    if (!category) return null;

    let location: Location | null = null;
    if (locationSlug !== undefined) {
      location = this.findLocation(locationSlug);
      if (!location) return null;
    }

    const scope =
      "d.is_active = 1 AND d.category_id = @cat" +
      (location ? " AND d.location_id = @loc" : "");
    const params = { cat: category.id, loc: location?.id };

    const perDeal = this.db
      .prepare(
        `SELECT MAX(o.discount_pct) AS discount, MIN(o.price) AS min_price,
                MAX(o.price) AS max_price
         FROM deals d JOIN deal_options o ON o.deal_id = d.id
         WHERE ${scope}
         GROUP BY d.id`,
      )
      .all(params) as {
      discount: number;
      min_price: number;
      max_price: number;
    }[];

    const topMerchants = this.db
      .prepare(
        `SELECT m.id, m.name, m.location_id, COUNT(*) AS deal_count
         FROM deals d JOIN merchants m ON m.id = d.merchant_id
         WHERE ${scope}
         GROUP BY m.id ORDER BY deal_count DESC, m.name LIMIT 5`,
      )
      .all(params) as {
      id: number;
      name: string;
      location_id: number;
      deal_count: number;
    }[];

    const discounts = perDeal.map((r) => r.discount);
    return CategoryInsights.parse({
      category,
      location,
      deal_count: perDeal.length,
      avg_discount_pct: discounts.length ? round1(mean(discounts)) : null,
      median_discount_pct: median(discounts),
      price_min: perDeal.length
        ? Math.min(...perDeal.map((r) => r.min_price))
        : null,
      price_max: perDeal.length
        ? Math.max(...perDeal.map((r) => r.max_price))
        : null,
      top_merchants: topMerchants.map((m) => ({
        merchant: { id: m.id, name: m.name, location_id: m.location_id },
        deal_count: m.deal_count,
      })),
    });
  }

  /** Categories under-supplied in a location relative to the other markets. */
  marketGaps(locationSlug: string): MarketGaps | null {
    const location = this.findLocation(locationSlug);
    if (!location) return null;

    const { total } = this.db
      .prepare("SELECT COUNT(*) AS total FROM locations")
      .get() as { total: number };
    const otherLocationCount = Math.max(total - 1, 0);

    const rows = this.db
      .prepare(
        `SELECT c.id, c.slug, c.name,
                SUM(CASE WHEN d.id IS NOT NULL AND d.location_id =  @loc THEN 1 ELSE 0 END) AS local_count,
                SUM(CASE WHEN d.id IS NOT NULL AND d.location_id <> @loc THEN 1 ELSE 0 END) AS other_total
         FROM categories c
         LEFT JOIN deals d ON d.category_id = c.id AND d.is_active = 1
         GROUP BY c.id`,
      )
      .all({ loc: location.id }) as {
      id: number;
      slug: string;
      name: string;
      local_count: number;
      other_total: number;
    }[];

    const gaps = rows
      .map((r) => {
        const otherAvg = otherLocationCount
          ? r.other_total / otherLocationCount
          : 0;
        return {
          category: { id: r.id, slug: r.slug, name: r.name },
          local_deal_count: r.local_count,
          other_locations_avg: round1(otherAvg),
          gap_score: round1(otherAvg - r.local_count),
        };
      })
      .sort((a, b) => b.gap_score - a.gap_score);

    return MarketGaps.parse({
      location,
      other_location_count: otherLocationCount,
      gaps,
    });
  }

  /** How a deal's headline price/discount sits among its category peers. */
  pricePositioning(dealId: number): PricePositioning | null {
    const deal = this.db
      .prepare(
        `SELECT d.id, d.title, c.id AS c_id, c.slug AS c_slug, c.name AS c_name
         FROM deals d JOIN categories c ON c.id = d.category_id
         WHERE d.id = ?`,
      )
      .get(dealId) as
      | { id: number; title: string; c_id: number; c_slug: string; c_name: string }
      | undefined;
    if (!deal) return null;

    const headline = this.db
      .prepare(
        "SELECT MIN(price) AS price, MAX(discount_pct) AS discount FROM deal_options WHERE deal_id = ?",
      )
      .get(dealId) as { price: number | null; discount: number | null };

    const peers = this.db
      .prepare(
        `SELECT MIN(o.price) AS price, MAX(o.discount_pct) AS discount
         FROM deals d JOIN deal_options o ON o.deal_id = d.id
         WHERE d.is_active = 1 AND d.category_id = @cat AND d.id <> @deal
         GROUP BY d.id`,
      )
      .all({ cat: deal.c_id, deal: dealId }) as {
      price: number;
      discount: number;
    }[];

    const price = headline.price ?? 0;
    const discount = headline.discount ?? 0;
    const pct = (n: number) => (peers.length ? round1((n / peers.length) * 100) : null);

    return PricePositioning.parse({
      deal_id: deal.id,
      title: deal.title,
      category: { id: deal.c_id, slug: deal.c_slug, name: deal.c_name },
      peer_count: peers.length,
      price,
      discount_pct: discount,
      category_median_price: median(peers.map((p) => p.price)),
      category_median_discount_pct: median(peers.map((p) => p.discount)),
      cheaper_than_pct: pct(peers.filter((p) => p.price > price).length),
      bigger_discount_than_pct: pct(
        peers.filter((p) => p.discount < discount).length,
      ),
    });
  }

  private findCategory(slug: string): Category | null {
    return (
      (this.db
        .prepare("SELECT id, slug, name FROM categories WHERE slug = ?")
        .get(slug) as Category | undefined) ?? null
    );
  }

  private findLocation(slug: string): Location | null {
    return (
      (this.db
        .prepare("SELECT id, slug, name, region FROM locations WHERE slug = ?")
        .get(slug) as Location | undefined) ?? null
    );
  }
}

const mean = (values: number[]): number =>
  values.reduce((sum, n) => sum + n, 0) / values.length;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Median of the values, or null when empty. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return round1(raw);
}
