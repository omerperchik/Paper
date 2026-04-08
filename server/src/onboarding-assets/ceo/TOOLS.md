# Marketing Team Tools

## Channel Analytics
- `marketing_calculate_cac` -- Calculate Customer Acquisition Cost by channel
- `marketing_ltv_cac_ratio` -- Calculate lifetime value to CAC ratio
- `marketing_anomaly_detect` -- Detect anomalies in marketing metrics
- `marketing_experiment_score` -- Score A/B experiments statistically
- `marketing_daily_brief` -- Generate the daily marketing performance brief

## Content & Quality
- `marketing_humanizer_check` -- Score content against AI detection patterns
- `marketing_expert_panel` -- Run content through simulated expert review panel
- `marketing_content_calendar` -- Manage content calendar entries
- `marketing_seo_check` -- Validate content for SEO best practices

## Channel Integrations
- `marketing_google_ads_report` -- Pull Google Ads campaign performance
- `marketing_meta_ads_report` -- Pull Meta/Facebook Ads performance
- `marketing_gsc_report` -- Pull Google Search Console data
- `marketing_social_metrics` -- Pull social media engagement metrics
- `marketing_email_metrics` -- Pull email campaign metrics
- `marketing_reddit_monitor` -- Monitor Reddit for mentions and opportunities

## Cost & Budget
- `marketing_track_spend` -- Record marketing spend per channel/campaign
- `marketing_track_conversion` -- Record conversion events with attribution
- `marketing_cac_by_channel` -- Get real-time CAC per channel
- `marketing_cac_trend` -- Get CAC trend over configurable time window
- `marketing_optimize_budget` -- Get AI-powered budget reallocation suggestions
- `marketing_payback_period` -- Calculate customer payback period by channel

## Outreach & Publishing
- `marketing_send_email_campaign` -- Send email campaign via Brevo/Resend
- `marketing_schedule_social_post` -- Schedule social media content
- `marketing_send_push_notification` -- Send push notification via OneSignal
- `marketing_whatsapp_brief` -- Send performance brief via WhatsApp
- `marketing_post_reddit_comment` -- Post Reddit comment (requires approval)

## Browser Automation (API-less fallbacks)
- `marketing_scrape_serp` -- Scrape search engine results for keyword research
- `marketing_scrape_competitor` -- Analyze competitor marketing pages
- `marketing_scrape_app_store` -- Pull app store listings and reviews
- `marketing_check_landing_page` -- Audit landing page for conversion issues

## Usage Notes
- All spend/publish actions go through the approval queue
- CAC tracking updates automatically when spend or conversions are recorded
- Browser tools are fallbacks -- prefer API integrations when available
- The CMO has access to all tools; other agents get subsets relevant to their role
