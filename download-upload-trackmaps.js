#!/usr/bin/env node

/**
 * F1 Track Map Download & Upload Automation
 * Downloads track maps from Formula1.com and uploads them to TheSportsDB.com
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const https = require('https');
const sharp = require('sharp');
const readline = require('readline');
require('dotenv').config();

// Parse command line arguments first (needed for dynamic constants)
const args = process.argv.slice(2);

// Helper function to get argument value
function getArgValue(argName) {
  const equalFormat = args.find(arg => arg.startsWith(`${argName}=`));
  if (equalFormat) {
    return equalFormat.split('=')[1];
  }
  
  const argIndex = args.indexOf(argName);
  if (argIndex !== -1 && argIndex + 1 < args.length) {
    return args[argIndex + 1];
  }
  
  return null;
}

// Get CSV file and extract year
const csvFile = getArgValue('--csv') || '2026.csv';
const csvBasename = path.basename(csvFile, '.csv');
const yearFromFile = csvBasename.match(/\d{4}/)?.[0] || '2026';
const year = getArgValue('--year') || yearFromFile;

// Constants (now using dynamic year)
const BASE_URL = 'https://www.thesportsdb.com';
const SEASON_URL = `${BASE_URL}/season/4370-formula-1/${year}&all=1&view=0`;
const F1_BASE_URL = 'https://www.formula1.com';
const TRACKS_DIR = path.join(__dirname, 'track-maps', year);

const config = {
  username: process.env.SPORTSDB_USERNAME,
  password: process.env.SPORTSDB_PASSWORD,
  csvFile: csvFile,
  year: year,
  headless: !args.includes('--headless=false') && !args.includes('--headless') || args.includes('--headless=true'),
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  downloadOnly: args.includes('--download-only'),
  uploadOnly: args.includes('--upload-only'),
  forceDownload: args.includes('--force-download'),
  screenshotOnError: true,
  uploadDelay: 1500, // ms between uploads
  downloadDelay: 2000, // ms between downloads (F1 site rate limiting)
  startRow: parseInt(getArgValue('--start-row')) || 0,
  limit: parseInt(getArgValue('--limit')) || Infinity,
};

// Logging utilities
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  let prefix = '';
  
  switch (level) {
    case 'error':
      prefix = `${colors.red}❌${colors.reset}`;
      break;
    case 'warn':
      prefix = `${colors.yellow}⚠️${colors.reset}`;
      break;
    case 'success':
      prefix = `${colors.green}✓${colors.reset}`;
      break;
    case 'info':
    default:
      prefix = '';
  }
  
  console.log(`${prefix} ${message}`);
  
  // Also write to log file
  if (!fs.existsSync('upload-logs')) {
    fs.mkdirSync('upload-logs', { recursive: true });
  }
  
  const logFile = path.join('upload-logs', `trackmaps-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, `[${timestamp}] [${level.toUpperCase()}] ${message}\n`);
}

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
 * Map location to F1 URL slug
 */
function getF1RaceUrl(location, testingSession) {
  // Handle testing sessions
  if (testingSession !== 'False') {
    // Convert "01" to "1", "02" to "2"
    const testingNumber = parseInt(testingSession, 10);
    return `/en/racing/${year}/pre-season-testing-${testingNumber}`;
  }
  
  // Handle special cases
  const locationMap = {
    'Abu Dhabi': 'united-arab-emirates',
    'Saudi Arabia': 'saudi-arabia',
    'United States': 'united-states',
    'Las Vegas': 'las-vegas',
    'Barcelona-Catalunya': 'barcelona-catalunya',
    'Great Britain': 'great-britain',
  };
  
  const slug = locationMap[location] || location.toLowerCase().replace(/\s+/g, '-');
  return `/en/racing/${year}/${slug}`;
}

/**
 * Build circuit map from CSV (unique circuits only)
 */
