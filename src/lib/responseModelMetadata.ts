export interface ResponseModelMetadata {
  modelId?: string;
  provider?: string;
}

function cleanMetadataValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned || undefined;
}

/** Accept only identity fields supplied by the backend response metadata contract. */
export function normalizeResponseModelMetadata(value: unknown): ResponseModelMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const modelId = cleanMetadataValue(metadata.modelId ?? metadata.model ?? metadata.modelVersion);
  const provider = cleanMetadataValue(metadata.provider);
  if (!modelId && !provider) return null;
  return {
    ...(modelId ? { modelId } : {}),
    ...(provider ? { provider } : {}),
  };
}

export function mergeResponseModelMetadata(current: unknown, incoming: unknown): ResponseModelMetadata | null {
  const normalizedCurrent = normalizeResponseModelMetadata(current);
  const normalizedIncoming = normalizeResponseModelMetadata(incoming);
  if (!normalizedCurrent) return normalizedIncoming;
  if (!normalizedIncoming) return normalizedCurrent;
  return normalizeResponseModelMetadata({ ...normalizedCurrent, ...normalizedIncoming });
}

export function createResponseModelMetadataTracker() {
  let observed: ResponseModelMetadata | null = null;
  let emitted: ResponseModelMetadata | null = null;

  return {
    observe(incoming: unknown, hasResponseContent: boolean): ResponseModelMetadata | null {
      observed = mergeResponseModelMetadata(observed, incoming);
      if (!hasResponseContent || !observed) return null;
      if (observed.modelId === emitted?.modelId && observed.provider === emitted?.provider) return null;
      emitted = observed;
      return observed;
    },
  };
}

export function formatResponseModelMetadata(metadata: unknown): string {
  const normalized = normalizeResponseModelMetadata(metadata);
  if (!normalized) return 'Model information unavailable';
  if (!normalized.modelId) {
    return `Model information unavailable${normalized.provider ? ` · Provider: ${normalized.provider}` : ''}`;
  }
  const parts = [
    normalized.modelId ? `Model: ${normalized.modelId}` : null,
    normalized.provider ? `Provider: ${normalized.provider}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ') || 'Model information unavailable';
}
