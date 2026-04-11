import { NextResponse } from 'next/server';
import { DEPLOYMENT_MODE } from '@/lib/deployment';

/**
 * GET /api/deployment — Returns the current deployment mode.
 * Used by the client to conditionally show/hide features
 * (e.g. local folder archives in cloud mode).
 */
export async function GET() {
  return NextResponse.json({ mode: DEPLOYMENT_MODE });
}
