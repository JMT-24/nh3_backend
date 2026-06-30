import { z } from 'zod';

export const ingestSchema = z.object({
  nh3: z.object({
    raw: z.number(),
    voltage: z.number(),
    timestamp: z.string().optional(),
  }),
  ph: z.object({
    voltage: z.number(),
    pH: z.number(),
    timestamp: z.string().optional(),
  }),
  waterTemp: z.object({
    tempC: z.number(),
    tempF: z.number(),
    timestamp: z.string().optional(),
  }),
  actuators: z
    .object({
      pump: z.enum(['on', 'off']),
      valve: z.enum(['open', 'closed']),
    })
    .partial()
    .optional(),
  gateway: z
    .object({
      fw: z.string().optional(),
      heapPct: z.number().optional(),
      ip: z.string().optional(),
    })
    .optional(),
});

const recipientSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  enabled: z.boolean(),
});

export const alertConfigSchema = z.object({
  enabled: z.boolean(),
  cooldownSec: z.number().int().min(0),
  recipients: z.array(recipientSchema),
  templates: z.record(z.string(), z.string()),
});

export const manualControlSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  pump: z.enum(['on', 'off']).optional(),
  valve: z.enum(['open', 'closed']).optional(),
  reason: z.string().optional(),
});

export const rangeSchema = z.enum(['1H', '6H', '24H', '7D']);
export const sensorIdSchema = z.enum(['nh3', 'ph', 'temp']);
