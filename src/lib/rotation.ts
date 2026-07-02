import { Provider, RotationMode } from './types';
import { getEnabledProviders, getRoundRobinIndex, incrementRoundRobinIndex } from './storage';

function isRateLimited(provider: Provider): boolean {
  if (provider.rateLimitRemaining === undefined) return false;
  if (provider.rateLimitRemaining > 0) return false;
  // If remaining is 0, check if reset time has passed
  if (provider.rateLimitReset && Date.now() / 1000 > provider.rateLimitReset) return false;
  return true;
}

function filterAvailable(providers: Provider[]): Provider[] {
  const available = providers.filter(p => !isRateLimited(p));
  // If all are rate-limited, fall back to all enabled providers
  return available.length > 0 ? available : providers;
}

export async function selectProvider(mode: RotationMode): Promise<Provider | null> {
  const providers = await getEnabledProviders();
  if (providers.length === 0) return null;

  const available = filterAvailable(providers);

  switch (mode) {
    case 'priority':
      return selectByPriority(available);
    case 'round-robin':
      return selectRoundRobin(available);
    case 'failover':
    default:
      return selectFailover(available);
  }
}

function selectFailover(providers: Provider[]): Provider {
  // Sort by priority, return first (lowest number = highest priority)
  const sorted = [...providers].sort((a, b) => a.priority - b.priority);
  return sorted[0];
}

function selectRoundRobin(providers: Provider[]): Provider {
  const sorted = [...providers].sort((a, b) => a.id.localeCompare(b.id));
  const idx = getRoundRobinIndex() % sorted.length;
  incrementRoundRobinIndex(sorted.length);
  return sorted[idx];
}

function selectByPriority(providers: Provider[]): Provider {
  // Group by priority, pick randomly within same priority tier
  const sorted = [...providers].sort((a, b) => a.priority - b.priority);
  const topPriority = sorted[0].priority;
  const topTier = sorted.filter(p => p.priority === topPriority);
  return topTier[Math.floor(Math.random() * topTier.length)];
}

export async function getProviderOrder(mode: RotationMode): Promise<Provider[]> {
  const providers = await getEnabledProviders();
  if (providers.length === 0) return [];

  switch (mode) {
    case 'priority':
    case 'failover':
      return [...providers].sort((a, b) => a.priority - b.priority);
    case 'round-robin':
    default:
      return [...providers].sort((a, b) => a.id.localeCompare(b.id));
  }
}

export async function getNextProvider(
  mode: RotationMode,
  failedProviderId: string,
  triedIds: Set<string>
): Promise<Provider | null> {
  const order = await getProviderOrder(mode);
  
  for (const provider of order) {
    if (!triedIds.has(provider.id) && provider.enabled && provider.id !== failedProviderId && !isRateLimited(provider)) {
      return provider;
    }
  }
  
  // If all non-rate-limited providers have been tried, allow rate-limited ones as fallback
  for (const provider of order) {
    if (!triedIds.has(provider.id) && provider.enabled && provider.id !== failedProviderId) {
      return provider;
    }
  }
  
  return null;
}
