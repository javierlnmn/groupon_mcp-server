import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { Database } from "better-sqlite3";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors";
import { verifyPassword } from "@/auth/password";
import type {
  OAuthAuthCodeRow,
  OAuthClientRow,
  OAuthTokenRow,
  UserRow,
} from "@/db/schema";

const AUTH_CODE_TTL_SECONDS = 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const newToken = () => randomBytes(32).toString("hex");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The OAuth params we thread through the login form as hidden fields. */
interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

/**
 * An OAuth 2.1 authorization server backed by the application's SQLite DB.
 *
 * The MCP SDK's `mcpAuthRouter` owns the HTTP endpoints, PKCE validation, and
 * client_id/secret generation; this class supplies the actual logic: who the user
 * is (verified against the `users` table), and persistence of clients, codes, and
 * tokens. See src/db/schema.ts for the backing tables.
 */
export class DbOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly db: Database,
    private readonly issuerUrl: string,
  ) {}

  /* ── Client store ─────────────────────────────────────────────────────────── */

  get clientsStore(): OAuthRegisteredClientsStore {
    const db = this.db;
    return {
      getClient(clientId) {
        const row = db
          .prepare("SELECT client_info FROM oauth_clients WHERE client_id = ?")
          .get(clientId) as Pick<OAuthClientRow, "client_info"> | undefined;
        return row
          ? (JSON.parse(row.client_info) as OAuthClientInformationFull)
          : undefined;
      },
      registerClient(client) {
        const full = client as OAuthClientInformationFull;
        db.prepare(
          "INSERT INTO oauth_clients (client_id, client_info) VALUES (?, ?)",
        ).run(full.client_id, JSON.stringify(full));
        return full;
      },
    };
  }

  /* ── Authorization (login) ──────────────────────────────────────────────────── */

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const pending: PendingAuthorization = {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
    };
    res.set("Content-Type", "text/html").send(renderLoginPage(pending));
  }

  /**
   * Handles the POST from the login form. Not part of the OAuthServerProvider
   * interface — wired directly as the /login route in src/config/server.ts.
   */
  handleLogin = (req: Request, res: Response): void => {
    const body = req.body ?? {};
    const pending: PendingAuthorization = {
      clientId: String(body.client_id ?? ""),
      redirectUri: String(body.redirect_uri ?? ""),
      codeChallenge: String(body.code_challenge ?? ""),
      state: body.state ? String(body.state) : undefined,
    };
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");

    // Re-validate the client and redirect_uri — these came back through the form
    // and must not be trusted blindly.
    const client = this.clientsStore.getClient(pending.clientId) as
      | OAuthClientInformationFull
      | undefined;
    if (!client || !client.redirect_uris.includes(pending.redirectUri)) {
      res.status(400).send("Invalid client or redirect_uri.");
      return;
    }

    const user = this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as UserRow | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      res
        .status(401)
        .set("Content-Type", "text/html")
        .send(renderLoginPage(pending, "Invalid email or password."));
      return;
    }

    // Credentials good → mint a single-use authorization code.
    const code = newToken();
    this.db
      .prepare(
        `INSERT INTO oauth_auth_codes
           (code, client_id, user_id, code_challenge, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code,
        pending.clientId,
        user.id,
        pending.codeChallenge,
        pending.redirectUri,
        nowSeconds() + AUTH_CODE_TTL_SECONDS,
      );

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", code);
    if (pending.state) redirect.searchParams.set("state", pending.state);
    redirect.searchParams.set("iss", this.issuerUrl);
    res.redirect(redirect.toString());
  };

  // ── Token exchange ───────────────────────────────────────────────────────────

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const row = this.getAuthCode(authorizationCode, client.client_id);
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const row = this.getAuthCode(authorizationCode, client.client_id);

    if (row.expires_at <= nowSeconds()) {
      this.deleteAuthCode(authorizationCode);
      throw new InvalidGrantError("Authorization code has expired");
    }
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError("redirect_uri does not match");
    }

    this.deleteAuthCode(authorizationCode);

    return this.issueTokens(client.client_id, row.user_id);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const row = this.db
      .prepare(
        "SELECT * FROM oauth_tokens WHERE refresh_token = ? AND client_id = ?",
      )
      .get(refreshToken, client.client_id) as OAuthTokenRow | undefined;

    if (!row) throw new InvalidGrantError("Invalid refresh token");

    // Rotate: drop the old row, issue a fresh access/refresh pair.
    this.db
      .prepare("DELETE FROM oauth_tokens WHERE access_token = ?")
      .run(row.access_token);

    return this.issueTokens(client.client_id, row.user_id);
  }

  // ── Verification / revocation ────────────────────────────────────────────────

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.db
      .prepare("SELECT * FROM oauth_tokens WHERE access_token = ?")
      .get(token) as OAuthTokenRow | undefined;

    if (!row) throw new InvalidTokenError("Invalid access token");
    if (row.expires_at <= nowSeconds()) {
      this.db
        .prepare("DELETE FROM oauth_tokens WHERE access_token = ?")
        .run(token);
      throw new InvalidTokenError("Access token has expired");
    }

    return {
      token,
      clientId: row.client_id,
      scopes: [],
      expiresAt: row.expires_at,
      extra: { userId: row.user_id },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // Match on either token type; scoped to the requesting client.
    this.db
      .prepare(
        `DELETE FROM oauth_tokens
         WHERE client_id = ? AND (access_token = ? OR refresh_token = ?)`,
      )
      .run(client.client_id, request.token, request.token);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private getAuthCode(code: string, clientId: string): OAuthAuthCodeRow {
    const row = this.db
      .prepare(
        "SELECT * FROM oauth_auth_codes WHERE code = ? AND client_id = ?",
      )
      .get(code, clientId) as OAuthAuthCodeRow | undefined;
    if (!row) throw new InvalidGrantError("Invalid authorization code");
    return row;
  }

  private deleteAuthCode(code: string): void {
    this.db.prepare("DELETE FROM oauth_auth_codes WHERE code = ?").run(code);
  }

  private issueTokens(clientId: string, userId: number): OAuthTokens {
    const accessToken = newToken();
    const refreshToken = newToken();
    const expiresAt = nowSeconds() + ACCESS_TOKEN_TTL_SECONDS;

    this.db
      .prepare(
        `INSERT INTO oauth_tokens
           (access_token, refresh_token, client_id, user_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(accessToken, refreshToken, clientId, userId, expiresAt);

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
    };
  }
}

// ── Login page ─────────────────────────────────────────────────────────────────

function renderLoginPage(
  pending: PendingAuthorization,
  error?: string,
): string {
  const hidden = (name: string, value: string | undefined) =>
    value === undefined
      ? ""
      : `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Sign in</title></head>
<body>
  <form method="post" action="/login">
    <h1>Sign in to continue</h1>
    ${error ? `<p style="color:#b3261e">${escapeHtml(error)}</p>` : ""}
    ${hidden("client_id", pending.clientId)}
    ${hidden("redirect_uri", pending.redirectUri)}
    ${hidden("code_challenge", pending.codeChallenge)}
    ${hidden("state", pending.state)}
    <p><label>Email <input name="email" type="email" required /></label></p>
    <p><label>Password <input name="password" type="password" required /></label></p>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}
