#!/bin/bash

# TheSportsDB Upload Automation - Quick Setup

echo "🏎️  TheSportsDB Upload Automation - Quick Setup"
echo "==============================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✓ Created .env file"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your credentials:"
    echo "   SPORTSDB_USERNAME=your_username"
    echo "   SPORTSDB_PASSWORD=your_password"
    echo ""
    echo "After editing .env, run this script again."
    exit 0
fi

# Check if credentials are set
if grep -q "SPORTSDB_USERNAME=$" .env || grep -q "SPORTSDB_PASSWORD=$" .env; then
    echo "⚠️  Credentials not set in .env file"
    echo ""
    echo "Please edit .env and add your credentials:"
    echo "   SPORTSDB_USERNAME=your_username"
    echo "   SPORTSDB_PASSWORD=your_password"
    echo ""
    exit 1
fi

echo "✓ Credentials configured"
echo ""

# Check if 2026.csv exists
if [ ! -f 2026.csv ]; then
    echo "❌ 2026.csv not found"
    echo "Please ensure the CSV file exists in the project root"
    exit 1
fi

echo "✓ 2026.csv found"
echo ""

# Check if images exist
if [ ! -d "posters/2026" ] || [ ! -d "thumbnails/2026" ] || [ ! -d "banners/2026" ]; then
    echo "⚠️  Generated images not found"
    echo ""
    echo "Run this first to generate images:"
    echo "   npm run generate -- --csv 2026.csv"
    echo ""
    exit 1
fi

echo "✓ Generated images found"
echo ""

# Count available images
POSTER_COUNT=$(find posters/2026 -name "*.jpg" 2>/dev/null | wc -l | xargs)
THUMB_COUNT=$(find thumbnails/2026 -name "*.jpg" 2>/dev/null | wc -l | xargs)
BANNER_COUNT=$(find banners/2026 -name "*.jpg" 2>/dev/null | wc -l | xargs)

echo "📊 Available images:"
echo "   Posters:    $POSTER_COUNT"
echo "   Thumbnails: $THUMB_COUNT"
echo "   Banners:    $BANNER_COUNT"
echo ""

# Create upload-logs directory
mkdir -p upload-logs

echo "✅ Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo ""
echo "1. Test with dry run (recommended first):"
echo "   npm run upload:dry-run"
echo ""
echo "2. Watch browser automation for 1 event:"
echo "   node upload-to-sportsdb.js --headless=false --limit=1"
echo ""
echo "3. Upload first 5 events (test batch):"
echo "   node upload-to-sportsdb.js --limit=5"
echo ""
echo "4. Full upload (all 126 events):"
echo "   npm run upload"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
