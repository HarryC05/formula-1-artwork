#!/usr/bin/env node

/**
 * TheSportsDB Image Upload Automation
 * Uploads Formula 1 2026 artwork (posters, thumbnails, banners) to TheSportsDB.com
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

// Constants
const BASE_URL = 'https://www.thesportsdb.com';
const SEASON_URL = `${BASE_URL}/season/4370-formula-1/2026&all=1&view=0`;

// Session filename mapping (from generate.js)
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

// Parse command line arguments
const args = process.argv.slice(2);

// Helper function to get argument value (supports both --flag=value and --flag value formats)
function getArgValue(argName) {
  // Check for --arg=value format
  const equalFormat = args.find(arg => arg.startsWith(`${argName}=`));
  if (equalFormat) {
    return equalFormat.split('=')[1];
  }
  
  // Check for --arg value format (space-separated)
  const argIndex = args.indexOf(argName);
  if (argIndex !== -1 && argIndex + 1 < args.length) {
    return args[argIndex + 1];
  }
  
  return null;
}

const config = {
  username: process.env.SPORTSDB_USERNAME,
  password: process.env.SPORTSDB_PASSWORD,
  headless: !args.includes('--headless=false') && !args.includes('--headless') || args.includes('--headless=true'),
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  screenshotOnError: true,
  uploadDelay: 1500, // ms between uploads
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
  
  const logFile = path.join('upload-logs', `upload-${new Date().toISOString().split('T')[0]}.log`);
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
 * Resolve image paths for a CSV row
 */
