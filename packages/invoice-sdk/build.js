const fs = require('fs');
const path = require('path');
const dist = path.resolve(__dirname, 'dist');
if (!fs.existsSync(dist)) fs.mkdirSync(dist);
// CommonJS
fs.writeFileSync(path.join(dist, 'index.cjs'), "module.exports = require('@iln/sdk');\n");
// ESM
fs.writeFileSync(
  path.join(dist, 'index.mjs'),
  "export * from '@iln/sdk';\nexport { default } from '@iln/sdk';\n"
);
// Type declarations: re-export types via a reference
fs.writeFileSync(path.join(dist, 'index.d.ts'), "export * from '@iln/sdk';\n");
console.log('built alias package');
