import { Provider, RotationMode } from './types';
import { getEnabledProviders, getRoundRobinIndex, incrementRoundRobinIndex } from './storage';

// ─── Model selection ──────────────────────────────────

/**
 * Pick a model from the provider's selectedModels array.
 * If the request specifies a model that's in the provider's selectedModels, use that.
 * Otherwise, round-robin through selectedModels.
 */
export function pickModel(provider: Provider, requestedModel?: string): string {
  const available = provider.selectedModels.length > 0 ? provider.selectedModels : provider.models;
  
  if (available.length === 0) {
    return requestedModel || '';
  }

  // Otherwise pick the first available model
  return available[0];
}

// ─── Provider selection ───────────────────────────────

/**
 * Filter providers that have at least one selected model (or any model at all).
 */
function filterProvidersWithModels(providers: Provider[]): Provider[] {
  return providers.filter(p => 
    (p.selectedModels && p.selectedModels.length > 0) || 
    (p.models && p.models.length > 0)
  );
}

export async function selectProvider(mode: RotationMode): Promise<Provider | null> {
  const providers = filterProvidersWithModels(await getEnabledProviders());
  if (providers.length === 0) return null;

  switch (mode) {
    case 'failover':
      return selectFailover(providers);
    case 'round-robin':
      return selectRoundRobin(providers);
    case 'priority':
      return selectPriority(providers);
    default:
      return selectFailover(providers);
  }
}

export async function getNextProvider(
  mode: RotationMode,
  currentId: string,
  triedIds: Set<string>
): Promise<Provider | null> {
  const providers = filterProvidersWithModels(await getEnabledProviders());
  const available = providers.filter(p => !triedIds.has(p.id));
  if (available.length === 0) return null;

  switch (mode) {
    case 'failover':
      return available[0]; // already sorted by priority
    case 'round-robin':
      return selectRoundRobin(available);
    case 'priority':
      return selectPriority(available);
    default:
      return available[0];
  }
}

function selectFailover(providers: Provider[]): Provider {
  return providers[0]; // sorted by priority (lowest number = highest priority)
}

function selectRoundRobin(providers: Provider[]): Provider {
  const idx = getRoundRobinIndex() % providers.length;
  incrementRoundRobinIndex(providers.length);
  return providers[idx];
}

function selectPriority(providers: Provider[]): Provider {
  // Group by priority tier
  const tiers = new Map<number, Provider[]>();
  for (const p of providers) {
    const tier = tiers.get(p.priority) || [];
    tier.push(p);
    tiers.set(p.priority, tier);
  }

  // Pick the lowest priority number (highest priority)
  const topTier = [...tiers.keys()].sort((a, b) => a - b)[0];
  const tierProviders = tiers.get(topTier)!;

  // Random within tier
  return tierProviders[Math.floor(Math.random() * tierProviders.length)];
}
