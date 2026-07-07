// ─── ChatGPT Plus OAuth (Device Code Flow) ─────────────
// Authenticates with OpenAI using the same device code flow
// as Codex CLI, enabling ChatGPT Plus subscribers to use
// GPT models without an API key.

const ISSUER = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = `${ISSUER}/oauth/token`;
const DEVICE_AUTH_URL = `${ISSUER}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${ISSUER}/api/accounts/deviceauth/token`;
const REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

export interface DeviceCodeResult {
  device_auth_id: string;
  user_code: string;
  interval: number;
  expires_at: string;
}

export interface ChatGPTTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO timestamp
}

/**
 * Step 1: Request a device code from OpenAI.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResult> {
  const resp = await fetch(DEVICE_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!resp.ok) {
    throw new Error(`Device code request failed: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Step 2: Poll for the authorization code after the user logs in.
 * Returns the raw poll response containing authorization_code + code_verifier.
 */
export async function pollForAuthCode(
  deviceAuthId: string,
  userCode: string,
): Promise<{ authorization_code: string; code_verifier: string } | null> {
  const resp = await fetch(DEVICE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }),
  });

  if (resp.status === 200) {
    const data = await resp.json();
    if (data.authorization_code && data.code_verifier) {
      return data;
    }
  }

  // 403/404 = user hasn't completed login yet
  return null;
}

/**
 * Step 3: Exchange authorization code for tokens.
 */
export async function exchangeAuthCode(
  authorizationCode: string,
  codeVerifier: string,
): Promise<ChatGPTTokens> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token exchange failed: ${resp.status}`);
  }

  const data = await resp.json();
  const expiresIn = data.expires_in || 864000; // default 10 days
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
  };
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<ChatGPTTokens> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status}`);
  }

  const data = await resp.json();
  const expiresIn = data.expires_in || 864000;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken, // fallback to old refresh token
    expires_at: expiresAt,
  };
}

/**
 * Discover available models from the Codex API.
 */
export async function discoverModels(accessToken: string): Promise<string[]> {
  const resp = await fetch(
    `${CODEX_BASE_URL}/models?client_version=1.0.0`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!resp.ok) {
    throw new Error(`Model discovery failed: ${resp.status}`);
  }

  const data = await resp.json();
  const models = Array.isArray(data) ? data : data.models || [];
  return models.map((m: any) => m.slug || m.id || m).filter(Boolean);
}

/**
 * Get a valid access token, refreshing if needed.
 * This is the main function called by the proxy before forwarding requests.
 */
export async function getValidAccessToken(
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; refreshed: boolean }> {
  const expiresDate = new Date(expiresAt);
  const bufferMs = 5 * 60 * 1000; // 5 min buffer

  // Token still valid
  if (expiresDate.getTime() - bufferMs > Date.now()) {
    return { accessToken, refreshToken, expiresAt, refreshed: false };
  }

  // Token expired or about to expire — refresh
  const newTokens = await refreshAccessToken(refreshToken);
  return {
    accessToken: newTokens.access_token,
    refreshToken: newTokens.refresh_token,
    expiresAt: newTokens.expires_at,
    refreshed: true,
  };
}

export { CODEX_BASE_URL };
