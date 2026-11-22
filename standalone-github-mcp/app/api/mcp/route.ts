import { handleVercelMcpRequest } from '../../../src/vercelRoute.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = handleVercelMcpRequest;
export const POST = handleVercelMcpRequest;
export const OPTIONS = handleVercelMcpRequest;
