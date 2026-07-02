import { NextResponse } from 'next/server';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

export function withCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function corsResponse(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  return withCors(response);
}

export function handleCorsPreflight(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