function buildCircuitMap(rows) {
  const circuitMap = new Map();
  
  rows.forEach((row, index) => {
    const trackmap = row.TRACKMAP;
    const round = row.ROUND.padStart(2, '0');
    const country = row.COUNTRY;
    
    // Create folder name: for testing sessions use "testing-{number}", otherwise just round-country
    let folderName;
    if (row.TESTINGSESSION !== 'False') {
      const testingNo = row.TESTINGSESSION.padStart(2, '0');
      folderName = `${round}-${country}-testing-${testingNo}`;
    } else {
      folderName = `${round}-${country}`;
    }
    
    if (!circuitMap.has(trackmap)) {
      circuitMap.set(trackmap, {
        trackmap,
        location: row.LOCATION,
        trackName: row.TRACKNAME,
        round: row.ROUND,
        country: row.COUNTRY,
        testingSession: row.TESTINGSESSION,
        url: getF1RaceUrl(row.LOCATION, row.TESTINGSESSION),
        folders: [folderName], // Track all round-country folders for this circuit
        sessions: [],
        downloaded: false,
      });
    } else {
      // If we already have this circuit but current row is NOT a testing session
      // prefer the non-testing URL (as testing pages often don't have track maps)
      const existing = circuitMap.get(trackmap);
      if (existing.testingSession !== 'False' && row.TESTINGSESSION === 'False') {
        existing.location = row.LOCATION;
        existing.testingSession = row.TESTINGSESSION;
        existing.url = getF1RaceUrl(row.LOCATION, row.TESTINGSESSION);
      }
      
      // Add folder if not already tracked
      if (!existing.folders.includes(folderName)) {
        existing.folders.push(folderName);
      }
    }
    
    // Add session index to this circuit
    circuitMap.get(trackmap).sessions.push(index);
  });
  
  return circuitMap;
}

/**
 * Download a file from URL to filepath
 */
function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirect
        file.close();
        fs.unlinkSync(filepath);
        downloadFile(response.headers.location, filepath).then(resolve).catch(reject);
      } else {
        file.close();
        fs.unlinkSync(filepath);
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
      }
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(filepath);
      reject(err);
    });
  });
}

/**
 * Find and extract track map image URL from F1 race page
 */
