import { NextResponse } from 'next/server';
import { agentRequest } from '@/lib/agent-client';
import { getSessionUser } from '@/lib/auth';

export async function GET() {
  if (!await getSessionUser()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await agentRequest('/health')); }
  catch { return NextResponse.json({ status: 'OFFLINE', timestamp: new Date().toISOString() }); }
}
