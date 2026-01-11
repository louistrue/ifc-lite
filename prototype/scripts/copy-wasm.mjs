import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(__dirname, '..', 'wasm');
const webIfcDir = join(__dirname, '..', 'node_modules', 'web-ifc');

if (!existsSync(wasmDir)) mkdirSync(wasmDir, { recursive: true });

// Copy Node.js WASM file
try {
  copyFileSync(
    join(webIfcDir, 'web-ifc-node.wasm'),
    join(wasmDir, 'web-ifc-node.wasm')
  );
  console.log('Copied web-ifc-node.wasm to prototype/wasm/');
} catch (error) {
  console.error('Failed to copy WASM file:', error.message);
  process.exit(1);
}
