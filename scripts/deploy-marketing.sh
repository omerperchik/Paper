#!/bin/bash
set -euo pipefail

# Paper Marketing Team - VPS Deployment Script
# Deploys the autonomous marketing platform to a VPS with Ollama + Gemma4

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration
VPS_HOST="${VPS_HOST:-root@213.199.33.145}"
VPS_PORT="${VPS_PORT:-6000}"
DEPLOY_DIR="/opt/paper"

echo "=== Paper Marketing Team Deployment ==="
echo "Target: $VPS_HOST"
echo "Port: $VPS_PORT"
echo ""

# Step 1: Ensure .env exists
if [ ! -f "$PROJECT_DIR/docker/.env.marketing" ]; then
    echo "Creating .env.marketing from template..."
    cat > "$PROJECT_DIR/docker/.env.marketing" << 'ENVEOF'
BETTER_AUTH_SECRET=paper-marketing-secret-change-me-in-production
PAPERCLIP_PUBLIC_URL=http://213.199.33.145:6000
AI_FALLBACK_API_KEY=
MARKETING_CAC_ALERT=50
MARKETING_APPROVAL_REQUIRED=true
ENVEOF
    echo "WARNING: Edit docker/.env.marketing with your actual secrets before deploying!"
fi

# Step 2: Sync project to VPS
echo "Syncing project to VPS..."
rsync -avz --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='data' \
    --exclude='.env' \
    -e "ssh" \
    "$PROJECT_DIR/" "$VPS_HOST:$DEPLOY_DIR/"

# Step 3: Deploy on VPS
echo "Deploying on VPS..."
ssh "$VPS_HOST" << 'SSHEOF'
set -euo pipefail
cd /opt/paper

# Copy env file
cp docker/.env.marketing docker/.env

# Build and start services
cd docker
docker compose -f docker-compose.marketing.yml down --remove-orphans 2>/dev/null || true
docker compose -f docker-compose.marketing.yml build --no-cache
docker compose -f docker-compose.marketing.yml up -d

# Wait for Ollama to be ready
echo "Waiting for Ollama to start..."
sleep 10

# Pull Gemma4 model
echo "Pulling Gemma4 model (this may take a while on first run)..."
docker compose -f docker-compose.marketing.yml exec ollama ollama pull gemma4:e4b || {
    echo "WARNING: Could not pull gemma4:e4b. Trying gemma3:4b as fallback..."
    docker compose -f docker-compose.marketing.yml exec ollama ollama pull gemma3:4b
}

# Health check
echo "Running health checks..."
sleep 5
for i in $(seq 1 30); do
    if curl -sf http://localhost:6000/api/health > /dev/null 2>&1; then
        echo "Server is healthy!"
        break
    fi
    echo "Waiting for server to be ready... ($i/30)"
    sleep 2
done

echo ""
echo "=== Deployment Complete ==="
echo "Paper Marketing Platform: http://$(hostname -I | awk '{print $1}'):6000"
echo "Ollama API: http://localhost:11434"
echo ""
echo "Next steps:"
echo "1. Access the UI at http://213.199.33.145:6000"
echo "2. Create a company for each product"
echo "3. The CMO agent will hire and configure the marketing team"
SSHEOF

echo ""
echo "=== Deployment finished ==="
echo "Access your marketing platform at: http://213.199.33.145:$VPS_PORT"
