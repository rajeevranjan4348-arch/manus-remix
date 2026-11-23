import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  longTermMemory,
  detectExplicitMemoryIntent,
  isGreetingOrSmallTalk,
  isExplicitMemoryRecallQuery,
  isPersonalSelfReferenceQuery,
  formatRelevantMemoryBlock,
  MEMORY_BEHAVIOR_POLICY,
} from '../src/lib/longTermMemory';
import {
  generateResilientResponse,
  stripInjectedContextBlocks,
  SERVER_MEMORY_BEHAVIOR_POLICY,
} from '../server/geminiService';

const rootDir = process.cwd();
const readRepoFile = (relPath: string) =>
  fs.readFileSync(path.join(rootDir, relPath), 'utf-8');

describe('Deku AI — Memory Injection Fix (Tests A, B, C, D)', () => {
  const testUserId = 'usr_test_memory_injection_audit';

  beforeEach(async () => {
    longTermMemory.invalidateCache(testUserId);
    await longTermMemory.clearAllMemories(testUserId);

    // Seed realistic saved memories (including favourite character = Leon + unrelated preferences)
    await longTermMemory.addMemory({
      userId: testUserId,
      category: 'preference',
      key: 'Favourite character',
      value: 'Leon',
      source: 'user_explicit',
      isEnabled: true,
    });
    await longTermMemory.addMemory({
      userId: testUserId,
      category: 'preference',
      key: 'Favourite color',
      value: 'Midnight Blue',
      source: 'user_explicit',
      isEnabled: true,
    });
    await longTermMemory.addMemory({
      userId: testUserId,
      category: 'fact',
      key: 'Timezone',
      value: 'IST (Asia/Kolkata)',
      source: 'user_explicit',
      isEnabled: true,
    });
  });

  it('Test A: Greetings ("Hello", "Hi", "Hey", "Good morning") inject ZERO saved memories and produce natural greetings', async () => {
    const greetings = [
      'Hello',
      'Hello!',
      'Hi',
      'Hey',
      'Good morning',
      'Good evening!',
      'Hey Deku',
      'Hi there',
      'How are you?',
      'Thanks',
    ];

    for (const greeting of greetings) {
      expect(isGreetingOrSmallTalk(greeting)).toBe(true);
      const context = await longTermMemory.getRelevantContext(testUserId, greeting);
      expect(context).toBe('');
    }

    // Backend resilient greeting responds naturally without mentioning memories
    const reply = generateResilientResponse('Hello');
    expect(reply).toMatch(/hello/i);
    expect(reply).not.toMatch(/leon|favourite|favorite|memory|midnight blue|timezone/i);

    const morningReply = generateResilientResponse('Good morning');
    expect(morningReply).toMatch(/hello|help/i);
    expect(morningReply).not.toMatch(/leon|memory/i);
  });

  it('Test B: "Who is my favourite character?" retrieves ONLY the relevant saved memory (supports UK & US spelling)', async () => {
    const ukQuery = 'Who is my favourite character?';
    const usQuery = 'Who is my favorite character?';

    expect(isGreetingOrSmallTalk(ukQuery)).toBe(false);
    expect(isPersonalSelfReferenceQuery(ukQuery)).toBe(true);
    expect(isExplicitMemoryRecallQuery(ukQuery)).toBe(false);

    const ukContext = await longTermMemory.getRelevantContext(testUserId, ukQuery);
    expect(ukContext).toContain('Favourite character');
    expect(ukContext).toContain('Leon');
    // Must NOT pull in unrelated memories like Favourite color or Timezone
    expect(ukContext).not.toContain('Midnight Blue');
    expect(ukContext).not.toContain('Timezone');

    const usContext = await longTermMemory.getRelevantContext(testUserId, usQuery);
    expect(usContext).toContain('Favourite character');
    expect(usContext).toContain('Leon');
    expect(usContext).not.toContain('Midnight Blue');
    expect(usContext).not.toContain('Timezone');

    const formatted = formatRelevantMemoryBlock(ukContext, false);
    expect(formatted).toContain('[SILENT USER MEMORY CONTEXT');
    expect(formatted).toContain('Leon');
    expect(formatted).toContain('do not announce that a memory was saved or retrieved');
  });

  it('Test C: "Tell me about Leon." does NOT inject personal memories or unrelated preferences', async () => {
    const generalQueries = [
      'Tell me about Leon.',
      'Tell me about Leon Kennedy.',
      'Who is Leon S. Kennedy?',
      'Explain how React hooks work.',
      'Give me a summary of TypeScript generics.',
    ];

    for (const q of generalQueries) {
      expect(isPersonalSelfReferenceQuery(q)).toBe(false);
      expect(isExplicitMemoryRecallQuery(q)).toBe(false);
      const context = await longTermMemory.getRelevantContext(testUserId, q);
      expect(context).toBe('');
    }
  });

  it('Test D: "What do you remember about me?" returns all active saved memories cleanly', async () => {
    const recallQueries = [
      'What do you remember about me?',
      'What do you know about me?',
      'Show my saved memories',
      'List all my memories',
    ];

    for (const q of recallQueries) {
      expect(isExplicitMemoryRecallQuery(q)).toBe(true);
      expect(detectExplicitMemoryIntent(q).matched).toBe(false);
      const context = await longTermMemory.getRelevantContext(testUserId, q);
      expect(context).toContain('Favourite character: Leon');
      expect(context).toContain('Favourite color: Midnight Blue');
      expect(context).toContain('Timezone: IST (Asia/Kolkata)');
    }

    const context = await longTermMemory.getRelevantContext(testUserId, 'What do you remember about me?');
    const formatted = formatRelevantMemoryBlock(context, true);
    expect(formatted).toContain('[USER SAVED MEMORIES — EXPLICIT RECALL REQUEST]');
    expect(formatted).toContain('Favourite character: Leon');
  });

  it('Does not dump older memories during explicit save/clear turns', async () => {
    const context = await longTermMemory.getRelevantContext(
      testUserId,
      'Remember that my favorite movie is Interstellar'
    );
    expect(context).toBe('');
  });

  it('Strips injected memory blocks on the server before intent/greeting routing', () => {
    const raw =
      'Hello\n\n[SILENT USER MEMORY CONTEXT — USE ONLY IF DIRECTLY RELEVANT]\n- [PREFERENCE] Favourite character: Leon';
    expect(stripInjectedContextBlocks(raw)).toBe('Hello');
    expect(generateResilientResponse(raw)).toBe('Hello! How can I help you today?');
  });

  it('Wires MEMORY_BEHAVIOR_POLICY across frontend callers and both Express & Netlify backends', () => {
    expect(MEMORY_BEHAVIOR_POLICY).toContain('[MEMORY USAGE POLICY]');
    expect(MEMORY_BEHAVIOR_POLICY).toContain('NEVER bring up, mention, or allude to saved memories');
    expect(SERVER_MEMORY_BEHAVIOR_POLICY).toContain('[MEMORY USAGE POLICY]');

    const useAgentTask = readRepoFile('src/hooks/useAgentTask.ts');
    expect(useAgentTask).toContain('MEMORY_BEHAVIOR_POLICY');
    expect(useAgentTask).toContain('formatRelevantMemoryBlock');
    expect(useAgentTask).not.toContain('[USER SAVED PREFERENCES & FACTUAL MEMORY]');

    const myAiChat = readRepoFile('src/components/chat/MyAIChat.tsx');
    expect(myAiChat).toContain('MEMORY_BEHAVIOR_POLICY');
    expect(myAiChat).toContain('formatRelevantMemoryBlock');
    expect(myAiChat).toContain('systemInstruction');
    expect(myAiChat).not.toContain('[USER SAVED PREFERENCES & FACTUAL MEMORY]');

    const voiceModal = readRepoFile('src/components/voice/VoiceCallModal.tsx');
    expect(voiceModal).toContain('Deku AI');
    expect(voiceModal).toContain('MEMORY_BEHAVIOR_POLICY');
    expect(voiceModal).toContain('formatRelevantMemoryBlock');

    const geminiService = readRepoFile('server/geminiService.ts');
    expect(geminiService).toContain('SERVER_MEMORY_BEHAVIOR_POLICY');
    expect(geminiService).toContain('stripInjectedContextBlocks');

    const netlifyAgent = readRepoFile('netlify/functions/agent.ts');
    expect(netlifyAgent).toContain('[MEMORY USAGE POLICY]');
    expect(netlifyAgent).toContain('SILENT USER MEMORY CONTEXT');
  });
});