async function findTrackMapUrl(page, raceName) {
  try {
    // Wait for page to load
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    
    // Strategy 1: Look for img with src containing 'track' and 'detailed'
    const trackImages = await page.$$eval('img', imgs => 
      imgs
        .map(img => ({
          src: img.src,
          alt: img.alt || '',
          className: img.className || ''
        }))
        .filter(img => {
          const src = img.src.toLowerCase();
          const alt = img.alt.toLowerCase();
          return (src.includes('track') || src.includes('circuit')) && 
                 (src.includes('detailed') || src.includes('2026'));
        })
    );
    
    if (config.verbose) {
      log(`  🔍 Found ${trackImages.length} potential track map images`);
      trackImages.forEach(img => log(`     - ${img.src}`));
    }
    
    if (trackImages.length > 0) {
      // Get the first match and try to get high resolution
      let imageUrl = trackImages[0].src;
      
      // Modify URL to get higher resolution if it's a Cloudinary URL
      // Example: c_fit,h_704 -> c_fit,h_2000
      imageUrl = imageUrl.replace(/\/c_fit,h_\d+\//, '/c_fit,h_2000/');
      imageUrl = imageUrl.replace(/\/c_lfill,w_\d+\//, '/c_lfill,w_2000/');
      
      return imageUrl;
    }
    
    // Strategy 2: Look for any image in a track-related container
    const containerImages = await page.$$eval('img', imgs =>
      imgs
        .map(img => img.src)
        .filter(src => {
          const srcLower = src.toLowerCase();
          return srcLower.includes('track') || srcLower.includes('circuit');
        })
    );
    
    if (containerImages.length > 0) {
      return containerImages[0];
    }
    
    throw new Error('Track map image not found on page');
    
  } catch (error) {
    throw new Error(`Failed to find track map: ${error.message}`);
  }
}

/**
 * Download track map from F1 website
 */
async function downloadTrackMap(page, circuit) {
  const tempWebpPath = path.join(TRACKS_DIR, `temp-${circuit.trackmap}.webp`);
  const tempJpgPath = path.join(TRACKS_DIR, `temp-${circuit.trackmap}.jpg`);
  
  // Check if any of the target folders already have the map (skip if not forcing)
  if (!config.forceDownload) {
    const existingFolder = circuit.folders.find(folder => {
      const jpgPath = path.join(TRACKS_DIR, folder, 'track.jpg');
      return fs.existsSync(jpgPath);
    });
    
    if (existingFolder) {
      log(`  ⏭️  Already exists in: ${existingFolder}/track.jpg`, 'info');
      return { success: true, skipped: true };
    }
  }
  
  if (config.dryRun) {
    log(`  🔍 [DRY RUN] Would download from: ${circuit.url}`, 'info');
    log(`  🔍 [DRY RUN] Would save to folders: ${circuit.folders.join(', ')}`);
    return { success: true, dryRun: true };
  }
  
  const startTime = Date.now();
  
  try {
    // Navigate to F1 race page
    const fullUrl = `${F1_BASE_URL}${circuit.url}`;
    if (config.verbose) log(`  🌐 Navigating to: ${fullUrl}`);
    
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Find track map image URL
    const imageUrl = await findTrackMapUrl(page, circuit.location);
    
    if (config.verbose) log(`  📷 Found image: ${imageUrl}`);
    
    // Download the webp image to temp location
    log(`  📥 Downloading...`);
    await downloadFile(imageUrl, tempWebpPath);
    
    // Convert webp to jpg and resize to 1280x720
    log(`  🔄 Converting to JPG and resizing to 1280x720...`);
    await sharp(tempWebpPath)
      .resize(1280, 720, {
        fit: 'inside',  // Maintain aspect ratio, fit within 1280x720
        withoutEnlargement: false
      })
      .jpeg({ quality: 95 })
      .toFile(tempJpgPath);
    
    // Copy to all relevant round-country folders (both webp and jpg)
    log(`  📁 Copying to ${circuit.folders.length} folder(s)...`);
    for (const folder of circuit.folders) {
      const folderPath = path.join(TRACKS_DIR, folder);
      const webpDestPath = path.join(folderPath, 'track.webp');
      const jpgDestPath = path.join(folderPath, 'track.jpg');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
      
      // Copy both files
      fs.copyFileSync(tempWebpPath, webpDestPath);
      fs.copyFileSync(tempJpgPath, jpgDestPath);
      if (config.verbose) log(`     → ${folder}/track.webp & track.jpg`);
    }
    
    // Clean up temp files
    fs.unlinkSync(tempWebpPath);
    fs.unlinkSync(tempJpgPath);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  ✓ Downloaded and saved to ${circuit.folders.length} folder(s) (${duration}s)`, 'success');
    
    return { success: true, duration: parseFloat(duration), imageUrl, folders: circuit.folders };
    
  } catch (error) {
    log(`  ❌ Download failed for ${circuit.trackmap}: ${error.message}`, 'error');
    
    // Clean up temp files on error
    if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
    if (fs.existsSync(tempJpgPath)) fs.unlinkSync(tempJpgPath);
    
    if (config.screenshotOnError) {
      const screenshotPath = path.join('upload-logs', `error-download-${circuit.trackmap}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      log(`  📸 Screenshot saved: ${screenshotPath}`);
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Download all track maps
 */
async function downloadAllTrackMaps(browser, circuitMap) {
  log('\n' + '='.repeat(80));
  log('📥 PHASE 1: DOWNLOADING TRACK MAPS FROM FORMULA1.COM');
  log('='.repeat(80) + '\n');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const circuits = Array.from(circuitMap.values());
  const results = [];
  
  for (let i = 0; i < circuits.length; i++) {
    const circuit = circuits[i];
    log(`[${i + 1}/${circuits.length}] ${circuit.location} (${circuit.trackmap})`);
    
    const result = await downloadTrackMap(page, circuit);
    results.push({ circuit, result });
    
    if (result.success) {
      circuit.downloaded = true;
    }
    
    // Add delay to avoid rate limiting
    if (i < circuits.length - 1 && !result.skipped) {
      await page.waitForTimeout(config.downloadDelay);
    }
  }
  
  await context.close();
  
  return results;
}

/**
 * Login to TheSportsDB
 */
async function login(page) {
  try {
    await page.goto(`${BASE_URL}/user_login.php`, { waitUntil: 'networkidle' });
    
    await page.fill('input[name="username"]', config.username);
    await page.fill('input[name="password"]', config.password);
    await page.click('input[type="submit"]');
    
    await page.waitForLoadState('networkidle');
    
    const currentUrl = page.url();
    if (currentUrl.includes('user_login.php')) {
      const errorText = await page.textContent('body').catch(() => '');
      if (errorText.toLowerCase().includes('incorrect') || errorText.toLowerCase().includes('invalid')) {
        throw new Error('Login failed: Invalid credentials');
      }
    }
    
    log('Login successful', 'success');
    return true;
  } catch (error) {
    log(`Login failed: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Get all event links from season page
 */
async function getEventLinks(page) {
  const links = await page.$$eval('a[href^="/event/"]', elements => 
    elements.map(el => el.getAttribute('href'))
  );
  return links;
}

/**
 * Prompt user for confirmation
 */
function promptUser(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

/**
 * Check if track map already exists on the page
 */
async function checkTrackMapExists(page) {
  try {
    // Check if an image with alt text "Map Thumb" exists
    const existingImage = await page.locator('img[alt="Map Thumb"]').first();
    const count = await existingImage.count();
    
    if (count > 0) {
      // Additional check: make sure it's not a placeholder or broken image
      const src = await existingImage.getAttribute('src').catch(() => null);
      if (src && !src.includes('placeholder') && !src.includes('default')) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    if (config.verbose) log(`  🔍 Error checking if map exists: ${error.message}`);
    return false;
  }
}

/**
 * Upload track map to TheSportsDB event
 */
async function uploadTrackMap(page, trackMapPath, eventName, eventUrl) {
  const imageTypeLabel = 'Map';
  const imageTypeId = '22';
  
  // Check if map already exists
  const mapExists = await checkTrackMapExists(page);
  if (mapExists) {
    log(`  ⚠️  Map already exists!`, 'warn');
    
    // Prompt user for confirmation
    const answer = await promptUser(`  Do you want to override the existing Map? (y/N): `);
    
    if (answer !== 'y' && answer !== 'yes') {
      log(`  ⏭️  Skipping Map`, 'info');
      return { success: true, skipped: true };
    }
    
    log(`  🔄 Overriding existing Map...`, 'info');
  }
  
  // Check if file exists
  if (!fs.existsSync(trackMapPath)) {
    log(`  ⚠️  Track map not found: ${trackMapPath}`, 'warn');
    return { success: false, reason: 'file_not_found' };
  }
  
  if (config.dryRun) {
    log(`  🔍 [DRY RUN] Would upload Map: ${trackMapPath}`);
    return { success: true, dryRun: true };
  }
  
  const startTime = Date.now();
  
  try {
    // Debug: Check what's on the page
    if (config.verbose) {
      const htmlContent = await page.content();
      const allUploadLinks = htmlContent.match(/upload_art\.php[^"']*/gi);
      if (allUploadLinks) {
        log(`  🔗 Found ${allUploadLinks.length} upload_art.php links`);
        if (config.verbose) {
          allUploadLinks.forEach(link => log(`     - ${link}`));
        }
      }
    }
    
    let editClicked = false;
    
    // Strategy 1: Find <b> tag with "Map" text, then find sibling <a> with upload_art.php
    try {
      const editLink = page.locator(`//b[text()="${imageTypeLabel}"]/following-sibling::a[contains(@href, "upload_art.php")][1]`);
      const count = await editLink.count();
      
      if (count > 0) {
        await editLink.first().click({ timeout: 5000 });
        editClicked = true;
        if (config.verbose) log(`  📝 Clicked edit link for ${imageTypeLabel} (sibling after <b> tag)`);
      }
    } catch (e) {
      if (config.verbose) log(`  ⚠️  Strategy 1 failed: ${e.message}`);
    }
    
    // Strategy 2: Find <b> containing "Map", then find <a> inside it
    if (!editClicked) {
      try {
        const editLink = page.locator(`//b[contains(text(), "${imageTypeLabel}")]/a[contains(@href, "upload_art.php")]`);
        const count = await editLink.count();
        
        if (count > 0) {
          await editLink.first().click({ timeout: 5000 });
          editClicked = true;
          if (config.verbose) log(`  📝 Clicked edit link for ${imageTypeLabel} (inside <b> tag)`);
        }
      } catch (e) {
        if (config.verbose) log(`  ⚠️  Strategy 2 failed: ${e.message}`);
      }
    }
    
    // Strategy 3: Use the type ID parameter (t=22)
    if (!editClicked && imageTypeId) {
      try {
        const editLink = page.locator(`a[href*="upload_art.php?t=${imageTypeId}"]`).first();
        const count = await editLink.count();
        
        if (count > 0) {
          await editLink.click({ timeout: 5000 });
          editClicked = true;
          if (config.verbose) log(`  📝 Clicked edit link for ${imageTypeLabel} (by type ID t=${imageTypeId})`);
        }
      } catch (e) {
        if (config.verbose) log(`  ⚠️  Strategy 3 failed: ${e.message}`);
      }
    }
    
    if (!editClicked) {
      // Save HTML for debugging
      const htmlContent = await page.content();
      const htmlFilePath = `upload-logs/page-html-${eventName.replace(/[^a-z0-9]/gi, '-')}-Map-${Date.now()}.html`;
      fs.writeFileSync(htmlFilePath, htmlContent);
      log(`  💾 Full HTML saved to: ${htmlFilePath}`);
      
      throw new Error(`Could not find edit link for ${imageTypeLabel}`);
    }
    
    // Wait for upload form to load
    await page.waitForLoadState('networkidle');
    
    // Upload file
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.resolve(trackMapPath));
    
    if (config.verbose) log(`  📤 File selected: ${path.basename(trackMapPath)}`);
    
    // Submit form
    const submitButton = await page.locator('input[type="submit"], button:has-text("Submit")').first();
    await submitButton.click();
    
    // Wait for upload to complete
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Return to event page
    try {
      const returnLink = await page.locator('a:has-text("Return to event"), a:has-text("return to event"), a:has-text("Back to event")').first();
      const linkCount = await returnLink.count();
      
      if (linkCount > 0) {
        await returnLink.click({ timeout: 5000 });
        await page.waitForLoadState('networkidle');
        if (config.verbose) log(`  ↩️  Returned to event page`);
      } else {
        if (config.verbose) log(`  ℹ️  Return link not found, going back`);
        await page.goBack({ waitUntil: 'networkidle' });
      }
    } catch (e) {
      if (config.verbose) log(`  ⚠️  Error returning: ${e.message}, attempting goBack`);
      await page.goBack({ waitUntil: 'networkidle', timeout: 10000 });
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  📤 Map uploaded ✓ (${duration}s)`, 'success');
    
    return { success: true, duration: parseFloat(duration) };
    
  } catch (error) {
    if (config.screenshotOnError) {
      const screenshotPath = path.join('upload-logs', `error-upload-${eventName.replace(/\s+/g, '-')}-Map-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      log(`  📸 Screenshot saved: ${screenshotPath}`);
    }
    
    log(`  ❌ Map upload failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

/**
 * Upload track maps to all events
 */
async function uploadAllTrackMaps(browser, rows, circuitMap) {
  log('\n' + '='.repeat(80));
  log('📤 PHASE 2: UPLOADING TRACK MAPS TO THESPORTSDB');
  log('='.repeat(80) + '\n');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Login
    log(`🔑 Logging in as: ${config.username}`);
    await login(page);
    
    // Navigate to season page
    log(`📍 Navigating to F1 2026 season page`);
    await page.goto(SEASON_URL, { waitUntil: 'networkidle' });
    
    // Get all event links
    const eventLinks = await getEventLinks(page);
    log(`✓ Found ${eventLinks.length} event links\n`, 'success');
    
    if (eventLinks.length !== rows.length) {
      log(`⚠️  Warning: CSV has ${rows.length} rows but page has ${eventLinks.length} events`, 'warn');
    }
    
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Process each event
    const results = [];
    const endRow = Math.min(config.startRow + config.limit, rows.length);
    
    for (let i = config.startRow; i < endRow; i++) {
      const row = rows[i];
      const eventLink = eventLinks[i];
      const eventName = `${row.LOCATION} ${row.SESSION}`;
      const trackmap = row.TRACKMAP;
      
      log(`[${i + 1}/${rows.length}] ${eventName} (${row.DATE})`);
      log(`  🗺️  Track: ${trackmap}`);
      
      // Build folder path for this event
      const round = row.ROUND.padStart(2, '0');
      const country = row.COUNTRY;
      let folderName;
      if (row.TESTINGSESSION !== 'False') {
        const testingNo = row.TESTINGSESSION.padStart(2, '0');
        folderName = `${round}-${country}-testing-${testingNo}`;
      } else {
        folderName = `${round}-${country}`;
      }
      
      // Get track map file path from folder structure
      const trackMapPath = path.join(TRACKS_DIR, folderName, 'track.jpg');
      
      // Navigate to event page
      const eventUrl = `${BASE_URL}${eventLink}`;
      try {
        await page.goto(eventUrl, { waitUntil: 'networkidle' });
        log(`  🔗 On event page`);
      } catch (error) {
        log(`  ❌ Failed to navigate: ${error.message}`, 'error');
        results.push({ success: false, error: 'navigation_failed' });
        continue;
      }
      
      // Upload track map
      const result = await uploadTrackMap(page, trackMapPath, eventName, eventUrl);
      results.push(result);
      
      // Ensure we're back on event page before continuing
      const currentUrl = page.url();
      if (!currentUrl.includes('/event/')) {
        if (config.verbose) log(`  ↩️  Navigating back to event page`);
        await page.goto(eventUrl, { waitUntil: 'networkidle' });
      }
      
      // Add delay before next upload
      if (i < endRow - 1) {
        await page.waitForTimeout(config.uploadDelay);
      }
    }
    
    await context.close();
    return results;
    
  } catch (error) {
    await context.close();
    throw error;
  }
}

/**
 * Generate summary report
 */
function generateReport(downloadResults, uploadResults, circuitMap) {
  console.log('\n' + '━'.repeat(80));
  console.log('📊 SUMMARY REPORT');
  console.log('━'.repeat(80));
  
  if (downloadResults && !config.uploadOnly) {
    console.log('\n📥 Download Phase:');
    const totalCircuits = downloadResults.length;
    const downloaded = downloadResults.filter(r => r.result.success && !r.result.skipped).length;
    const skipped = downloadResults.filter(r => r.result.skipped).length;
    const failed = downloadResults.filter(r => !r.result.success).length;
    
    if (config.dryRun) {
      console.log(`${colors.cyan}🔍 DRY RUN MODE${colors.reset}`);
    }
    console.log(`   Total circuits:    ${totalCircuits}`);
    console.log(`   ✅ Downloaded:      ${downloaded}`);
    console.log(`   ⏭️  Skipped:         ${skipped}`);
    if (failed > 0) {
      console.log(`   ❌ Failed:          ${failed}`);
    }
  }
  
  if (uploadResults && !config.downloadOnly) {
    console.log('\n📤 Upload Phase:');
    const totalEvents = uploadResults.length;
    const successful = uploadResults.filter(r => r.success && !r.dryRun).length;
    const failed = uploadResults.filter(r => !r.success).length;
    
    if (config.dryRun) {
      console.log(`${colors.cyan}🔍 DRY RUN MODE${colors.reset}`);
    }
    console.log(`   Total events:      ${totalEvents}`);
    console.log(`   ✅ Uploaded:        ${successful}`);
    if (failed > 0) {
      console.log(`   ❌ Failed:          ${failed}`);
    }
    
    const totalTime = uploadResults.reduce((sum, r) => sum + (r.duration || 0), 0);
    const minutes = Math.floor(totalTime / 60);
    const seconds = Math.floor(totalTime % 60);
    console.log(`   ⏱️  Total time:      ${minutes}m ${seconds}s`);
  }
  
  console.log('\n━'.repeat(80));
  
  const logFile = path.join('upload-logs', `trackmaps-${new Date().toISOString().split('T')[0]}.log`);
  console.log(`📝 Detailed log saved to: ${logFile}`);
  
  if (config.screenshotOnError && !config.dryRun) {
    console.log(`📸 Error screenshots saved to: upload-logs/`);
  }
  
  console.log('');
}

/**
 * Main function
 */
async function main() {
  console.log(`${colors.bright}🏎️  F1 Track Map Download & Upload Automation${colors.reset}`);
  console.log('='.repeat(80) + '\n');
  
  // Validate modes
  if (config.downloadOnly && config.uploadOnly) {
    console.error(`${colors.red}❌ Cannot use both --download-only and --upload-only${colors.reset}`);
    process.exit(1);
  }
  
  // Validate credentials for upload
  if (!config.uploadOnly && !config.downloadOnly && (!config.username || !config.password)) {
    console.error(`${colors.red}❌ Missing credentials${colors.reset}`);
    console.error('Please set SPORTSDB_USERNAME and SPORTSDB_PASSWORD in .env file\n');
    process.exit(1);
  }
  
  // Read CSV
  const csvPath = config.csvFile;
  if (!fs.existsSync(csvPath)) {
    console.error(`${colors.red}❌ CSV file not found: ${csvPath}${colors.reset}`);
    console.error(`\nUsage: node download-upload-trackmaps.js --csv <file.csv>`);
    console.error(`Example: node download-upload-trackmaps.js --csv 2026.csv\n`);
    process.exit(1);
  }
  
  const rows = await readCSV(csvPath);
  log(`📊 Loaded ${rows.length} events from ${path.basename(csvPath)}`);
  log(`📅 Using year: ${config.year}`);
  
  // Build circuit map
  const circuitMap = buildCircuitMap(rows);
  log(`🗺️  Found ${circuitMap.size} unique circuits`);
  
  if (config.dryRun) {
    log(`🔍 Running in DRY RUN mode - no files will be downloaded/uploaded`, 'info');
  }
  
  if (config.downloadOnly) {
    log(`📥 Download-only mode`, 'info');
  }
  
  if (config.uploadOnly) {
    log(`📤 Upload-only mode`, 'info');
  }
  
  if (config.startRow > 0) {
    log(`⏭️  Starting from row ${config.startRow + 1}`, 'info');
  }
  
  if (config.limit < Infinity) {
    log(`🔢 Limiting to ${config.limit} events`, 'info');
  }
  
  // Create tracks directory if it doesn't exist
  if (!fs.existsSync(TRACKS_DIR)) {
    fs.mkdirSync(TRACKS_DIR, { recursive: true });
    log(`📁 Created directory: ${TRACKS_DIR}`);
  }
  
  // Launch browser
  log(`🌐 Launching browser (headless: ${config.headless})...`);
  const browser = await chromium.launch({ 
    headless: config.headless,
    slowMo: config.headless ? 0 : 100,
  });
  
  let downloadResults = null;
  let uploadResults = null;
  
  try {
    // Phase 1: Download track maps
    if (!config.uploadOnly) {
      downloadResults = await downloadAllTrackMaps(browser, circuitMap);
    }
    
    // Phase 2: Upload to TheSportsDB
    if (!config.downloadOnly) {
      uploadResults = await uploadAllTrackMaps(browser, rows, circuitMap);
    }
    
    // Generate report
    generateReport(downloadResults, uploadResults, circuitMap);
    
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    console.error(error.stack);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Run the automation
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
