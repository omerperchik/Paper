import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { badRequest, notFound } from "../errors.js";

// ---------------------------------------------------------------------------
// Platform OAuth configuration
// ---------------------------------------------------------------------------

export type OAuthPlatform = "google" | "meta" | "twitter" | "linkedin" | "stripe";

interface PlatformOAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Additional query parameters required by the platform */
  extraParams?: Record<string, string>;
}

const PLATFORM_CONFIGS: Record<OAuthPlatform, PlatformOAuthConfig> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/adwords",
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
    extraParams: { access_type: "offline", prompt: "consent" },
  },
  meta: {
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: [
      "ads_management",
      "ads_read",
      "instagram_basic",
      "instagram_manage_insights",
      "pages_read_engagement",
    ],
  },
  twitter: {
    authorizeUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    extraParams: { code_challenge_method: "plain" },
  },
  linkedin: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["r_organization_social", "rw_organization_admin", "r_ads", "r_ads_reporting"],
  },
  stripe: {
    authorizeUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    scopes: ["read_write"],
    extraParams: { response_type: "code" },
  },
};

const VALID_PLATFORMS = new Set<string>(Object.keys(PLATFORM_CONFIGS));

export function isValidPlatform(platform: string): platform is OAuthPlatform {
  return VALID_PLATFORMS.has(platform);
}

// ---------------------------------------------------------------------------
// Connection row type (mirrors the marketing_oauth_connections table)
// ---------------------------------------------------------------------------

export interface OAuthConnection {
  id: string;
  companyId: string;
  platform: OAuthPlatform;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  accountName: string | null;
  accountId: string | null;
  scopes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function marketingOAuthService(db: Db) {
  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function getClientCredentials(platform: OAuthPlatform) {
    // In production, these would come from env / secret store.
    // We read from process.env so tests can inject values.
    const prefix = platform.toUpperCase();
    return {
      clientId: process.env[`${prefix}_OAUTH_CLIENT_ID`] ?? "",
      clientSecret: process.env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "",
    };
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    /**
     * Build the authorization URL that the frontend should redirect the user to.
     */
    generateAuthUrl(
      companyId: string,
      platform: OAuthPlatform,
      redirectUri: string,
    ): string {
      const config = PLATFORM_CONFIGS[platform];
      const { clientId } = getClientCredentials(platform);

      const state = Buffer.from(
        JSON.stringify({ companyId, platform }),
      ).toString("base64url");

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: config.scopes.join(" "),
        state,
        ...(config.extraParams ?? {}),
      });

      // Twitter PKCE: for simplicity we use a plain code_challenge equal to
      // the state value.  A real implementation would use S256.
      if (platform === "twitter") {
        params.set("code_challenge", state);
      }

      return `${config.authorizeUrl}?${params.toString()}`;
    },

    /**
     * Exchange an authorization code for tokens and persist the connection.
     */
    async handleCallback(
      companyId: string,
      platform: OAuthPlatform,
      code: string,
      redirectUri: string,
    ): Promise<OAuthConnection> {
      const config = PLATFORM_CONFIGS[platform];
      const { clientId, clientSecret } = getClientCredentials(platform);

      // Exchange code for token
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const tokenRes = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        throw badRequest(`Token exchange failed for ${platform}: ${errBody}`);
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
      };

      const id = randomUUID();
      const now = new Date();
      const expiresAt = tokenData.expires_in
        ? new Date(now.getTime() + tokenData.expires_in * 1000)
        : null;

      // Upsert connection – one connection per company+platform
      await db.execute(sql`
        INSERT INTO marketing_oauth_connections (
          id, company_id, platform, access_token, refresh_token,
          token_expires_at, scopes, created_at, updated_at
        ) VALUES (
          ${id}, ${companyId}, ${platform}, ${tokenData.access_token},
          ${tokenData.refresh_token ?? null},
          ${expiresAt?.toISOString() ?? null},
          ${config.scopes.join(" ")},
          ${now.toISOString()}, ${now.toISOString()}
        )
        ON CONFLICT (company_id, platform) DO UPDATE SET
          access_token = EXCLUDED.access_token,
          refresh_token = COALESCE(EXCLUDED.refresh_token, marketing_oauth_connections.refresh_token),
          token_expires_at = EXCLUDED.token_expires_at,
          scopes = EXCLUDED.scopes,
          updated_at = EXCLUDED.updated_at
      `);

