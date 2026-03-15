# Formula 1 Artwork

Custom artwork and thumbnails for Formula 1 race weekends.

## Quick Start

### Generate Artwork

```bash
# Generate all artwork (posters, thumbnails, banners) from CSV
npm run generate -- --csv 2026.csv

# Generate only thumbnails
npm run generate -- --csv 2026.csv --type thumbnails

# Generate only posters
npm run generate -- --csv 2026.csv --type posters
```

### Upload to TheSportsDB

```bash
# Dry run (test without uploading)
npm run upload:dry-run

# Watch browser automation
npm run upload:visible

# Full upload
npm run upload
```

### Download & Upload Track Maps

```bash
# Download all track maps from Formula1.com and upload to TheSportsDB
npm run trackmaps -- --csv 2026.csv

# Download only (no upload)
npm run trackmaps:download -- --csv 2026.csv

# Upload only (use existing maps in track-maps/2026/)
npm run trackmaps:upload -- --csv 2026.csv

# Dry run (test without downloading/uploading)
npm run trackmaps:dry-run -- --csv 2026.csv

# Watch browser automation
npm run trackmaps:visible -- --csv 2026.csv

# Override year manually
node download-upload-trackmaps.js --csv my-races.csv --year 2027
```

## Project Structure

```
formula-1-artwork/
├── thumbnails/
│   ├── template.svg          # Template for thumbnails (1280x720)
│   └── 2026/
│       └── 01-au/            # Organized by round and country code
│           ├── svg/          # Vector source files
│           ├── png/          # PNG exports (1280x720)
│           └── jpg/          # JPG exports (1280x720)
├── posters/
│   ├── template.svg          # Template for posters (680x1000)
│   └── 2026/...
├── banners/
│   ├── template.svg          # Template for banners (1000x185)
│   └── 2026/...
├── track-maps/
│   └── 2026/
│       ├── 00-bh-testing-01/
│       │   ├── track.webp      # Original high-res WebP
│       │   └── track.jpg       # Converted JPG (1280x720)
│       ├── 01-au/
│       │   ├── track.webp
│       │   └── track.jpg
│       └── ...
├── flags/flags/              # Country flag SVGs (circle-flags)
├── tracks/circuits/          # Track layout SVGs (f1-circuits-svg)
├── 2026.csv                  # Race calendar data
└── generate.js               # Generator script
```

## Artwork Generation

The `generate.js` script automatically creates posters, thumbnails, and banners from CSV data.

### Prerequisites

```bash
npm install
```

### CSV Format

The CSV file should contain these columns:

- `ROUND` - Round number (e.g., "01", "02")
- `LOCATION` - Location name (e.g., "Australia", "Saudi Arabia")
- `COUNTRY` - Country code for flag (e.g., "au", "sa")
- `SESSION` - Session type (e.g., "PRACTICE 01", "QUALIFYING", "RACE")
- `TRACKNAME` - Circuit name (e.g., "Albert Park Circuit")
- `TRACKMAP` - Track SVG filename (e.g., "melbourne-2")
- `FULLNAME` - Full race name (e.g., "Formula 1 Rolex Australian Grand Prix 2026")
- `DATE` - Date in YYYY-MM-DD format
- `TESTINGSESSION` - Testing session number or "False"

### Usage

```bash
# Generate all types (posters, thumbnails, banners)
node generate.js --csv 2026.csv

# Generate specific type
node generate.js --csv 2026.csv --type thumbnails
node generate.js --csv 2026.csv --type posters
node generate.js --csv 2026.csv --type banners

# Custom output directory
node generate.js --csv 2026.csv --output ./output
```

### Output Sizes

- **Thumbnails**: 1280x720px
- **Posters**: 680x1000px
- **Banners**: 1000x185px

### Features

- Automatically embeds circuit layouts and country flags
- Auto-scales text to fit bounding boxes
- Handles track rotations for optimal layout
- Generates SVG, PNG, and JPG outputs
- Supports both race weekends and testing sessions

### File Naming Convention

Generated files follow this pattern:

- `day-01`, `day-02`, `day-03` - Testing days
- `practice-01`, `practice-02`, `practice-03` - Practice sessions
- `sprint-qualifying` - Sprint qualifying session
- `sprint` - Sprint session
- `qualifying` - Qualifying session
- `race` - Race day

## TheSportsDB Upload Automation

The `upload-to-sportsdb.js` script automates uploading all generated artwork to TheSportsDB.com.

### Prerequisites

