import { Router } from 'express';
import { gatewayStatus } from '../services/gateway.js';

export const gatewayRouter = Router();

// GET /api/gateway/status
gatewayRouter.get('/status', (_req, res) => {
  res.json(gatewayStatus(Date.now()));
});
