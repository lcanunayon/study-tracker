const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../src/renderer');
const dst = path.join(__dirname, '../dist/renderer');

fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(path.join(src, 'index.html'), path.join(dst, 'index.html'));
fs.copyFileSync(path.join(src, 'styles.css'), path.join(dst, 'styles.css'));
console.log('Static files copied to dist/renderer/');