1. **Generated Images**: Run the generate script first
2. **TheSportsDB Account**: You need edit permissions
3. **Credentials**: Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
SPORTSDB_USERNAME=your_username
SPORTSDB_PASSWORD=your_password
```

**Important**: Never commit `.env` to git (already in `.gitignore`).

### Usage

```bash
# Dry run (simulate without uploading)
npm run upload:dry-run

# Visual mode (watch the browser)
npm run upload:visible

# Production upload
npm run upload

# Verbose logging
npm run upload:verbose

# Advanced options
node upload-to-sportsdb.js --start-row=50     # Resume from row 50
node upload-to-sportsdb.js --limit=5          # Upload first 5 events
node upload-to-sportsdb.js --dry-run --limit=3
```

### How It Works

1. Logs in to TheSportsDB using credentials from `.env`
2. Navigates to F1 2026 season page
3. Maps CSV rows to event links in order
4. For each event:
   - Navigates to event page
   - Uploads Poster JPG
   - Uploads Thumb (thumbnail) JPG
   - Uploads Banner JPG
   - Returns to season page
5. Generates summary report

### Progress Tracking

Console output shows real-time progress:

```
🏎️  TheSportsDB F1 2026 Image Upload Automation
================================================

📊 Loaded 126 events from 2026.csv
🔑 Logging in as: your_username
✓ Login successful
📍 Navigating to F1 2026 season page
✓ Found 126 event links on page

[1] Bahrain DAY 01 (2026-02-11)
  📂 Poster:  posters/2026/00-bh-testing-01/jpg/day-01.jpg
  📂 Thumb:   thumbnails/2026/00-bh-testing-01/jpg/day-01.jpg
  📂 Banner:  banners/2026/00-bh-testing-01/jpg/day-01.jpg
  ✅ Complete (6.2s total)
