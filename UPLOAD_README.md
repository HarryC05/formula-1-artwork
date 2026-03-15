# TheSportsDB Upload Automation

This automation script uploads Formula 1 2026 artwork (posters, thumbnails, and banners) to TheSportsDB.com using browser automation.

## Prerequisites

1. **TheSportsDB Account**: You need a registered account with edit permissions
2. **Generated Images**: Run `npm run generate -- --csv 2026.csv` first to generate all images
3. **Node.js**: v16 or higher

## Setup

### 1. Install Dependencies

Already done if you've installed the main project dependencies:

```bash
npm install
```

### 2. Configure Credentials

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your TheSportsDB credentials:

```env
SPORTSDB_USERNAME=your_username
SPORTSDB_PASSWORD=your_password
```

**Important**: Never commit `.env` to git. It's already in `.gitignore`.

## Usage

### Basic Commands

```bash
# Dry run (simulate without uploading)
npm run upload:dry-run

# Watch browser automation (non-headless)
npm run upload:visible

# Full upload (production)
npm run upload

# Verbose logging
npm run upload:verbose
```

### Advanced Options

```bash
# Start from specific row (e.g., resume from row 50)
node upload-to-sportsdb.js --start-row=50

# Limit to specific number of events
node upload-to-sportsdb.js --limit=5

# Combine options
node upload-to-sportsdb.js --dry-run --verbose --headless=false --limit=3
```

## How It Works

1. **Login**: Authenticates to TheSportsDB using credentials from `.env`
2. **Navigate**: Goes to F1 2026 season page
3. **Match Events**: Maps CSV rows to event links in order
4. **Upload Loop**: For each event:
   - Navigates to event page
   - Uploads Poster JPG
   - Uploads Thumb (thumbnail) JPG
   - Uploads Banner JPG
   - Returns to season page
5. **Report**: Generates summary of uploads

### File Path Resolution

The script automatically resolves image paths based on CSV data:

**Testing Sessions:**
```
posters/2026/00-bh-testing-01/jpg/day-01.jpg
thumbnails/2026/00-bh-testing-01/jpg/day-01.jpg
banners/2026/00-bh-testing-01/jpg/day-01.jpg
```

**Race Sessions:**
```
posters/2026/01-au/jpg/practice-01.jpg
thumbnails/2026/01-au/jpg/practice-01.jpg
banners/2026/01-au/jpg/practice-01.jpg
```

## Output & Logging

### Console Output

```
🏎️  TheSportsDB F1 2026 Image Upload Automation
================================================

📊 Loaded 126 events from 2026.csv
🔑 Logging in as: your_username
✓ Login successful
📍 Navigating to F1 2026 season page
✓ Found 126 event links on page

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] Bahrain DAY 01 (2026-02-11)
  📂 Poster:  posters/2026/00-bh-testing-01/jpg/day-01.jpg
  📂 Thumb:   thumbnails/2026/00-bh-testing-01/jpg/day-01.jpg
  📂 Banner:  banners/2026/00-bh-testing-01/jpg/day-01.jpg
  🔗 On event page
  📤 Poster uploaded ✓ (2.3s)
  📤 Thumb uploaded ✓ (1.8s)
  📤 Banner uploaded ✓ (2.1s)
  ✅ Complete (6.2s total)

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Upload Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Successful:     120 events (360 images)
⚠️  Partial:        4 events
❌ Failed:          2 events
⏱️  Total time:     14m 52s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Detailed log saved to: upload-logs/upload-2026-03-15.log
```

### Log Files

All operations are logged to `upload-logs/upload-YYYY-MM-DD.log` with timestamps:

```
[14:23:45] [INFO] Login successful
[14:23:47] [INFO] Found 126 event links on page
[14:23:50] [SUCCESS] Poster uploaded ✓ (2.3s)
```

### Error Screenshots

When uploads fail, screenshots are automatically saved to `upload-logs/` for debugging.

## Error Handling

The script handles common errors gracefully:

- **File not found**: Logs warning, continues to next image
- **Upload form not found**: Takes screenshot, logs error, continues
- **Network timeout**: Logs error, continues to next event
- **Login failure**: Exits with clear error message

## Estimated Time

- **Per Event**: ~8 seconds (includes navigation + 3 uploads)
- **Full Run**: ~17-20 minutes for all 126 events

## Testing Workflow

### Step 1: Dry Run (Recommended First)

```bash
npm run upload:dry-run
```

This simulates the entire process without uploading anything. Use this to:
- Verify credentials work
- Check file paths are correct
- Ensure CSV parsing works
- Validate all 126 events are found

### Step 2: Visual Test (Single Event)

```bash
node upload-to-sportsdb.js --headless=false --limit=1
```

Watch the browser automation in real-time for the first event. This helps:
- Verify selectors work correctly
- Check upload flow is correct
- Identify any UI differences

### Step 3: Small Batch Test

```bash
node upload-to-sportsdb.js --limit=5
```

Upload first 5 events to production. Then:
- Manually verify images appear on TheSportsDB
- Check image quality
- Confirm correct events matched

### Step 4: Full Production Run

```bash
npm run upload
```

Process all 126 events. You can:
- Stop anytime with Ctrl+C
- Resume with `--start-row=X`
- Monitor progress in real-time

## Troubleshooting

### "Missing credentials" error

Make sure `.env` file exists with:
```
SPORTSDB_USERNAME=your_username
SPORTSDB_PASSWORD=your_password
```

### "CSV file not found" error

Ensure `2026.csv` exists in project root.

### Upload form not found

The script tries multiple selector strategies, but if TheSportsDB's HTML structure changed:
1. Run with `--headless=false` to see what's happening
2. Check `upload-logs/` for screenshots
3. May need to update selectors in `upload-to-sportsdb.js`

### Images not uploading

Check:
1. Images exist: `ls posters/2026/*/jpg/`
2. Paths are correct in dry-run mode
3. You have edit permissions on TheSportsDB

### Resume interrupted upload

If the script stops partway through:

```bash
# Resume from row 50
node upload-to-sportsdb.js --start-row=50
```

## Security Notes

- `.env` is gitignored - never commit credentials
- Credentials are only used for login, never logged
- All communication is over HTTPS
- Browser state is not persisted between runs

## Support

If you encounter issues:

1. Check `upload-logs/` for detailed logs
2. Look at error screenshots if available
3. Try running with `--verbose` for more details
4. Test with `--headless=false` to watch the process

## License

MIT
