import { NextRequest, NextResponse } from 'next/server';
import { verifyDashboardAuth } from '@/lib/auth';
import { withCors, handleCorsPreflight } from '@/lib/cors';
import { pollForAuthCode, exchangeAuthCode, discoverModels } from '@/lib/chatgpt-auth';
import { addProvider, getProviders } from '@/lib/storage';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/auth/chatgpt/poll
 * Poll for the authorization code after the user enters the device code.
 * Once the user logs in, exchanges the code for tokens and creates a provider.
 * Body: { device_auth_id, user_code, provider_name? }
 */
export async function POST(request: NextRequest) {
  if (!await verifyDashboardAuth(request)) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const body = await request.json();
    const { device_auth_id, user_code, provider_name } = body;

    if (!device_auth_id || !user_code) {
      return withCors(
        NextResponse.json({ error: 'Missing device_auth_id or user_code' }, { status: 400 })
      );
    }

    // Poll for auth code
    const pollResult = await pollForAuthCode(device_auth_id, user_code);

    if (!pollResult) {
      return withCors(NextResponse.json({ status: 'pending', message: 'Waiting for user login...' }));
    }

    // Exchange for tokens
    const tokens = await exchangeAuthCode(
      pollResult.authorization_code,
      pollResult.code_verifier,
    );

    // Discover available models
    let models: string[] = [];
    try {
      models = await discoverModels(tokens.access_token);
    } catch {
      models = ['gpt-5.5']; // fallback
    }

    // Check if a ChatGPT Plus provider already exists
    const existingProviders = await getProviders();
    const existingChatGPT = existingProviders.find(p => p.authType === 'chatgpt_plus');

    const providerData = {
      name: provider_name || 'ChatGPT Plus',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: tokens.access_token, // current access token
      models,
      selectedModels: models,
      priority: 100, // low priority = fallback
      enabled: true,
      authType: 'chatgpt_plus' as const,
      chatgptRefreshToken: tokens.refresh_token,
      chatgptExpiresAt: tokens.expires_at,
    };

    let provider;
    if (existingChatGPT) {
      // Update existing
      const { updateProvider } = await import('@/lib/storage');
      provider = await updateProvider(existingChatGPT.id, providerData as any);
    } else {
      // Create new
      provider = await addProvider(providerData as any);
    }

    return withCors(NextResponse.json({
      status: 'success',
      provider,
      models,
    }));
  } catch (err: any) {
    return withCors(
      NextResponse.json({ error: err.message }, { status: 500 })
    );
  }
}
