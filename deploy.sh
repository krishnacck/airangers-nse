#!/bin/bash
# Auto-deployment script for AIRangers
# This script runs WITHOUT sudo - no password needed

APP_DIR="/home/nse/nse.airangers.in"
APP_NAME="airangers"

cd "$APP_DIR" || exit 1

echo "📦 Pulling latest code..."
git pull origin main

echo "📥 Installing dependencies..."
npm install --production

echo "🔨 Running build..."
npm run build

echo "🔄 Restarting app..."
# Try PM2 first (no sudo needed if PM2 runs under same user)
if command -v pm2 &> /dev/null; then
  pm2 describe "$APP_NAME" > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    pm2 restart "$APP_NAME"
  else
    pm2 start server.js --name "$APP_NAME"
  fi
  pm2 save
  echo "✅ App restarted with PM2"
else
  # Fallback: kill existing node process and restart
  pkill -f "node server.js" 2>/dev/null || true
  sleep 1
  nohup node server.js > /tmp/airangers.log 2>&1 &
  echo "✅ App restarted with nohup (PID: $!)"
fi

echo "✅ Deployment complete!"
