#!/usr/bin/env node

/**
 * Formula 1 Artwork Generator
 * Generates posters and thumbnails from CSV data
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const sharp = require('sharp');
const { program } = require('commander');

// Configuration
const THUMBNAIL_TEMPLATE = './thumbnails/template.svg';
const POSTER_TEMPLATE = './posters/template.svg';
const FLAGS_DIR = './flags/flags';
const TRACKS_DIR = './tracks/circuits/white-outline';
const OUTPUT_BASE = './';

// Session filename mapping
const SESSION_FILENAMES = {
  'PRACTICE 01': 'practice-01',
  'PRACTICE 02': 'practice-02',
  'PRACTICE 03': 'practice-03',
  'SPRINT QUALIFYING': 'sprint-qualifying',
  'SPRINT': 'sprint',
  'QUALIFYING': 'qualifying',
  'RACE': 'race',
  'DAY 01': 'day-01',
  'DAY 02': 'day-02',
  'DAY 03': 'day-03'
};

// Track transforms
const TRACK_TRANSFORMS = {
  'melbourne-2': { rotate: -45 }
};

// Parse command line arguments
program
  .name('generate')
  .description('Generate Formula 1 artwork from CSV data')
  .requiredOption('--csv <path>', 'Path to CSV file')
  .option('--type <type>', 'Type of artwork to generate: both, thumbnails, posters', 'both')
  .option('--output <directory>', 'Output directory', OUTPUT_BASE)
  .parse(process.argv);

const options = program.opts();

/**
 * Read and parse CSV file
 */
async function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

/**
 * Replace text in SVG by label
 */
function replaceTextByLabel(svgContent, label, newText) {
  // Find text elements with the specified inkscape:label
  const regex = new RegExp(`(<text[^>]*inkscape:label="${label}"[^>]*>[\\s\\S]*?<tspan[^>]*>)([^<]*)(</tspan>[\\s\\S]*?</text>)`, 'g');
  return svgContent.replace(regex, (match, before, oldText, after) => {
    return before + newText + after;
  });
}

function extractFirstPathD(svgContent) {
  const match = svgContent.match(/<path[^>]*\s[^>]*\sd="([^"]+)"/i);
  return match ? match[1] : null;
}

function samplePathPoints(pathD, sampleCount = 500) {
  const { svgPathProperties } = require('svg-path-properties');
  const props = new svgPathProperties(pathD);
  const length = props.getTotalLength();
  const points = [];

  for (let i = 0; i <= sampleCount; i++) {
    const p = props.getPointAtLength((i / sampleCount) * length);
    points.push({ x: p.x, y: p.y });
  }

  return points;
}

function rotatePoint(x, y, angleRad, cx, cy) {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function getBounds(points) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);

  const strokeWidth = 10;

  return {
    minX: Math.min(...xs) - strokeWidth,
    maxX: Math.max(...xs) + strokeWidth,
    minY: Math.min(...ys) - strokeWidth,
    maxY: Math.max(...ys) + strokeWidth,
    width: Math.max(...xs) - Math.min(...xs) + strokeWidth * 2,
    height: Math.max(...ys) - Math.min(...ys) + strokeWidth * 2,
  };
}

function parseTranslate(transformValue) {
  if (!transformValue) {
    return { x: 0, y: 0 };
  }

  const match = transformValue.match(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/);
  if (!match) {
    return { x: 0, y: 0 };
  }

  return {
    x: parseFloat(match[1]),
    y: match[2] ? parseFloat(match[2]) : 0,
  };
}

