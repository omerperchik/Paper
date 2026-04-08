// ---------------------------------------------------------------------------
// Stripe API v1 — real REST API integration for revenue/subscription metrics
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

const BASE_URL = "https://api.stripe.com/v1";

async function getCredentials(ctx: PluginContext) {
  const secretKey = await ctx.secrets.get("stripeSecretKey");
  if (!secretKey) return null;
  return { secretKey };
}

function authHeaders(secretKey: string) {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

function formEncode(data: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export function registerStripeApiTools(ctx: PluginContext) {

  // -----------------------------------------------------------------------
  // Get MRR, revenue by period
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_stripe_get_revenue", async ({ params }) => {
    const { dateFrom, dateTo, interval = "month" } = params as {
      dateFrom: string; dateTo: string; interval?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Stripe not configured. Set stripeSecretKey in plugin secrets." };
    }
    try {
      const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000);
      const toTs = Math.floor(new Date(dateTo).getTime() / 1000);

      // Get charges for revenue
      const chargesUrl = `${BASE_URL}/charges?created[gte]=${fromTs}&created[lte]=${toTs}&limit=100`;
      const chargesResponse = await ctx.http.get(chargesUrl, {
        headers: authHeaders(creds.secretKey),
      });
      const charges = chargesResponse.data as { data: Array<{ amount: number; currency: string; status: string; created: number }> };

      // Get active subscriptions for MRR
      const subsUrl = `${BASE_URL}/subscriptions?status=active&limit=100`;
      const subsResponse = await ctx.http.get(subsUrl, {
        headers: authHeaders(creds.secretKey),
      });
      const subscriptions = subsResponse.data as { data: Array<{ items: { data: Array<{ price: { unit_amount: number; recurring: { interval: string } } }> } }> };

      // Calculate MRR from active subscriptions
      let mrr = 0;
      for (const sub of subscriptions.data) {
        for (const item of sub.items.data) {
          const amount = item.price.unit_amount;
          const subInterval = item.price.recurring?.interval;
          if (subInterval === "month") mrr += amount;
          else if (subInterval === "year") mrr += Math.round(amount / 12);
          else if (subInterval === "week") mrr += Math.round(amount * 4.33);
        }
      }

      // Sum total revenue from successful charges
      const successfulCharges = charges.data.filter((c) => c.status === "succeeded");
      const totalRevenue = successfulCharges.reduce((sum, c) => sum + c.amount, 0);

      // Group by interval
      const grouped: Record<string, number> = {};
      for (const charge of successfulCharges) {
        const date = new Date(charge.created * 1000);
        let key: string;
        if (interval === "day") key = date.toISOString().split("T")[0];
        else if (interval === "week") {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split("T")[0];
        } else {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        }
        grouped[key] = (grouped[key] ?? 0) + charge.amount;
      }

      ctx.logger.info("Stripe revenue fetched", { totalRevenue: totalRevenue / 100, mrr: mrr / 100 });
      return {
        mrr: mrr / 100,
        mrrCents: mrr,
        totalRevenue: totalRevenue / 100,
        totalRevenueCents: totalRevenue,
        currency: "usd",
        chargeCount: successfulCharges.length,
        revenueByPeriod: Object.fromEntries(
          Object.entries(grouped).map(([k, v]) => [k, v / 100]),
        ),
        dateRange: { from: dateFrom, to: dateTo },
        interval,
      };
    } catch (err) {
      ctx.logger.error("Stripe get revenue failed", { error: String(err) });
      return { error: `Stripe API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get customer list with LTV
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_stripe_get_customers", async ({ params }) => {
    const { limit = 100, startingAfter, email, createdAfter } = params as {
      limit?: number; startingAfter?: string; email?: string; createdAfter?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Stripe not configured. Set stripeSecretKey in plugin secrets." };
    }
    try {
      let url = `${BASE_URL}/customers?limit=${limit}&expand[]=data.subscriptions`;
      if (startingAfter) url += `&starting_after=${startingAfter}`;
      if (email) url += `&email=${encodeURIComponent(email)}`;
      if (createdAfter) url += `&created[gte]=${Math.floor(new Date(createdAfter).getTime() / 1000)}`;

      const response = await ctx.http.get(url, {
        headers: authHeaders(creds.secretKey),
      });
      const data = response.data as {
        data: Array<{
          id: string; email: string; name: string; created: number; metadata: Record<string, string>;
          subscriptions?: { data: Array<{ status: string; items: { data: Array<{ price: { unit_amount: number; recurring: { interval: string } } }> } }> };
        }>;
        has_more: boolean;
      };

      const customers = data.data.map((c) => {
        // Calculate LTV from total charges for this customer
        let monthlyValue = 0;
        if (c.subscriptions?.data) {
          for (const sub of c.subscriptions.data) {
            if (sub.status === "active") {
              for (const item of sub.items.data) {
                const amt = item.price.unit_amount;
                const intv = item.price.recurring?.interval;
                if (intv === "month") monthlyValue += amt;
                else if (intv === "year") monthlyValue += Math.round(amt / 12);
              }
            }
          }
        }
        const ageMonths = Math.max(1, Math.round((Date.now() / 1000 - c.created) / (30.44 * 86400)));
        return {
          id: c.id,
          email: c.email,
          name: c.name,
          created: new Date(c.created * 1000).toISOString(),
          currentMonthlyValue: monthlyValue / 100,
          ageMonths,
          estimatedLtv: (monthlyValue / 100) * Math.min(ageMonths * 2, 36),
          metadata: c.metadata,
        };
      });

      ctx.logger.info("Stripe customers fetched", { count: customers.length });
      return { customers, hasMore: data.has_more };
    } catch (err) {
      ctx.logger.error("Stripe get customers failed", { error: String(err) });
      return { error: `Stripe API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get subscription metrics
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_stripe_get_subscriptions", async ({ params }) => {
    const { status, limit = 100, priceId } = params as {
      status?: string; limit?: number; priceId?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Stripe not configured. Set stripeSecretKey in plugin secrets." };
    }
    try {
      let url = `${BASE_URL}/subscriptions?limit=${limit}`;
      if (status) url += `&status=${status}`;
      if (priceId) url += `&price=${priceId}`;

      const response = await ctx.http.get(url, {
        headers: authHeaders(creds.secretKey),
      });
      const data = response.data as {
        data: Array<{
          id: string; status: string; created: number; current_period_start: number;
          current_period_end: number; cancel_at_period_end: boolean;
          items: { data: Array<{ price: { id: string; unit_amount: number; recurring: { interval: string } } }> };
          customer: string;
        }>;
      };

      const statusCounts: Record<string, number> = {};
      let totalMrr = 0;
      const subscriptions = data.data.map((s) => {
        statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
        let monthlyAmount = 0;
        for (const item of s.items.data) {
          const amt = item.price.unit_amount;
          const intv = item.price.recurring?.interval;
          if (intv === "month") monthlyAmount += amt;
          else if (intv === "year") monthlyAmount += Math.round(amt / 12);
        }
        if (s.status === "active") totalMrr += monthlyAmount;

        return {
          id: s.id,
          status: s.status,
          customer: s.customer,
          monthlyAmount: monthlyAmount / 100,
          cancelAtPeriodEnd: s.cancel_at_period_end,
          created: new Date(s.created * 1000).toISOString(),
          currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
        };
      });

      ctx.logger.info("Stripe subscriptions fetched", { count: subscriptions.length, totalMrr: totalMrr / 100 });
      return {
        subscriptions,
        summary: {
          total: subscriptions.length,
          statusBreakdown: statusCounts,
          mrr: totalMrr / 100,
          arr: (totalMrr / 100) * 12,
        },
      };
    } catch (err) {
      ctx.logger.error("Stripe get subscriptions failed", { error: String(err) });
      return { error: `Stripe API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Calculate LTV by cohort/channel
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_stripe_calculate_ltv", async ({ params }) => {
    const { cohortField = "created", cohortInterval = "month", metadataGroupBy } = params as {
      cohortField?: string; cohortInterval?: string; metadataGroupBy?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Stripe not configured. Set stripeSecretKey in plugin secrets." };
    }
    try {
      // Fetch customers with subscriptions
      const custUrl = `${BASE_URL}/customers?limit=100&expand[]=data.subscriptions`;
      const custResponse = await ctx.http.get(custUrl, {
        headers: authHeaders(creds.secretKey),
      });
      const customers = (custResponse.data as { data: Array<Record<string, unknown>> }).data;

      // Fetch recent charges for revenue data
      const chargesUrl = `${BASE_URL}/charges?limit=100&status=succeeded`;
      const chargesResponse = await ctx.http.get(chargesUrl, {
        headers: authHeaders(creds.secretKey),
      });
      const charges = (chargesResponse.data as { data: Array<{ customer: string; amount: number; created: number }> }).data;

      // Group revenue by customer
      const revenueByCustomer: Record<string, number> = {};
      for (const charge of charges) {
        if (charge.customer) {
          revenueByCustomer[charge.customer] = (revenueByCustomer[charge.customer] ?? 0) + charge.amount;
        }
      }

      // Group customers into cohorts
      const cohorts: Record<string, { customers: number; totalRevenue: number; avgRevenue: number; avgLtv: number }> = {};
      for (const cust of customers) {
        const created = cust.created as number;
        const custId = cust.id as string;
        const metadata = cust.metadata as Record<string, string> | undefined;
        const date = new Date(created * 1000);
        let cohortKey: string;

        if (metadataGroupBy && metadata?.[metadataGroupBy]) {
          cohortKey = metadata[metadataGroupBy];
        } else if (cohortInterval === "month") {
          cohortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        } else if (cohortInterval === "quarter") {
          cohortKey = `${date.getFullYear()}-Q${Math.ceil((date.getMonth() + 1) / 3)}`;
        } else {
          cohortKey = `${date.getFullYear()}`;
        }

        if (!cohorts[cohortKey]) {
          cohorts[cohortKey] = { customers: 0, totalRevenue: 0, avgRevenue: 0, avgLtv: 0 };
        }
        cohorts[cohortKey].customers += 1;
        cohorts[cohortKey].totalRevenue += (revenueByCustomer[custId] ?? 0) / 100;
      }

      // Calculate averages and projected LTV
      for (const key of Object.keys(cohorts)) {
        const c = cohorts[key];
        c.avgRevenue = c.customers > 0 ? Math.round((c.totalRevenue / c.customers) * 100) / 100 : 0;
        // Simple LTV projection: avg revenue * projected lifetime (24 months)
        c.avgLtv = Math.round(c.avgRevenue * 2.4 * 100) / 100;
      }

      ctx.logger.info("Stripe LTV calculated", { cohortCount: Object.keys(cohorts).length });
      return {
        cohorts,
        groupedBy: metadataGroupBy ?? cohortInterval,
        note: "LTV is projected using 2.4x multiplier on average observed revenue. For precise LTV, use longer charge history.",
      };
    } catch (err) {
      ctx.logger.error("Stripe calculate LTV failed", { error: String(err) });
      return { error: `Stripe API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get churn rate
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_stripe_get_churn", async ({ params }) => {
    const { lookbackDays = 30 } = params as { lookbackDays?: number };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Stripe not configured. Set stripeSecretKey in plugin secrets." };
    }
    try {
      const now = Math.floor(Date.now() / 1000);
      const periodStart = now - lookbackDays * 86400;

      // Get canceled subscriptions in the period
      const canceledUrl = `${BASE_URL}/subscriptions?status=canceled&created[gte]=${periodStart}&limit=100`;
      const canceledResponse = await ctx.http.get(canceledUrl, {
        headers: authHeaders(creds.secretKey),
      });
      const canceledSubs = (canceledResponse.data as { data: unknown[] }).data;

      // Get all subscriptions that were active at the start of the period
      const activeUrl = `${BASE_URL}/subscriptions?status=active&limit=100`;
      const activeResponse = await ctx.http.get(activeUrl, {
        headers: authHeaders(creds.secretKey),
      });
      const activeSubs = (activeResponse.data as { data: unknown[] }).data;

      // Also count past_due and unpaid as at-risk
      const pastDueUrl = `${BASE_URL}/subscriptions?status=past_due&limit=100`;
      const pastDueResponse = await ctx.http.get(pastDueUrl, {
        headers: authHeaders(creds.secretKey),
      });
      const pastDueSubs = (pastDueResponse.data as { data: unknown[] }).data;

      const totalAtPeriodStart = activeSubs.length + canceledSubs.length;
      const churnRate = totalAtPeriodStart > 0
        ? Math.round((canceledSubs.length / totalAtPeriodStart) * 10000) / 100
        : 0;
      const annualizedChurnRate = Math.round((1 - Math.pow(1 - churnRate / 100, 12)) * 10000) / 100;

      ctx.logger.info("Stripe churn calculated", { churnRate, lookbackDays });
      return {
        period: {
          days: lookbackDays,
          from: new Date(periodStart * 1000).toISOString(),
          to: new Date(now * 1000).toISOString(),
        },
        activeSubscriptions: activeSubs.length,
        canceledInPeriod: canceledSubs.length,
        pastDueSubscriptions: pastDueSubs.length,
        churnRatePercent: churnRate,
        annualizedChurnRatePercent: annualizedChurnRate,
        retentionRatePercent: Math.round((100 - churnRate) * 100) / 100,
      };
    } catch (err) {
      ctx.logger.error("Stripe get churn failed", { error: String(err) });
      return { error: `Stripe API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}
