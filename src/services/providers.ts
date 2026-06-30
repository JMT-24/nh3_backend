import UniSMSImport from 'unisms';
import { config } from '../config.js';

export interface SendOpts {
  /** Per-send sender ID override (else falls back to config). */
  senderId?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(to: string, message: string, opts?: SendOpts): Promise<void>;
}

// --- Provider: stub (dev / no credentials) ---------------------------------

const stubProvider: SmsProvider = {
  name: 'stub',
  async send(to, message, opts) {
    const from = opts?.senderId ?? '(default)';
    console.log(`[sms:stub] from ${from} -> ${to}: ${message}`);
  },
};

// --- Provider: unismsapi.com (Philippines) ---------------------------------
// POST https://unismsapi.com/api/sms with HTTP Basic auth (key as username,
// empty password) and a JSON body { recipient, content }.

function makeUnismsApiProvider(): SmsProvider {
  const auth = 'Basic ' + Buffer.from(`${config.unismsapi.key}:`).toString('base64');
  return {
    name: 'unismsapi',
    async send(to, message, opts) {
      const body: Record<string, string> = { recipient: to, content: message };
      const senderId = opts?.senderId || config.unismsapi.sender;
      if (senderId) body.sender_id = senderId;
      const res = await fetch('https://unismsapi.com/api/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`unismsapi HTTP ${res.status}: ${text}`);
      }
    },
  };
}

// --- Provider: unisms.apistd.com (China aggregator) ------------------------
// `unisms` is CommonJS (exports.default = class); under Node ESM interop the
// real constructor sits on `.default`. Declare only the surface we use.

type UniSendParams =
  | { to: string; signature: string; content: string }
  | {
      to: string;
      signature: string;
      templateId: string;
      templateData?: Record<string, string | number>;
    };

interface UniSMSClient {
  send(params: UniSendParams): Promise<unknown>;
}
interface UniSMSConstructor {
  new (cfg: { accessKeyId: string; accessKeySecret: string }): UniSMSClient;
}

const UniSMS = ((UniSMSImport as unknown as { default?: UniSMSConstructor }).default ??
  (UniSMSImport as unknown)) as UniSMSConstructor;

function makeUniSmsProvider(): SmsProvider {
  const client = new UniSMS({
    accessKeyId: config.unisms.accessKeyId,
    accessKeySecret: config.unisms.accessKeySecret,
  });
  return {
    name: 'unisms',
    async send(to, message) {
      if (config.unisms.templateId) {
        await client.send({
          to,
          signature: config.unisms.signature,
          templateId: config.unisms.templateId,
          templateData: { content: message },
        });
      } else {
        await client.send({ to, signature: config.unisms.signature, content: message });
      }
    },
  };
}

// --- Selection -------------------------------------------------------------

const apistdConfigured = Boolean(config.unisms.accessKeyId && config.unisms.accessKeySecret);
const unismsApiConfigured = Boolean(config.unismsapi.key);

function resolveProvider(): SmsProvider {
  switch (config.smsProvider) {
    case 'stub':
      return stubProvider;
    case 'unismsapi':
      return makeUnismsApiProvider();
    case 'unisms':
      return makeUniSmsProvider();
    default:
      // Auto-detect: prefer the PH service, then the apistd one, else stub.
      if (unismsApiConfigured) return makeUnismsApiProvider();
      if (apistdConfigured) return makeUniSmsProvider();
      return stubProvider;
  }
}

export const smsProvider: SmsProvider = resolveProvider();
export const smsProviderName = smsProvider.name;
/** True when a real (non-stub) provider is active. */
export const smsConfigured = smsProvider.name !== 'stub';
