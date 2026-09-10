import { createHmac, randomUUID } from 'node:crypto';

export async function agentRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = process.env.BOT_AGENT_URL; const secret = process.env.BOT_AGENT_SECRET;
  if (!url || !secret) throw new Error('BOT_AGENT_OFFLINE');
  const method = init.method || 'GET'; const timestamp = Date.now().toString(); const nonce = randomUUID(); const body = typeof init.body === 'string' ? init.body : '';
  const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${method}.${path}.${body}`).digest('hex');
  const response = await fetch(new URL(path, url), { ...init, cache: 'no-store', signal: AbortSignal.timeout(6000), headers: { ...init.headers, 'x-lomuyayo-timestamp': timestamp, 'x-lomuyayo-nonce': nonce, 'x-lomuyayo-signature': signature } });
  if (!response.ok) throw new Error(response.status === 401 ? 'AGENT_UNAUTHORIZED' : 'AGENT_UNAVAILABLE');
  return response.json() as Promise<T>;
}
