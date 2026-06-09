import type { Database } from "better-sqlite3";
import {
  users,
  categories,
  locations,
  merchants,
  deals,
  dealOptions,
  dealReviews,
} from "@/db/fixtures";
import { hashPassword } from "@/utils/password";

/**
 * Populates database from the fixtures.
 */
export function seed(db: Database): void {
  const insertUser = db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role) " +
      "VALUES (@id, @name, @email, @password_hash, @role)",
  );
  const insertCategory = db.prepare(
    "INSERT INTO categories (id, slug, name) VALUES (@id, @slug, @name)",
  );
  const insertLocation = db.prepare(
    "INSERT INTO locations (id, slug, name, region) VALUES (@id, @slug, @name, @region)",
  );
  const insertMerchant = db.prepare(
    "INSERT INTO merchants (id, name, location_id) VALUES (@id, @name, @location_id)",
  );
  const insertDeal = db.prepare(`
    INSERT INTO deals (
      id, title, description, category_id, merchant_id, location_id,
      fine_print, valid_until, is_active
    ) VALUES (
      @id, @title, @description, @category_id, @merchant_id, @location_id,
      @fine_print, @valid_until, @is_active
    )
  `);
  const insertOption = db.prepare(`
    INSERT INTO deal_options (id, deal_id, title, price, original_price)
    VALUES (@id, @deal_id, @title, @price, @original_price)
  `);
  const insertDealReview = db.prepare(`
    INSERT INTO deal_reviews (id, deal_id, user_id, rating, comment, created_at)
    VALUES (@id, @deal_id, @user_id, @rating, @comment, @created_at)
  `);

  const seedAll = db.transaction(() => {
    for (const u of users) {
      insertUser.run({
        id: u.id,
        name: u.name,
        email: u.email,
        password_hash: hashPassword(u.password),
        role: u.role,
      });
    }
    for (const c of categories) insertCategory.run(c);
    for (const l of locations) insertLocation.run(l);
    for (const m of merchants) insertMerchant.run(m);
    for (const d of deals) {
      insertDeal.run({ ...d, is_active: d.is_active ? 1 : 0 });
    }
    for (const o of dealOptions) insertOption.run(o);
    for (const r of dealReviews) insertDealReview.run(r);
    // Build the FTS index from the rows just inserted.
    db.exec(
      "INSERT INTO deals_fts (rowid, title, description) " +
        "SELECT id, title, description FROM deals",
    );
  });

  seedAll();
}
