/**
 * One-time script to restore recovered module data to lcanunay@depaul.edu
 * Usage: node scripts/restore_account.js
 */

const https = require('https');
const readline = require('readline');
const fs = require('fs');

const API_KEY = 'AIzaSyCbVCGBdZfK2iXW6In0cwbXXKyXY220vDo';
const PROJECT_ID = 'study-tree-59228';
const RECOVERED_FILE = 'C:/Users/delon/recovered_modules.json';
const EMAIL = 'lcanunay@depaul.edu';

// ── helpers ──────────────────────────────────────────────────────────────────

function post(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function patch(url, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${token}`,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

// ── data prep ────────────────────────────────────────────────────────────────

// Decimate drawing stroke points to reduce size (keep every Nth point)
function thinStrokes(strokes, keepEvery = 3) {
  if (!strokes) return strokes;
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.filter((_, i) => i === 0 || i === stroke.points.length - 1 || i % keepEvery === 0),
  }));
}

function prepareModules(modules) {
  const out = [];
  for (const mod of modules) {
    const m = { ...mod };

    // Strip all cover images (too large for Firestore; user can re-upload)
    m.image = '';

    if (m.workspace && m.workspace.items) {
      const items = m.workspace.items.map((item) => {
        // Strip all binary media content
        if (
          (item.type === 'image' || item.type === 'video' || item.type === 'pdf') &&
          item.content && item.content.startsWith('data:')
        ) {
          return { ...item, content: '__local_only__' };
        }
        // Thin drawing strokes to reduce point density
        if (item.type === 'drawing' && item.strokes) {
          return { ...item, strokes: thinStrokes(item.strokes) };
        }
        // Strip folder file contents (data URLs inside folders)
        if (item.type === 'folder' && item.files) {
          const files = item.files.map((f) => ({ ...f, content: '__local_only__' }));
          return { ...item, files };
        }
        return item;
      });
      m.workspace = { ...m.workspace, items };
    }

    out.push(m);
  }
  return out;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Study Tracker Account Restore ===\n');
  console.log('Account:', EMAIL);

  // Read recovered data
  if (!fs.existsSync(RECOVERED_FILE)) {
    console.error('ERROR: Recovered file not found at', RECOVERED_FILE);
    process.exit(1);
  }
  const raw = fs.readFileSync(RECOVERED_FILE, 'latin1');
  const modules = JSON.parse(raw);
  console.log(`Found ${modules.length} modules:`, modules.map((m) => m.name).join(', '));

  // Prepare data (strip oversized binary)
  const prepared = prepareModules(modules);
  const modulesJson = JSON.stringify(prepared);
  console.log(`Prepared data size: ${(modulesJson.length / 1024).toFixed(0)} KB`);

  const password = await ask('Enter password for ' + EMAIL + ': ');

  // Authenticate
  console.log('\nAuthenticating...');
  const authRes = await post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email: EMAIL, password, returnSecureToken: true }
  );
  if (authRes.status !== 200) {
    console.error('Auth failed:', JSON.stringify(authRes.body, null, 2));
    process.exit(1);
  }
  const { idToken, localId } = authRes.body;
  console.log('Authenticated! UID:', localId);

  // Write to Firestore
  console.log('\nWriting to Firestore...');
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${localId}`;
  const doc = {
    fields: {
      modulesJson: { stringValue: modulesJson },
      updatedAt: { integerValue: String(Date.now()) },
    },
  };
  const writeRes = await patch(firestoreUrl, doc, idToken);
  if (writeRes.status !== 200) {
    console.error('Firestore write failed (status', writeRes.status + '):');
    console.error(JSON.stringify(writeRes.body, null, 2));
    process.exit(1);
  }

  console.log('\n✓ Data restored successfully to', EMAIL);
  console.log('  Modules written:', prepared.length);
  console.log('\nLog into the app as', EMAIL, 'and your data should appear.');
}

main().catch((err) => { console.error('Unexpected error:', err); process.exit(1); });