      // Return the persisted row
      const rows = await db.execute(sql`
        SELECT * FROM marketing_oauth_connections
        WHERE company_id = ${companyId} AND platform = ${platform}
        LIMIT 1
      `);

      return mapConnectionRow(rows.rows[0]);
    },

    /**
     * List all OAuth connections for a company.
     */
    async listConnections(companyId: string): Promise<OAuthConnection[]> {
      const rows = await db.execute(sql`
        SELECT * FROM marketing_oauth_connections
        WHERE company_id = ${companyId}
        ORDER BY created_at DESC
      `);
      return rows.rows.map(mapConnectionRow);
    },

    /**
     * Refresh an expired access token using the stored refresh_token.
     */
    async refreshToken(connectionId: string): Promise<OAuthConnection> {
      const connRows = await db.execute(sql`
        SELECT * FROM marketing_oauth_connections WHERE id = ${connectionId} LIMIT 1
      `);

      const conn = connRows.rows[0];
      if (!conn) throw notFound("Connection not found");

      const platform = conn.platform as OAuthPlatform;
      const refreshTokenValue = conn.refresh_token as string | null;
      if (!refreshTokenValue) {
        throw badRequest("No refresh token available for this connection");
      }

      const config = PLATFORM_CONFIGS[platform];
      const { clientId, clientSecret } = getClientCredentials(platform);

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshTokenValue,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const tokenRes = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        throw badRequest(`Token refresh failed for ${platform}: ${errBody}`);
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const now = new Date();
      const expiresAt = tokenData.expires_in
        ? new Date(now.getTime() + tokenData.expires_in * 1000)
        : null;

      await db.execute(sql`
        UPDATE marketing_oauth_connections SET
          access_token = ${tokenData.access_token},
          refresh_token = COALESCE(${tokenData.refresh_token ?? null}, refresh_token),
          token_expires_at = ${expiresAt?.toISOString() ?? null},
          updated_at = ${now.toISOString()}
        WHERE id = ${connectionId}
      `);

      const updatedRows = await db.execute(sql`
        SELECT * FROM marketing_oauth_connections WHERE id = ${connectionId} LIMIT 1
      `);
      return mapConnectionRow(updatedRows.rows[0]);
    },

    /**
     * Revoke and delete a connection.
     */
    async deleteConnection(connectionId: string): Promise<void> {
      const connRows = await db.execute(sql`
        SELECT * FROM marketing_oauth_connections WHERE id = ${connectionId} LIMIT 1
      `);
      if (!connRows.rows[0]) throw notFound("Connection not found");

      // Best-effort revocation could be added per-platform here.

      await db.execute(sql`
        DELETE FROM marketing_oauth_connections WHERE id = ${connectionId}
      `);
    },

    /**
     * Get a valid access token for a company + platform, auto-refreshing if
     * the token has expired or will expire within the next 5 minutes.
     */
    async getActiveToken(companyId: string, platform: OAuthPlatform): Promise<string> {
      const rows = await db.execute(sql`
        SELECT * FROM marketing_oauth_connections
        WHERE company_id = ${companyId} AND platform = ${platform}
        LIMIT 1
      `);

      const conn = rows.rows[0];
      if (!conn) throw notFound(`No ${platform} connection found for this company`);

      const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at as string) : null;
      const bufferMs = 5 * 60 * 1000; // 5 minutes

      if (expiresAt && expiresAt.getTime() - Date.now() < bufferMs) {
        // Token expired or about to expire – refresh it
        const refreshed = await this.refreshToken(conn.id as string);
        return refreshed.accessToken;
      }

      return conn.access_token as string;
    },
  };
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapConnectionRow(row: any): OAuthConnection {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    platform: row.platform as OAuthPlatform,
    accessToken: row.access_token as string,
    refreshToken: (row.refresh_token as string) ?? null,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at as string) : null,
    accountName: (row.account_name as string) ?? null,
    accountId: (row.account_id as string) ?? null,
    scopes: (row.scopes as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
