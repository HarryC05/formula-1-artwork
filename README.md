# Formula 1 Artwork

Custom artwork and thumbnails for Formula 1 race weekends.

## Structure

```
thumbnails/
├── template.svg          # Base template for all thumbnails
└── 2026/
    └── 01-australia/     # Organized by round and location
        ├── svg/          # Vector source files
        ├── png/          # PNG exports
        └── jpg/          # JPG exports
```

## Creating New Artwork

1. Use `template.svg` as the base
2. Gather assets:
   - Circuit SVG from [f1-circuits-svg](https://github.com/julesr0y/f1-circuits-svg/tree/main)
   - Round/session info from [formula1.com](https://formula1.com)
   - Country flag from Wikipedia
3. Customize the template:
   - Round number
   - Country name
   - Session type (Practice, Sprint Qualifying, Sprint, Qualifying, Race)
   - Track name
   - Date and month
4. Export to PNG/JPG for final use

## File Naming

- `practice-01.svg`, `practice-02.svg`, `practice-03.svg` - Practice sessions
- `sprint-qualifying.svg` - Sprint qualifying session
- `sprint.svg` - Sprint session
- `qualifying.svg` - Qualifying session
- `race.svg` - Race day