function resolveImagePaths(row) {
  const year = row.DATE.split('-')[0];
  const sessionFile = SESSION_FILENAMES[row.SESSION.toUpperCase()];
  
  if (!sessionFile) {
    log(`Unknown session type: ${row.SESSION}`, 'warn');
    return null;
  }
  
  // Testing sessions (TESTINGSESSION !== 'False')
  if (row.TESTINGSESSION !== 'False') {
    const testingNo = row.TESTINGSESSION.padStart(2, '0');
    const folder = `${row.ROUND.padStart(2, '0')}-${row.COUNTRY}-testing-${testingNo}`;
    return {
      poster: path.join('posters', year, folder, 'jpg', `${sessionFile}.jpg`),
      thumb: path.join('thumbnails', year, folder, 'jpg', `${sessionFile}.jpg`),
      banner: path.join('banners', year, folder, 'jpg', `${sessionFile}.jpg`),
    };
  }
  
  // Regular race sessions
  const folder = `${row.ROUND.padStart(2, '0')}-${row.COUNTRY}`;
  return {
    poster: path.join('posters', year, folder, 'jpg', `${sessionFile}.jpg`),
    thumb: path.join('thumbnails', year, folder, 'jpg', `${sessionFile}.jpg`),
    banner: path.join('banners', year, folder, 'jpg', `${sessionFile}.jpg`),
  };
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
    
    // Wait for navigation and check if login was successful
    await page.waitForLoadState('networkidle');
    
    // Check if we're still on login page (login failed)
    const currentUrl = page.url();
    if (currentUrl.includes('user_login.php')) {
      // Check for error message
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
 * Upload a single image
 */
async function uploadImage(page, imageType, imagePath, eventName) {
  // Map image types to their labels on TheSportsDB
  const imageLabelMap = {
    'poster': 'Poster',
    'thumb': 'Thumb',
    'banner': 'Banner'
  };
  
  // Map image types to their type ID parameter (t=X) in upload_art.php URLs
  const imageTypeIdMap = {
    'poster': '9',
    'thumb': '7',
    'banner': '11'
  };
  
  const imageTypeLabel = imageLabelMap[imageType] || imageType.charAt(0).toUpperCase() + imageType.slice(1);
  const imageTypeId = imageTypeIdMap[imageType];
  
  // Check if file exists
  if (!fs.existsSync(imagePath)) {
    log(`  ⚠️  ${imageTypeLabel} not found: ${imagePath}`, 'warn');
    return { success: false, reason: 'file_not_found' };
  }
  
  if (config.dryRun) {
    log(`  🔍 [DRY RUN] Would upload ${imageTypeLabel}: ${imagePath}`);
    return { success: true, dryRun: true };
  }
  
  const startTime = Date.now();
  
  try {
    // The HTML structure varies by image type:
    // - Poster: <b>Poster<a href="/upload_art.php?t=9&id=X"><img src="/images/icons/edit.png"></a></b>
    // - Thumb:  <b>Thumb</b><a href="/upload_art.php?t=7&id=X"><img src="/images/icons/edit.png"></a>
    // - Banner: <b>Banner</b><a href="/upload_art.php?t=11&id=X"><img src="/images/icons/edit.png"></a>
    // We need to handle both cases: edit link inside <b> tag, and edit link as sibling after <b> tag
    
    // Debug: Check what's actually on the page
    if (config.verbose) {
      const htmlContent = await page.content();
      
      // Look for all <b> tags that might contain image labels
      const allBoldTags = htmlContent.match(/<b>[^<]*(?:<a[^>]*>.*?<\/a>)?<\/b>/gi);
      if (allBoldTags) {
        const imageRelatedTags = allBoldTags.filter(tag => 
          tag.toLowerCase().includes('poster') || 
          tag.toLowerCase().includes('thumb') || 
          tag.toLowerCase().includes('banner') ||
          tag.toLowerCase().includes('fanart') ||
          tag.toLowerCase().includes('square')
        );
        log(`  🔍 Found ${imageRelatedTags.length} image-related labels on page:`);
        imageRelatedTags.slice(0, 10).forEach(tag => log(`     - ${tag}`));
      }
      
      // Also look for ALL upload_art.php links
      const allUploadLinks = htmlContent.match(/upload_art\.php[^"']*/gi);
      if (allUploadLinks) {
        log(`  🔗 Found ${allUploadLinks.length} upload_art.php links:`);
        allUploadLinks.forEach(link => log(`     - ${link}`));
      }
    }
    
    let editClicked = false;
    
    // Strategy 1: Find the <b> tag containing the image type label, then find the edit link inside it
    // This handles: <b>Poster<a href="/upload_art.php?t=9&id=X"></a></b>
    try {
      const editLink = page.locator(`//b[contains(text(), "${imageTypeLabel}")]/a[contains(@href, "upload_art.php")]`);
      const count = await editLink.count();
      
      if (count > 0) {
        await editLink.first().click({ timeout: 5000 });
        editClicked = true;
        if (config.verbose) log(`  📝 Clicked edit link for ${imageTypeLabel} (inside <b> tag)`);
      }
    } catch (e) {
      if (config.verbose) log(`  ⚠️  Strategy 1 failed: ${e.message}`);
    }
    
    // Strategy 2: Find <b> tag with exact text match, then find the NEXT SIBLING <a> tag
    // This handles: <b>Thumb</b><a href="/upload_art.php?t=7&id=X"></a>
    if (!editClicked) {
      try {
        // XPath to find <b> with exact text, then get the following sibling <a> with upload_art.php
        const editLink = page.locator(`//b[text()="${imageTypeLabel}"]/following-sibling::a[contains(@href, "upload_art.php")][1]`);
        const count = await editLink.count();
        
        if (count > 0) {
          await editLink.first().click({ timeout: 5000 });
          editClicked = true;
          if (config.verbose) log(`  📝 Clicked edit link for ${imageTypeLabel} (sibling after <b> tag)`);
        }
      } catch (e) {
        if (config.verbose) log(`  ⚠️  Strategy 2 failed: ${e.message}`);
      }
    }
    
    // Strategy 3: Use the type ID parameter to find the correct link
    // This handles finding by t=7, t=9, t=11, etc.
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
      // Save full HTML for debugging
      const htmlContent = await page.content();
      const htmlFilePath = `upload-logs/page-html-${eventName.replace(/[^a-z0-9]/gi, '-')}-${imageTypeLabel}-${Date.now()}.html`;
      require('fs').writeFileSync(htmlFilePath, htmlContent);
      log(`  💾 Full HTML saved to: ${htmlFilePath}`);
      
      throw new Error(`Could not find edit link for ${imageTypeLabel}`);
    }
    
    // Wait for upload form to load
    await page.waitForLoadState('networkidle');
    
    // Upload file
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.resolve(imagePath));
    
    if (config.verbose) log(`  📤 File selected: ${path.basename(imagePath)}`);
    
    // Submit form
    const submitButton = await page.locator('input[type="submit"], button:has-text("Submit")').first();
    await submitButton.click();
    
    // Wait for upload to complete
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Click "Return to event" link
    try {
      const returnLink = await page.locator('a:has-text("Return to event"), a:has-text("return to event"), a:has-text("Back to event")').first();
      const linkCount = await returnLink.count();
      
      if (linkCount > 0) {
        await returnLink.click({ timeout: 5000 });
        await page.waitForLoadState('networkidle');
        if (config.verbose) log(`  ↩️  Returned to event page`);
      } else {
        // If "Return to event" link not found, try to find the event URL and navigate directly
        if (config.verbose) log(`  ℹ️  Return link not found, going back to event page`);
        
        // Try to go back multiple times if needed to get to the event page
        const currentUrl = page.url();
        if (!currentUrl.includes('/event/')) {
          await page.goBack({ waitUntil: 'networkidle' });
          await page.waitForTimeout(500);
          
          // Check again
          const newUrl = page.url();
          if (!newUrl.includes('/event/')) {
            await page.goBack({ waitUntil: 'networkidle' });
            await page.waitForTimeout(500);
          }
        }
      }
    } catch (e) {
      // If all else fails, try going back
      if (config.verbose) log(`  ⚠️  Error returning to event: ${e.message}, attempting goBack`);
      try {
        await page.goBack({ waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);
      } catch (backError) {
        log(`  ⚠️  Could not navigate back: ${backError.message}`, 'warn');
      }
    }
    
    // Verify we're on an event page
    const finalUrl = page.url();
    if (!finalUrl.includes('/event/')) {
      log(`  ⚠️  Warning: Not on event page after upload. URL: ${finalUrl}`, 'warn');
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  📤 ${imageTypeLabel} uploaded ✓ (${duration}s)`, 'success');
    
    return { success: true, duration: parseFloat(duration), eventUrl: finalUrl };
    
  } catch (error) {
    if (config.screenshotOnError) {
      const screenshotPath = path.join('upload-logs', `error-${eventName.replace(/\s+/g, '-')}-${imageType}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      log(`  📸 Screenshot saved: ${screenshotPath}`);
    }
    
    log(`  ❌ ${imageTypeLabel} upload failed: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

/**
 * Process a single event
 */
async function processEvent(page, row, eventLink, index) {
  const eventName = `${row.LOCATION} ${row.SESSION}`;
  
  log(`\n[${index + 1}] ${eventName} (${row.DATE})`);
  
  // Resolve image paths
  const paths = resolveImagePaths(row);
  
  if (!paths) {
    log(`  ⚠️  Skipping - could not resolve paths`, 'warn');
    return { success: false, reason: 'invalid_session' };
  }
  
  log(`  📂 Poster:  ${paths.poster}`);
  log(`  📂 Thumb:   ${paths.thumb}`);
  log(`  📂 Banner:  ${paths.banner}`);
  
  // Navigate to event page
  const eventUrl = `${BASE_URL}${eventLink}`;
  try {
    await page.goto(eventUrl, { waitUntil: 'networkidle' });
    log(`  🔗 On event page`);
  } catch (error) {
    log(`  ❌ Failed to navigate to event page: ${error.message}`, 'error');
    return { success: false, error: 'navigation_failed' };
  }
  
  // Upload each image type
  const results = {
    poster: await uploadImage(page, 'poster', paths.poster, eventName),
  };
  
  // Ensure we're back on the event page before uploading thumb
  if (results.poster.success) {
    const currentUrl = page.url();
    if (!currentUrl.includes('/event/')) {
      if (config.verbose) log(`  ↩️  Navigating back to event page for Thumb`);
      await page.goto(eventUrl, { waitUntil: 'networkidle' });
    }
  }
  
  results.thumb = await uploadImage(page, 'thumb', paths.thumb, eventName);
  
  // Ensure we're back on the event page before uploading banner
  if (results.thumb.success) {
    const currentUrl = page.url();
    if (!currentUrl.includes('/event/')) {
      if (config.verbose) log(`  ↩️  Navigating back to event page for Banner`);
      await page.goto(eventUrl, { waitUntil: 'networkidle' });
    }
  }
  
  results.banner = await uploadImage(page, 'banner', paths.banner, eventName);
  
  // Add small delay before next event
  await page.waitForTimeout(config.uploadDelay);
  
  // Calculate statistics
  const successCount = Object.values(results).filter(r => r.success).length;
  const totalTime = Object.values(results).reduce((sum, r) => sum + (r.duration || 0), 0);
  
  if (successCount === 3) {
    log(`  ✅ Complete (${totalTime.toFixed(1)}s total)`, 'success');
  } else if (successCount > 0) {
    log(`  ⚠️  Partial success: ${successCount}/3 uploaded`, 'warn');
  } else {
    log(`  ❌ All uploads failed`, 'error');
  }
  
  return { success: successCount > 0, results, successCount, totalTime };
}

/**
 * Generate summary report
 */
function generateReport(results) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📊 Upload Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const totalEvents = results.length;
  const successfulEvents = results.filter(r => r.result.successCount === 3).length;
  const partialEvents = results.filter(r => r.result.successCount > 0 && r.result.successCount < 3).length;
  const failedEvents = results.filter(r => r.result.successCount === 0).length;
  
  const totalImages = results.reduce((sum, r) => sum + r.result.successCount, 0);
  const totalTime = results.reduce((sum, r) => sum + (r.result.totalTime || 0), 0);
  
  if (config.dryRun) {
    console.log(`${colors.cyan}🔍 DRY RUN MODE - No files were uploaded${colors.reset}`);
    console.log(`✅ Would upload:    ${successfulEvents} events (${totalImages} images)`);
  } else {
    console.log(`✅ Successful:     ${successfulEvents} events (${successfulEvents * 3} images)`);
    if (partialEvents > 0) {
      console.log(`⚠️  Partial:        ${partialEvents} events`);
    }
    if (failedEvents > 0) {
      console.log(`❌ Failed:          ${failedEvents} events`);
    }
  }
  
  const minutes = Math.floor(totalTime / 60);
  const seconds = Math.floor(totalTime % 60);
  console.log(`⏱️  Total time:     ${minutes}m ${seconds}s`);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Show failed events if any
  if (failedEvents > 0 && !config.dryRun) {
    console.log('\nFailed events:');
    results.forEach((r, i) => {
      if (r.result.successCount === 0) {
        console.log(`  - [${i + 1}] ${r.row.LOCATION} ${r.row.SESSION}: ${r.result.results.poster.error || 'Unknown error'}`);
      }
    });
    console.log('');
  }
  
  const logFile = path.join('upload-logs', `upload-${new Date().toISOString().split('T')[0]}.log`);
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
  console.log(`${colors.bright}🏎️  TheSportsDB F1 2026 Image Upload Automation${colors.reset}`);
  console.log('================================================\n');
  
  // Validate environment
  if (!config.username || !config.password) {
    console.error(`${colors.red}❌ Missing credentials${colors.reset}`);
    console.error('Please set SPORTSDB_USERNAME and SPORTSDB_PASSWORD in .env file\n');
    console.error('Example:');
    console.error('  SPORTSDB_USERNAME=your_username');
    console.error('  SPORTSDB_PASSWORD=your_password\n');
    process.exit(1);
  }
  
  // Read CSV
  const csvPath = './2026.csv';
  if (!fs.existsSync(csvPath)) {
    console.error(`${colors.red}❌ CSV file not found: ${csvPath}${colors.reset}`);
    process.exit(1);
  }
  
  const rows = await readCSV(csvPath);
  log(`📊 Loaded ${rows.length} events from 2026.csv`);
  
  if (config.dryRun) {
    log(`🔍 Running in DRY RUN mode - no files will be uploaded`, 'info');
  }
  
  if (config.startRow > 0) {
    log(`⏭️  Starting from row ${config.startRow + 1}`, 'info');
  }
  
  if (config.limit < Infinity) {
    log(`🔢 Limiting to ${config.limit} events`, 'info');
  }
  
  // Launch browser
  log(`🌐 Launching browser (headless: ${config.headless})...`);
  const browser = await chromium.launch({ 
    headless: config.headless,
    slowMo: config.headless ? 0 : 100, // Slow down for visual debugging
  });
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
    log(`✓ Found ${eventLinks.length} event links on page\n`, 'success');
    
    if (eventLinks.length !== rows.length) {
      log(`⚠️  Warning: CSV has ${rows.length} rows but page has ${eventLinks.length} events`, 'warn');
    }
    
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Process each event
    const results = [];
    const endRow = Math.min(config.startRow + config.limit, rows.length);
    
    for (let i = config.startRow; i < endRow; i++) {
      const result = await processEvent(page, rows[i], eventLinks[i], i);
      results.push({ row: rows[i], result });
    }
    
    // Generate summary report
    generateReport(results);
    
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
