import { Provider, RotationMode } from './types';
import { getEnabledProviders, getRoundRobinIndex, incrementRoundRobinIndex } from './storage';

export function selectProvider(mode: RotationMode): Provider | null {
  const providers = getEnabledProviders();
  if (providers.length === 0) return null;

  switch (mode) {
    case 'priority':
      return selectByPriority(providers);
    case 'round-robin':
      return selectRoundRobin(providers);
    case 'failover':
    default:
      return selectFailover(providers);
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

export function getProviderOrder(mode: RotationMode): Provider[] {
  const providers = getEnabledProviders();
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

export function getNextProvider(
  mode: RotationMode,
  failedProviderId: string,
  triedIds: Set<string>
): Provider | null {
  const order = getProviderOrder(mode);
  
  for (const provider of order) {
    if (!triedIds.has(provider.id) && provider.enabled && provider.id !== failedProviderId) {
      return provider;
    }
  }
  
  return null;
}
