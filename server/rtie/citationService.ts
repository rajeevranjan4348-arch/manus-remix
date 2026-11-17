/**
 * Real-Time Intelligence Engine (RTIE) — Citation Service
 *
 * Formats clickable, verified markdown citations with domain credibility
 * and publication dates. Never fabricates URLs or citations.
 */

import { ConflictingClaim, VerifiedSourceRecord } from './types';

export function formatClickableCitationsMarkdown(
  sources: VerifiedSourceRecord[],
  conflicts: ConflictingClaim[] = [],
  maxSources = 8
): string {
  const validSources = (sources || []).filter(
    (s) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url)
  );
  if (validSources.length === 0) {
    return '';
  }

  const lines = validSources.slice(0, maxSources).map((s) => {
    const cleanTitle = (s.title || s.domain || s.url).replace(/[\[\]\r\n]+/g, ' ').trim();
    const dateBadge = s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : '';
    const tierBadge =
      s.credibilityTier === 'official'
        ? 'Verified Official'
        : s.credibilityTier === 'trusted'
          ? 'Trusted Source'
          : s.domain;
    return `- [${cleanTitle}](${s.url}) *(${tierBadge}${dateBadge})*`;
  });

  let conflictNote = '';
  if (conflicts.length > 0) {
    conflictNote =
      '\n\n**Source Verification Note**\n' +
      conflicts.map((c) => `- ${c.description}`).join('\n');
  }

  return `\n\n**Sources**\n${lines.join('\n')}${conflictNote}`;
}