describe('Deku AI — Global Branding Verification', () => {
  it('Removes remaining user-facing and backend Manus branding references', () => {
    expect(readRepoFile('index.html')).toContain('Deku AI');
    expect(readRepoFile('index.html')).not.toMatch(/Manus/i);

    expect(readRepoFile('public/manifest.json')).toContain('Deku AI');
    expect(readRepoFile('public/manifest.json')).not.toMatch(/Manus/i);

    expect(readRepoFile('metadata.json')).toContain('Deku AI');
    expect(readRepoFile('metadata.json')).not.toMatch(/Manus/i);

    expect(readRepoFile('src/components/history/HistoryPanel.tsx')).toContain('deku-conversation-backup-');
    expect(readRepoFile('src/components/history/HistoryPanel.tsx')).not.toContain('manus-conversation-backup-');

    expect(readRepoFile('src/components/agent/ConversationActionBar.tsx')).toContain('deku-response-');
    expect(readRepoFile('src/components/agent/ConversationActionBar.tsx')).not.toContain('manus-response-');

    expect(readRepoFile('src/db/users.ts')).toContain('@deku.user');
    expect(readRepoFile('src/db/users.ts')).not.toContain('@manus.user');

    expect(readRepoFile('server/cloudSqlRoutes.ts')).toContain('@deku.user');
    expect(readRepoFile('server/cloudSqlRoutes.ts')).not.toContain('@manus.user');

    expect(readRepoFile('server/rtie/researchOrchestrator.ts')).toContain('https://deku.ai/rtie');
    expect(readRepoFile('server/rtie/researchOrchestrator.ts')).not.toContain('manus.im');

    expect(readRepoFile('server/connectorsService.ts')).toContain('https://deku.ai');
    expect(readRepoFile('server/connectorsService.ts')).not.toContain('manus.im');

    expect(readRepoFile('netlify/functions/web-search.ts')).toContain('https://deku.local');
    expect(readRepoFile('netlify/functions/web-search.ts')).not.toContain('manus.local');

    expect(readRepoFile('src/components/layout/Logo.tsx')).toContain('>deku<');
    expect(readRepoFile('src/components/layout/Topbar.tsx')).toContain('Deku 1.6 Lite');
    expect(readRepoFile('src/components/layout/Topbar.tsx')).toContain('Deku 1.6 Max');
  });
});
