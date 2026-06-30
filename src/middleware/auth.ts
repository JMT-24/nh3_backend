import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Guards the Pi-facing endpoints. The Pi must send the shared secret as
 * `x-api-key`. Uses a length-checked comparison; for higher assurance, move to
 * mTLS or a signed-timestamp scheme later.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('x-api-key') ?? '';
  if (provided && provided === config.ingestApiKey) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}
