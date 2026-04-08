import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { marketingOAuthService, isValidPlatform } from "../services/marketing-oauth.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

export function marketingOAuthRoutes(db: Db) {
  const router = Router();
  const svc = marketingOAuthService(db);

  // -----------------------------------------------------------------------
  // GET /companies/:companyId/marketing/oauth/:platform/authorize
  // Generate the OAuth authorization URL for a given platform.
  // -----------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/oauth/:platform/authorize",
    async (req, res) => {
      const { companyId, platform } = req.params;
      assertCompanyAccess(req, companyId);

      if (!isValidPlatform(platform)) {
        throw badRequest(`Unsupported OAuth platform: ${platform}`);
      }

      const redirectUri =
        (req.query.redirect_uri as string | undefined) ??
        `${req.protocol}://${req.get("host")}/api/companies/${companyId}/marketing/oauth/callback`;

      const url = svc.generateAuthUrl(companyId, platform, redirectUri);
      res.json({ url });
    },
  );

  // -----------------------------------------------------------------------
  // GET /companies/:companyId/marketing/oauth/callback
  // Universal OAuth callback handler. Platform is encoded in `state`.
  // -----------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/oauth/callback",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);

      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;

      if (!code) throw badRequest("Missing authorization code");
      if (!state) throw badRequest("Missing state parameter");

      let parsed: { companyId: string; platform: string };
      try {
        parsed = JSON.parse(Buffer.from(state, "base64url").toString());
      } catch {
        throw badRequest("Invalid state parameter");
      }

      if (parsed.companyId !== companyId) {
        throw badRequest("State company ID mismatch");
      }

      if (!isValidPlatform(parsed.platform)) {
        throw badRequest(`Unsupported OAuth platform in state: ${parsed.platform}`);
      }

      const redirectUri =
        `${req.protocol}://${req.get("host")}/api/companies/${companyId}/marketing/oauth/callback`;

      const connection = await svc.handleCallback(
        companyId,
        parsed.platform,
        code,
        redirectUri,
      );

      res.json(connection);
    },
  );

  // -----------------------------------------------------------------------
  // GET /companies/:companyId/marketing/connections
  // List all connected marketing accounts for a company.
  // -----------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/connections",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const connections = await svc.listConnections(companyId);
      res.json(connections);
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /companies/:companyId/marketing/connections/:connectionId
  // Disconnect (revoke + remove) a marketing account connection.
  // -----------------------------------------------------------------------
  router.delete(
    "/companies/:companyId/marketing/connections/:connectionId",
    async (req, res) => {
      const { companyId, connectionId } = req.params;
      assertCompanyAccess(req, companyId);
      await svc.deleteConnection(connectionId);
      res.json({ ok: true });
    },
  );

  return router;
}
