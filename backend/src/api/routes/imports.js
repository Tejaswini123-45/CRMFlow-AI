/**
 * Imports Router — /api/v1/imports
 * LLD §4 route definitions, all delegating to thin controllers.
 */

import { Router } from 'express';
import multer from 'multer';
import { CONFIG } from '../../config/index.js';
import {
  createImport,
  getStatus,
  getMappingProposals,
  submitCorrections,
  getResult,
  getAuditLog,
  downloadOutput,
} from '../controllers/imports.controller.js';

const router = Router();

// Multer: memory storage, CSV only, size-limited via CONFIG
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONFIG.get('max_file_size_bytes') },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/octet-stream', 'application/vnd.ms-excel'];
    if (allowed.includes(file.mimetype) || file.originalname?.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(null, false); // silently reject; controller validates req.file presence
    }
  },
});

// POST /api/v1/imports — upload CSV, start pipeline
router.post('/', upload.single('file'), createImport);

// GET /api/v1/imports/:id — poll status
router.get('/:id', getStatus);

// GET /api/v1/imports/:id/mapping — get AI mapping proposals for review
router.get('/:id/mapping', getMappingProposals);

// POST /api/v1/imports/:id/mapping — submit corrections, resume pipeline
router.post('/:id/mapping', submitCorrections);

// GET /api/v1/imports/:id/result — get final import summary
router.get('/:id/result', getResult);

// GET /api/v1/imports/:id/audit — get full decision audit trail
router.get('/:id/audit', getAuditLog);

// GET /api/v1/imports/:id/download — download standardized output file
router.get('/:id/download', downloadOutput);

export default router;