function embedTrack(svgContent, trackId) {
  const trackPath = path.join(TRACKS_DIR, `${trackId}.svg`);

  if (!fs.existsSync(trackPath)) {
    console.warn(`  ⚠️  Track SVG not found: ${trackPath}`);
    return svgContent;
  }

  try {
    const trackContent = fs.readFileSync(trackPath, 'utf-8');

    const svgTagMatch = trackContent.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
    if (!svgTagMatch) {
      console.warn(`  ⚠️  Could not parse track SVG: ${trackPath}`);
      return svgContent;
    }

    const [, , trackElements] = svgTagMatch;

    const bboxElementMatch = svgContent.match(/<rect\s[^>]*inkscape:label="track-bounding-box"[^>]*\/>/);
    
    if (!bboxElementMatch) {
      console.warn(`  ⚠️  Track bounding box not found in template`);
      return svgContent;
    }

    const bboxElement = bboxElementMatch[0];

    const bboxWidthMatch = bboxElement.match(/width="([^"]*)"/);
    const bboxHeightMatch = bboxElement.match(/height="([^"]*)"/);
    const bboxXMatch = bboxElement.match(/x="([^"]*)"/);
    const bboxYMatch = bboxElement.match(/y="([^"]*)"/);

    if (!bboxWidthMatch || !bboxHeightMatch || !bboxXMatch || !bboxYMatch) {
      console.warn(`  ⚠️  Could not extract bounding box dimensions`);
      return svgContent;
    }

    const bboxWidth = parseFloat(bboxWidthMatch[1]);
    const bboxHeight = parseFloat(bboxHeightMatch[1]);
    const bboxX = parseFloat(bboxXMatch[1]);
    const bboxY = parseFloat(bboxYMatch[1]);

    const bboxTransformMatch = bboxElement.match(/transform="([^"]*)"/);
    const bboxTranslate = parseTranslate(bboxTransformMatch ? bboxTransformMatch[1] : '');

    const actualBboxX = bboxX + bboxTranslate.x;
    const actualBboxY = bboxY + bboxTranslate.y;

    const pathD = extractFirstPathD(trackContent);
    if (!pathD) {
      console.warn(`  ⚠️  Could not find path data in track SVG: ${trackPath}`);
      return svgContent;
    }

    const points = samplePathPoints(pathD, 600);
    const sourceBounds = getBounds(points);

    const sourceCenterX = (sourceBounds.minX + sourceBounds.maxX) / 2;
    const sourceCenterY = (sourceBounds.minY + sourceBounds.maxY) / 2;

    const transformConfig = TRACK_TRANSFORMS[trackId] || {};
    const rotateDeg = transformConfig.rotate || 0;
    const angleRad = rotateDeg * Math.PI / 180;

    const rotatedPoints = points.map(p =>
      rotatePoint(p.x, p.y, angleRad, sourceCenterX, sourceCenterY)
    );

    const rotatedBounds = getBounds(rotatedPoints);

    const scaleX = bboxWidth / rotatedBounds.width;
    const scaleY = bboxHeight / rotatedBounds.height;
    const scale = Math.min(scaleX, scaleY) * 0.98; // Add some padding

    const offsetX = actualBboxX + ((bboxWidth - rotatedBounds.width * scale) / 2) - (rotatedBounds.minX * scale);
    const offsetY = actualBboxY + ((bboxHeight - rotatedBounds.height * scale) / 2) - (rotatedBounds.minY * scale);

    const embeddedTrack = `
      <g
        inkscape:label="embedded-track"
        transform="
          translate(${offsetX}, ${offsetY})
          scale(${scale})
          rotate(${rotateDeg}, ${sourceCenterX}, ${sourceCenterY})
        "
      >
        ${trackElements}
      </g>
    `.replace(/\s+/g, ' ').trim();

    return svgContent.replace(bboxElement, embeddedTrack);

  } catch (error) {
    console.error(`  ✗ Error embedding track: ${error.message}`);
    return svgContent;
  }
}

/**
 * Embed flag SVG into template
 */
function embedFlag(svgContent, countryId) {
  const flagPath = path.join(FLAGS_DIR, `${countryId}.svg`);
  
  if (!fs.existsSync(flagPath)) {
    console.warn(`  ⚠️  Flag SVG not found: ${flagPath}`);
    return svgContent;
  }

  try {
    const flagContent = fs.readFileSync(flagPath, 'utf-8');
    
    // Circle-flags are complete SVG files with circular masks already applied
    // We just need to extract the content and position it properly
    
    // Get the flag bounding circle dimensions
    const circleElementMatch = svgContent.match(/<circle\s[^>]*inkscape:label="flag-bounding-box"[^>]*\/>/);
    
    if (!circleElementMatch) {
      console.warn(`  ⚠️  Flag bounding box not found in template`);
      return svgContent;
    }

    const circleElement = circleElementMatch[0];
    
    // Extract circle attributes
    const cxMatch = circleElement.match(/cx="([^"]*)"/);
    const cyMatch = circleElement.match(/cy="([^"]*)"/);
    const rMatch = circleElement.match(/r="([^"]*)"/);
    
    if (!cxMatch || !cyMatch || !rMatch) {
      console.warn(`  ⚠️  Could not extract circle dimensions from flag bounding box`);
      return svgContent;
    }

    const cx = parseFloat(cxMatch[1]);
    const cy = parseFloat(cyMatch[1]);
    const r = parseFloat(rMatch[1]);

    // Extract the flag SVG content (everything inside the svg tag)
    const flagSvgMatch = flagContent.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
    if (!flagSvgMatch) {
      console.warn(`  ⚠️  Could not parse flag SVG: ${flagPath}`);
      return svgContent;
    }

    const flagElements = flagSvgMatch[1];
    
    // Calculate positioning to center the flag in the circle
    const flagSize = r * 2;
    const x = cx - r;
    const y = cy - r;

    // Create a group with the flag content, scaled and positioned to fit the circle
    const embeddedFlag = `<g transform="translate(${x}, ${y}) scale(${flagSize / 512})" inkscape:label="flag">${flagElements}</g>`;

    // replace the flag-bounding-box element with the embedded flag
    const flagBoundingBoxRegex = /<circle\s[^>]*inkscape:label="flag-bounding-box"[^>]*\/>/;
    return svgContent.replace(flagBoundingBoxRegex, embeddedFlag);

  } catch (error) {
    console.error(`  ✗ Error embedding flag: ${error.message}`);
    return svgContent;
  }
}

