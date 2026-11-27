import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildScreenSharePromptPayload,
  classifyScreenShareError,
  computeScaledFrameDimensions,
  formatDisplaySurfaceLabel,
  parseGeminiStreamSseLine,
} from '../src/lib/screenShareEngine';

describe('Live Screen Share Feature (+ Attachment Menu)', () => {
  it('scales high-resolution displays proportionally without exceeding maxEdge', () => {
    expect(computeScaledFrameDimensions(3840, 2160, 1280)).toEqual({ width: 1280, height: 720 });
    expect(computeScaledFrameDimensions(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(computeScaledFrameDimensions(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(computeScaledFrameDimensions(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it('classifies browser getDisplayMedia errors accurately', () => {
    const cancelled = classifyScreenShareError({ name: 'NotAllowedError', message: 'User cancelled' });
    expect(cancelled.status).toBe('idle');
    expect(cancelled.cancelledByUser).toBe(true);

    const denied = classifyScreenShareError({ name: 'NotAllowedError', message: 'Permission denied by system' });
    expect(denied.status).toBe('denied');
    expect(denied.cancelledByUser).toBe(false);

    const security = classifyScreenShareError({ name: 'SecurityError', message: 'Blocked' });
    expect(security.status).toBe('denied');

    const notReadable = classifyScreenShareError({ name: 'NotReadableError', message: 'OS blocked' });
    expect(notReadable.status).toBe('unavailable');
  });

  it('builds multimodal [IMAGE_DATA_URL] payloads and parses SSE stream frames', () => {
    const frame = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const payload = buildScreenSharePromptPayload(frame, 'Why is this build failing?');
    expect(payload).toBe(`[IMAGE_DATA_URL:${frame}]\nWhy is this build failing?`);

    const defaultPayload = buildScreenSharePromptPayload(frame, '   ');
    expect(defaultPayload).toContain(`[IMAGE_DATA_URL:${frame}]`);
    expect(defaultPayload.length).toBeGreaterThan(frame.length + 25);

    expect(parseGeminiStreamSseLine('data: {"type":"text-delta","delta":"Hello"}')).toEqual({
      kind: 'delta',
      text: 'Hello',
    });
    expect(parseGeminiStreamSseLine('data: {"type":"heartbeat"}')).toEqual({ kind: 'ignore' });
    expect(parseGeminiStreamSseLine('data: [DONE]')).toEqual({ kind: 'done' });
    expect(parseGeminiStreamSseLine('data: {"type":"error","error":"Rate limited"}')).toEqual({
      kind: 'error',
      error: 'Rate limited',
    });
    expect(formatDisplaySurfaceLabel('monitor')).toBe('Entire Screen');
    expect(formatDisplaySurfaceLabel('window')).toBe('Application Window');
    expect(formatDisplaySurfaceLabel('browser')).toBe('Browser Tab');
  });

  it('wires Live screen share into the + AttachmentMenu and permits display-capture in netlify.toml', () => {
    const menuSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chat/AttachmentMenu.tsx'), 'utf8');
    expect(menuSrc).toContain('Live screen share');
    expect(menuSrc).toContain('LiveScreenShareModal');
    expect(menuSrc).toContain('MonitorUp');

    const netlifyToml = fs.readFileSync(path.resolve(process.cwd(), 'netlify.toml'), 'utf8');
    expect(netlifyToml).toContain('display-capture=(self)');
  });
});
