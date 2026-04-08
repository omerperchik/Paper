#!/bin/bash
set -euo pipefail

# Paper Marketing Team Setup Script
# Creates a complete marketing team for a product within the Paperclip platform
# Usage: ./setup-marketing-team.sh <server_url> <company_id> [product_name]

SERVER_URL="${1:?Usage: setup-marketing-team.sh <server_url> <company_id> [product_name]}"
COMPANY_ID="${2:?Usage: setup-marketing-team.sh <server_url> <company_id> [product_name]}"
PRODUCT_NAME="${3:-Default Product}"

API="$SERVER_URL/api/companies/$COMPANY_ID"

echo "=== Setting up Marketing Team for: $PRODUCT_NAME ==="
echo "Server: $SERVER_URL"
echo "Company: $COMPANY_ID"
echo ""

# Helper to create an agent and capture the API key
create_agent() {
    local name="$1"
    local role="$2"
    local title="$3"
    local reports_to="$4"
    local budget_cents="$5"
    local capabilities="$6"

    echo "Creating agent: $name ($title)..."

    local response
    response=$(curl -sf "$API/agents" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"$name\",
            \"role\": \"$role\",
            \"title\": \"$title\",
            \"reportsTo\": $reports_to,
            \"adapterType\": \"gemma_local\",
            \"budgetMonthlyCents\": $budget_cents,
            \"capabilities\": $capabilities,
            \"adapterConfig\": {
                \"ollamaUrl\": \"http://ollama:11434/v1\",
                \"ollamaModel\": \"gemma4:e4b\",
                \"fallbackUrl\": \"https://api.minimaxi.chat/v1\",
                \"fallbackModel\": \"MiniMax-M1\"
            },
            \"metadata\": {
                \"product\": \"$PRODUCT_NAME\",
                \"team\": \"marketing\"
            }
        }")

    local agent_id
    agent_id=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "unknown")
    echo "  -> Agent ID: $agent_id"
    echo "$agent_id"
}

echo "--- Creating Marketing Leadership ---"

CMO_ID=$(create_agent \
    "${PRODUCT_NAME}-cmo" \
    "cmo" \
    "Chief Marketing Officer" \
    "null" \
    10000 \
    '["strategy", "budget-management", "team-coordination", "analytics", "reporting"]')

echo ""
echo "--- Creating Marketing Specialists ---"

CONTENT_ID=$(create_agent \
    "${PRODUCT_NAME}-content-strategist" \
    "content-strategist" \
    "Content Strategist" \
    "\"$CMO_ID\"" \
    5000 \
    '["content-creation", "seo-writing", "social-copy", "video-scripts", "blog-posts"]')

SEO_ID=$(create_agent \
    "${PRODUCT_NAME}-seo-specialist" \
    "seo-specialist" \
    "SEO Specialist" \
    "\"$CMO_ID\"" \
    3000 \
    '["keyword-research", "technical-seo", "on-page-optimization", "competitor-analysis"]')

PAID_ID=$(create_agent \
    "${PRODUCT_NAME}-paid-acquisition" \
    "paid-acquisition" \
    "Paid Acquisition Manager" \
    "\"$CMO_ID\"" \
    8000 \
    '["google-ads", "meta-ads", "tiktok-ads", "campaign-optimization", "budget-management"]')

SOCIAL_ID=$(create_agent \
    "${PRODUCT_NAME}-social-media" \
    "social-media" \
    "Social Media Manager" \
    "\"$CMO_ID\"" \
    3000 \
    '["twitter", "linkedin", "instagram", "tiktok", "community-engagement"]')

EMAIL_ID=$(create_agent \
    "${PRODUCT_NAME}-email-marketing" \
    "email-marketing" \
    "Email Marketing Specialist" \
    "\"$CMO_ID\"" \
    3000 \
    '["email-campaigns", "drip-sequences", "segmentation", "deliverability"]')

ANALYTICS_ID=$(create_agent \
    "${PRODUCT_NAME}-analytics-lead" \
    "analytics-lead" \
    "Marketing Analytics Lead" \
    "\"$CMO_ID\"" \
    3000 \
    '["analytics", "attribution", "experiment-scoring", "anomaly-detection", "reporting"]')

COMMUNITY_ID=$(create_agent \
    "${PRODUCT_NAME}-community-manager" \
    "community-manager" \
    "Community Manager" \
    "\"$CMO_ID\"" \
    2000 \
    '["reddit", "forums", "brand-monitoring", "influencer-outreach"]')

CRO_ID=$(create_agent \
    "${PRODUCT_NAME}-conversion-optimizer" \
    "conversion-optimizer" \
    "Conversion Rate Optimizer" \
    "\"$CMO_ID\"" \
    3000 \
    '["landing-pages", "a-b-testing", "funnel-optimization", "ux-audit"]')

META_ID=$(create_agent \
    "${PRODUCT_NAME}-meta-optimizer" \
    "meta-optimizer" \
    "Meta Optimizer" \
    "\"$CMO_ID\"" \
    2000 \
    '["agent-optimization", "prompt-tuning", "skill-creation", "performance-analysis"]')

echo ""
echo "=== Marketing Team Created ==="
echo ""
echo "Team for: $PRODUCT_NAME"
echo "  CMO:                  $CMO_ID"
echo "  Content Strategist:   $CONTENT_ID"
echo "  SEO Specialist:       $SEO_ID"
echo "  Paid Acquisition:     $PAID_ID"
echo "  Social Media:         $SOCIAL_ID"
echo "  Email Marketing:      $EMAIL_ID"
echo "  Analytics Lead:       $ANALYTICS_ID"
echo "  Community Manager:    $COMMUNITY_ID"
echo "  Conversion Optimizer: $CRO_ID"
echo "  Meta Optimizer:       $META_ID"
echo ""
echo "Next: Create goals and initial issues for the CMO to start working."
