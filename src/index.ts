import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import './db.js'; // initialise schema on import
import { smsProviderName } from './services/providers.js';
import { alarmsRouter } from './routes/alarms.js';
import { alertsRouter } from './routes/alerts.js';
import { controlRouter } from './routes/control.js';
import { gatewayRouter } from './routes/gateway.js';
import { ingestRouter } from './routes/ingest.js';
import { sensorsRouter } from './routes/sensors.js';
import { initWebSocket } from './ws.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / curl (no origin) and any configured frontend origin.
      if (!origin || config.allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error(`Origin not allowed: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, sms: smsProviderName, ts: new Date().toISOString() });
});

app.use('/api/sensors', sensorsRouter);
app.use('/api/alarms', alarmsRouter);
app.use('/api/gateway', gatewayRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/control', controlRouter);
app.use('/api/ingest', ingestRouter);

// Fallback error handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'internal error' });
});

const server = createServer(app);
initWebSocket(server);

server.listen(config.port, () => {
  console.log(`nh3-backend listening on http://localhost:${config.port}`);
  console.log(`  SMS provider: ${smsProviderName}${smsProviderName === 'stub' ? ' (logging only)' : ''}`);
  console.log(`  WebSocket:    ws://localhost:${config.port}/ws`);
});
