/**
 * Backend Entry Point
 * Starts the Express HTTP server with the real Orchestrator and pipeline components.
 */

import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createApp } from './api/app.js';
import { Orchestrator } from './orchestrator/index.js';
import { InMemoryDataStore } from './orchestrator/data-store.js';

// Pipeline components — index.js is the composition root; it is the only non-orchestrator
// file permitted to import pipeline components directly (they are assembled here and
// passed to ORCH, never imported by other application modules).
// eslint-disable-next-line no-restricted-imports
import INGEST from './pipeline/ingestion/index.js';
// eslint-disable-next-line no-restricted-imports
import HDRX from './pipeline/header_analysis/index.js';
// eslint-disable-next-line no-restricted-imports
import AIMAP from './pipeline/ai_mapping/index.js';
// eslint-disable-next-line no-restricted-imports
import MAPFIN from './pipeline/mapping_finalization/index.js';
// eslint-disable-next-line no-restricted-imports
import XFORM from './pipeline/transformation/index.js';
// eslint-disable-next-line no-restricted-imports
import VALID from './pipeline/validation/index.js';
// eslint-disable-next-line no-restricted-imports
import DEDUPE from './pipeline/duplicate_detection/index.js';
// eslint-disable-next-line no-restricted-imports
import EXPORT from './pipeline/export/index.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

async function main() {
  // Read package.json for version metadata
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));

  // Assemble pipeline components
  const components = { INGEST, HDRX, AIMAP, MAPFIN, XFORM, VALID, DEDUPE, EXPORT };
  const dataStore = new InMemoryDataStore();
  const orchestrator = new Orchestrator(components, dataStore);

  // Create Express app
  const app = createApp(orchestrator, { version: pkg.version });

  // Start server
  app.listen(PORT, () => {
    console.log(`CRM Ingestion Engine — Backend v${pkg.version}`);
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/api/v1/health`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