/**
 * Generate artwork from template
 */
async function generateArtwork(templatePath, data, type) {
  try {
    let svgContent = fs.readFileSync(templatePath, 'utf-8');

    const [year, month, day] = data.DATE.split('-');

    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const monthIndex = parseInt(month, 10) - 1;
    const monthName = monthNames[monthIndex] || month;

    // Replace text content
    svgContent = replaceTextByLabel(svgContent, 'round', `ROUND ${data.ROUND}`);
    svgContent = replaceTextByLabel(svgContent, 'location', data.LOCATION.toUpperCase());
    svgContent = replaceTextByLabel(svgContent, 'session', data.SESSION.toUpperCase());
    svgContent = replaceTextByLabel(svgContent, 'track-name', data.TRACKNAME);
    svgContent = replaceTextByLabel(svgContent, 'day', day);
    svgContent = replaceTextByLabel(svgContent, 'month', monthName);
    svgContent = replaceTextByLabel(svgContent, 'year', year);

    // Embed track SVG
    svgContent = embedTrack(svgContent, data.TRACKMAP);

    // Embed flag SVG
    svgContent = embedFlag(svgContent, data.COUNTRY);

    // Generate output path
    const sessionFilename = SESSION_FILENAMES[data.SESSION.toUpperCase()] || data.SESSION.toLowerCase().replace(/\s+/g, '-');
    const locationSlug = data.COUNTRY;
    const outputDir = path.join(options.output, type, year, `${data.ROUND}-${locationSlug}`);
    
    // Create directories
    const svgDir = path.join(outputDir, 'svg');
    const pngDir = path.join(outputDir, 'png');
    const jpgDir = path.join(outputDir, 'jpg');
    
    [svgDir, pngDir, jpgDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Save SVG
    const svgPath = path.join(svgDir, `${sessionFilename}.svg`);
    fs.writeFileSync(svgPath, svgContent);
    console.log(`  ✓ Generated SVG: ${svgPath}`);

    // Generate PNG
    try {
      const pngPath = path.join(pngDir, `${sessionFilename}.png`);
      await sharp(Buffer.from(svgContent))
        .png()
        .toFile(pngPath);
      console.log(`  ✓ Generated PNG: ${pngPath}`);
    } catch (error) {
      console.warn(`  ⚠️  PNG generation failed: ${error.message}`);
    }

    // Generate JPG
    try {
      const jpgPath = path.join(jpgDir, `${sessionFilename}.jpg`);
      await sharp(Buffer.from(svgContent))
        .jpeg({ quality: 90 })
        .toFile(jpgPath);
      console.log(`  ✓ Generated JPG: ${jpgPath}`);
    } catch (error) {
      console.warn(`  ⚠️  JPG generation failed: ${error.message}`);
    }

    return true;
  } catch (error) {
    console.error(`  ✗ Error generating artwork: ${error.message}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🏁 Formula 1 Artwork Generator\n');
  console.log(`📄 Reading CSV: ${options.csv}`);
  console.log(`🎨 Generation type: ${options.type}\n`);

  try {
    const rows = await readCSV(options.csv);
    console.log(`✓ Found ${rows.length} entries\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      console.log(`📝 Processing: Round ${row.ROUND} - ${row.LOCATION} - ${row.SESSION}`);

      try {
        if (options.type === 'both' || options.type === 'thumbnails') {
          const success = await generateArtwork(THUMBNAIL_TEMPLATE, row, 'thumbnails');
          if (success) successCount++;
          else errorCount++;
        }

        if (options.type === 'both' || options.type === 'posters') {
          const success = await generateArtwork(POSTER_TEMPLATE, row, 'posters');
          if (success) successCount++;
          else errorCount++;
        }
      } catch (error) {
        console.error(`✗ Error processing row:`, error.message);
        errorCount++;
      }

      console.log('');
    }

    console.log(`\n✨ Generation complete!`);
    console.log(`   ✓ Success: ${successCount}`);
    if (errorCount > 0) {
      console.log(`   ✗ Errors: ${errorCount}`);
    }

  } catch (error) {
    console.error('✗ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the generator
main().catch(console.error);
