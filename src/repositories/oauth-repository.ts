import type { Database } from "better-sqlite3";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth";
import type {
  OAuthAuthCodeRow,
  OAuthClientRow,
  OAuthTokenRow,
  UserRole,
  UserRow,
} from "@/db/schema";

export interface NewAuthCode {
  code: string;
  clientId: string;
  userId: number;
  codeChallenge: string;
  redirectUri: string;
  expiresAt: number;
}

export interface NewToken {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  userId: number;
  expiresAt: number;
}

/** Token lookup joined with the owning user's role. */
export interface AccessTokenInfo {
  clientId: string;
  userId: number;
  expiresAt: number;
  role: UserRole;
}

/**
 * Persistence access for OAuth. OAuth tokens/clients aren't domain entities.
 */
export class OAuthRepository {
  constructor(private readonly db: Database) {}

  /* ── Clients ─────────────────────────────────────────────────────────────── */

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db
      .prepare("SELECT client_info FROM oauth_clients WHERE client_id = ?")
      .get(clientId) as Pick<OAuthClientRow, "client_info"> | undefined;
    return row
      ? (JSON.parse(row.client_info) as OAuthClientInformationFull)
      : undefined;
  }

  saveClient(client: OAuthClientInformationFull): void {
    this.db
      .prepare(
        "INSERT INTO oauth_clients (client_id, client_info) VALUES (?, ?)",
      )
      .run(client.client_id, JSON.stringify(client));
  }

  /* ── Users (login credential lookup) ─────────────────────────────────────── */

  findUserByEmail(email: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
      | UserRow
      | undefined;
  }

  /* ── Authorization codes ─────────────────────────────────────────────────── */

  saveAuthCode(c: NewAuthCode): void {
    this.db
      .prepare(
        `INSERT INTO oauth_auth_codes
           (code, client_id, user_id, code_challenge, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.code,
        c.clientId,
        c.userId,
        c.codeChallenge,
        c.redirectUri,
        c.expiresAt,
      );
  }

  getAuthCode(code: string, clientId: string): OAuthAuthCodeRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM oauth_auth_codes WHERE code = ? AND client_id = ?",
      )
      .get(code, clientId) as OAuthAuthCodeRow | undefined;
  }

  deleteAuthCode(code: string): void {
    this.db.prepare("DELETE FROM oauth_auth_codes WHERE code = ?").run(code);
  }

  /* ── Tokens ──────────────────────────────────────────────────────────────── */

  saveToken(t: NewToken): void {
    this.db
      .prepare(
        `INSERT INTO oauth_tokens
           (access_token, refresh_token, client_id, user_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(t.accessToken, t.refreshToken, t.clientId, t.userId, t.expiresAt);
  }

  findByRefreshToken(
    refreshToken: string,
    clientId: string,
  ): OAuthTokenRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM oauth_tokens WHERE refresh_token = ? AND client_id = ?",
      )
      .get(refreshToken, clientId) as OAuthTokenRow | undefined;
  }

  /** Access token joined with the owning user's role (for verification). */
  getAccessToken(accessToken: string): AccessTokenInfo | undefined {
    return this.db
      .prepare(
        `SELECT t.client_id AS clientId, t.user_id AS userId,
                t.expires_at AS expiresAt, u.role AS role
         FROM oauth_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.access_token = ?`,
      )
      .get(accessToken) as AccessTokenInfo | undefined;
  }

  deleteAccessToken(accessToken: string): void {
    this.db
      .prepare("DELETE FROM oauth_tokens WHERE access_token = ?")
      .run(accessToken);
  }

  /** Revoke by either token type, scoped to the owning client. */
  revoke(clientId: string, token: string): void {
    this.db
      .prepare(
        `DELETE FROM oauth_tokens
         WHERE client_id = ? AND (access_token = ? OR refresh_token = ?)`,
      )
      .run(clientId, token, token);
  }
}
