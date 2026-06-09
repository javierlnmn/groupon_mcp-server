import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
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
import type { OAuthRepository } from "@/repositories/oauth-repository";

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
 * client_id/secret generation; this class supplies the OAuth logic: who the user
 * is (credentials verified against the users table), code/token issuance, and
 * verification. All persistence is delegated to OAuthRepository.
 */
export class DbOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly repo: OAuthRepository,
    private readonly issuerUrl: string,
  ) {}

  /* ── Client store ─────────────────────────────────────────────────────────── */

  get clientsStore(): OAuthRegisteredClientsStore {
    const repo = this.repo;
    return {
      getClient(clientId) {
        return repo.getClient(clientId);
      },
      registerClient(client) {
        const full = client as OAuthClientInformationFull;
        repo.saveClient(full);
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
    const client = this.repo.getClient(pending.clientId);
    if (!client || !client.redirect_uris.includes(pending.redirectUri)) {
      res.status(400).send("Invalid client or redirect_uri.");
      return;
    }

    const user = this.repo.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res
        .status(401)
        .set("Content-Type", "text/html")
        .send(renderLoginPage(pending, "Invalid email or password."));
      return;
    }

    // Credentials good → mint a single-use authorization code.
    const code = newToken();
    this.repo.saveAuthCode({
      code,
      clientId: pending.clientId,
      userId: user.id,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
      expiresAt: nowSeconds() + AUTH_CODE_TTL_SECONDS,
    });

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
    const row = this.repo.getAuthCode(authorizationCode, client.client_id);
    if (!row) throw new InvalidGrantError("Invalid authorization code");
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const row = this.repo.getAuthCode(authorizationCode, client.client_id);
    if (!row) throw new InvalidGrantError("Invalid authorization code");

    if (row.expires_at <= nowSeconds()) {
      this.repo.deleteAuthCode(authorizationCode);
      throw new InvalidGrantError("Authorization code has expired");
    }
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError("redirect_uri does not match");
    }

    this.repo.deleteAuthCode(authorizationCode); // single use

    return this.issueTokens(client.client_id, row.user_id);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const row = this.repo.findByRefreshToken(refreshToken, client.client_id);
    if (!row) throw new InvalidGrantError("Invalid refresh token");

    // Rotate: drop the old row, issue a fresh access/refresh pair.
    this.repo.deleteAccessToken(row.access_token);

    return this.issueTokens(client.client_id, row.user_id);
  }

  // ── Verification / revocation ────────────────────────────────────────────────

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // The lookup carries the owning user's role, which rides along on the auth
    // info — the tool layer reads it from req.auth.extra.role to gate tools.
    const info = this.repo.getAccessToken(token);

    if (!info) throw new InvalidTokenError("Invalid access token");
    if (info.expiresAt <= nowSeconds()) {
      this.repo.deleteAccessToken(token);
      throw new InvalidTokenError("Access token has expired");
    }

    return {
      token,
      clientId: info.clientId,
      scopes: [],
      expiresAt: info.expiresAt,
      extra: { userId: info.userId, role: info.role },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.repo.revoke(client.client_id, request.token);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private issueTokens(clientId: string, userId: number): OAuthTokens {
    const accessToken = newToken();
    const refreshToken = newToken();
    const expiresAt = nowSeconds() + ACCESS_TOKEN_TTL_SECONDS;

    this.repo.saveToken({ accessToken, refreshToken, clientId, userId, expiresAt });

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