```

### Logging & Debugging

- **Log Files**: `upload-logs/upload-YYYY-MM-DD.log`
- **Error Screenshots**: Saved to `upload-logs/` on failures
- **Verbose Mode**: `npm run upload:verbose` for detailed output

### Performance

- **Per Event**: ~8 seconds (3 uploads + navigation)
- **Full Run**: ~17-20 minutes for 126 events

### Testing Workflow

1. **Dry run first**: `npm run upload:dry-run`
   - Verifies credentials
   - Checks file paths
   - Validates CSV parsing

2. **Visual test**: `node upload-to-sportsdb.js --headless=false --limit=1`
   - Watch browser automation
   - Verify selectors work

3. **Small batch**: `node upload-to-sportsdb.js --limit=5`
   - Upload 5 events
   - Manually verify on TheSportsDB

4. **Full upload**: `npm run upload`

### Resuming Interrupted Uploads

If the upload stops midway:

```bash
node upload-to-sportsdb.js --start-row=50
```

### Troubleshooting

**Missing credentials error**:
- Ensure `.env` file exists with `SPORTSDB_USERNAME` and `SPORTSDB_PASSWORD`

**CSV file not found**:
- Ensure `2026.csv` exists in project root

**Upload form not found**:
- Run with `--headless=false` to see what's happening
- Check `upload-logs/` for screenshots
- May need to update selectors if TheSportsDB changed

**Images not uploading**:
- Check images exist: `ls posters/2026/*/jpg/`
- Verify paths in dry-run mode
- Confirm you have edit permissions on TheSportsDB

## Track Maps Automation

The `download-upload-trackmaps.js` script downloads track map images from Formula1.com and uploads them to TheSportsDB.

### How It Works

**Phase 1: Download**
1. Reads `2026.csv` to identify unique circuits (24 circuits)
2. For each circuit:
   - Navigates to the race page on Formula1.com (e.g., `/en/racing/2026/australia`)
   - Finds the detailed track map image
   - Downloads high-resolution version (h_2000) as WebP
   - Converts to JPG and resizes to 1280x720 (maintaining aspect ratio)
   - Copies both WebP (original) and JPG (converted) to all relevant round-country folders
   - Each circuit is downloaded once, then copied to all sessions using that circuit
   - Example: Bahrain circuit → copied to `00-bh-testing-01`, `00-bh-testing-02`, `04-bh`

**Phase 2: Upload**
1. Logs in to TheSportsDB
2. For each event session (126 sessions):
   - Navigates to the event page
   - Uploads the track map JPG from `track-maps/2026/{round}-{country}/track.jpg`
   - Uses the "Map" upload type (t=22)

### Prerequisites

```bash
# Ensure credentials are set in .env
SPORTSDB_USERNAME=your_username
SPORTSDB_PASSWORD=your_password
```

### Usage

```bash
# Full workflow: download + upload all track maps (uses 2026.csv by default)
npm run trackmaps

# Download only (saves to tracks/2026/)
npm run trackmaps:download

# Upload only (uses existing files)
npm run trackmaps:upload

# Dry run - test without downloading/uploading
npm run trackmaps:dry-run

# Visual mode - watch browser automation
npm run trackmaps:visible

# Advanced options with custom CSV
node download-upload-trackmaps.js --csv 2027.csv
node download-upload-trackmaps.js --csv 2026.csv --download-only --verbose
node download-upload-trackmaps.js --csv 2026.csv --upload-only --start-row=50 --limit=10
node download-upload-trackmaps.js --csv 2026.csv --force-download  # Re-download existing maps

# Override year manually (if CSV filename doesn't contain year)
node download-upload-trackmaps.js --csv my-races.csv --year 2027
```

### Output

Track maps are organized in a folder structure matching the artwork format:
```
track-maps/
  2026/
    00-bh-testing-01/
      track.webp      # Original high-res WebP from F1 site
      track.jpg       # Converted JPG (1280x720)
    00-bh-testing-02/
      track.webp
      track.jpg
    01-au/
      track.webp
      track.jpg
    02-cn/
      track.webp
      track.jpg
    ...
```

Each folder contains:
- **track.webp**: Original high-resolution image from Formula1.com
- **track.jpg**: Converted and resized version (1280x720, uploaded to TheSportsDB)

### Command Line Options

- `--csv <file>`: CSV file to process (year auto-detected from filename, e.g., "2026.csv" → 2026)
- `--year <year>`: Override year (default: extracted from CSV filename)
- `--download-only`: Only download maps, don't upload
- `--upload-only`: Skip download, use existing maps
- `--dry-run`: Test mode, no actual downloads/uploads
- `--headless=false`: Show browser window
- `--verbose`: Detailed logging
- `--start-row=N`: Start uploading from row N
- `--limit=N`: Process only N events
- `--force-download`: Re-download even if files exist

### Performance

- **Download Phase**: ~2-4 seconds per circuit (24 circuits ≈ 1-2 minutes)
- **Upload Phase**: ~3-5 seconds per event (126 events ≈ 6-10 minutes)
- **Total Runtime**: ~10-15 minutes for full workflow

### Logging

- **Log Files**: `upload-logs/trackmaps-YYYY-MM-DD.log`
- **Error Screenshots**: Saved to `upload-logs/` on failures
- **Summary Report**: Shows download/upload statistics

### Testing Workflow

1. **Dry run**: Test without actual operations
   ```bash
   npm run trackmaps:dry-run
   ```

2. **Download test**: Download just a few circuits
   ```bash
   node download-upload-trackmaps.js --download-only --headless=false --verbose
   ```
   Then manually check `track-maps/2026/` folders for WebP + JPG files

3. **Upload test**: Upload to first few events
   ```bash
   node download-upload-trackmaps.js --upload-only --limit=3 --headless=false
   ```

4. **Full run**: Complete workflow
   ```bash
   npm run trackmaps
   ```

### Troubleshooting

**Track map not found on F1 site**:
- Some race pages might not have track maps yet
- Pre-season testing pages may not have maps
- Script automatically uses the Grand Prix page URL when available

**Conversion errors**:
- Ensure Sharp is installed: `npm install sharp`
- Check disk space for image files

**Upload failures**:
- Verify credentials in `.env`
- Check that JPG files exist in `track-maps/2026/{round}-{country}/track.jpg`
- Run with `--headless=false` to see browser actions
- Check `upload-logs/` for error screenshots

## Manual Artwork Creation

If you need to create artwork manually:

1. Use `template.svg` as the base
2. Gather assets:
   - Circuit SVG from [f1-circuits-svg](https://github.com/julesr0y/f1-circuits-svg/tree/main)
   - Round/session info from [formula1.com](https://formula1.com)
   - Country flag from [circle-flags](https://github.com/HatScripts/circle-flags/tree/gh-pages)
   - Track Maps from [formula1.com](https://formula1.com)
3. Customize the template:
   - Round number
   - Country name
   - Session type (Practice, Sprint Qualifying, Sprint, Qualifying, Race)
   - Track name
   - Date and month
4. Export to PNG/JPG for final use

## License

MIT
