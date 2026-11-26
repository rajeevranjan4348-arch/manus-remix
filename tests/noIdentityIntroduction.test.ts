import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDekuIdentitySystemInstruction,
  createLeadingIntroStreamFilter,
  isGreetingPrompt,
  isIdentityQuestionPrompt,
  stripLeadingUnsolicitedIdentityIntro,
} from '../server/modelIdentity';
import { generateResilientResponse } from '../server/geminiService';

const ROOT = process.cwd();

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function runStreamFilter(userPrompt: string, chunks: string[]): string {
  const filter = createLeadingIntroStreamFilter(userPrompt);
  let output = '';
  for (const chunk of chunks) {
    output += filter.push(chunk);
  }
  output += filter.flush();
  return output;
}

describe('Deku AI — Unwanted Identity Introduction Root-Cause Fix', () => {
  it('removes "Always introduce yourself" from buildDekuIdentitySystemInstruction and enforces direct answers', () => {
    const policy = buildDekuIdentitySystemInstruction(null);
    expect(policy).not.toMatch(/Always introduce yourself/i);
    expect(policy).toMatch(/Answer the user's actual question directly/i);
    expect(policy).toMatch(/NEVER prepend unsolicited greetings, self-introductions, or product descriptions/i);
    expect(policy).toMatch(/ONLY when the user greets you/i);
    expect(policy).toMatch(/ONLY when the user explicitly asks who you are/i);
  });

  it('removes automatic identity introduction directives across Chat, Work, Voice, local server, and Netlify pipelines', () => {
    const filesToCheck = [
      'src/hooks/useAgentTask.ts',
      'src/components/chat/MyAIChat.tsx',
      'src/components/voice/VoiceCallModal.tsx',
      'server/modelIdentity.ts',
      'server/geminiService.ts',
      'netlify/functions/agent.ts',
      'vite.config.ts',
    ];

    for (const relPath of filesToCheck) {
      const source = readProjectFile(relPath);
      expect(source, `${relPath} must not contain "Always introduce yourself"`).not.toMatch(
        /Always introduce yourself/i,
      );
    }

    const netlifyAgent = readProjectFile('netlify/functions/agent.ts');
    expect(netlifyAgent).not.toContain('[VERIFIED MODEL & APPLICATION IDENTITY]');
    expect(netlifyAgent).toContain('createLeadingIntroStreamFilter');

    const viteConfig = readProjectFile('vite.config.ts');
    expect(viteConfig).toContain('stripLeadingUnsolicitedIdentityIntro');
    expect(viteConfig).toContain('buildDekuIdentitySystemInstruction');
  });

  it('strips unsolicited identity introductions from normal factual questions (non-streaming)', () => {
    const expectedAnswer =
      'Zahir-ud-din Muhammad Babur was the founder of the Mughal Empire in India. He established Mughal rule after the First Battle of Panipat in 1526.';

    const variants = [
      `Hello! I am Deku AI, your independent workspace assistant.\n\n${expectedAnswer}`,
      `Hello! I am **Deku AI**, your independent AI workspace assistant. ${expectedAnswer}`,
      `Hi, I'm Deku AI, an independent workspace assistant. ${expectedAnswer}`,
      `I am Deku AI, your independent workspace assistant.\n${expectedAnswer}`,
      `Hello! I am Deku AI, your independent workspace assistant. How can I help you today? ${expectedAnswer}`,
    ];

    for (const raw of variants) {
      expect(stripLeadingUnsolicitedIdentityIntro(raw, "Who's Babur?")).toBe(expectedAnswer);
    }
  });

  it('matches streaming and non-streaming behavior for Chat mode and Work mode (including <think> blocks)', () => {
    const userPrompt = "Who's Babur?";
    const expectedAnswer =
      'Zahir-ud-din Muhammad Babur was the founder of the Mughal Empire in India. He established Mughal rule after the First Battle of Panipat in 1526.';

    // Chat mode split across awkward token boundaries
    const chatStreamed = runStreamFilter(userPrompt, [
      'He',
      'llo! I am ',
      'Deku AI, your independent ',
      'workspace assistant.\n\nZa',
      'hir-ud-din Muhammad Babur ',
      'was the founder of the Mughal Empire in India. He established Mughal rule after the First Battle of Panipat in 1526.',
    ]);
    expect(chatStreamed).toBe(expectedAnswer);

    // Work mode with leading <think> summary followed by an unsolicited intro
    const workRaw = `<think>Recall Mughal dynasty founding details.</think>\nHello! I am Deku AI, your independent workspace assistant. ${expectedAnswer}`;
    const workNonStreamed = stripLeadingUnsolicitedIdentityIntro(workRaw, `[MODE: WORK] ${userPrompt}`);
    const workStreamed = runStreamFilter(`[MODE: WORK] ${userPrompt}`, [
      '<thi',
      'nk>Recall Mughal dynasty ',
      'founding details.</think>\n',
      'Hello! I am Deku AI, ',
      'your independent workspace assistant. ',
      expectedAnswer,
    ]);
    expect(workNonStreamed).toBe(`<think>Recall Mughal dynasty founding details.</think>\n${expectedAnswer}`);
    expect(workStreamed).toBe(`<think>Recall Mughal dynasty founding details.</think>${expectedAnswer}`);
  });

  it('streams normal direct answers immediately with zero buffering and no false positives', () => {
    const filter = createLeadingIntroStreamFilter("Who's Babur?");
    const firstChunk = 'Zahir-ud-din Muhammad Babur ';
    expect(filter.push(firstChunk)).toBe(firstChunk);
    expect(filter.push('was the founder of the Mughal Empire.')).toBe(
      'was the founder of the Mughal Empire.',
    );
    expect(filter.flush()).toBe('');

    // False-positive checks
    expect(
      runStreamFilter('Explain photography specs', ['Hi-resolution ', 'sensors capture more detail.']),
    ).toBe('Hi-resolution sensors capture more detail.');

    expect(
      runStreamFilter('Write a Python hello world example', [
        'Hello world ',
        'is typically written as `print("Hello, world!")`.',
      ]),
    ).toBe('Hello world is typically written as `print("Hello, world!")`.');

    expect(
      runStreamFilter('Explain closures', ['I am going to ', 'walk through lexical scope step by step.']),
    ).toBe('I am going to walk through lexical scope step by step.');
  });

  it('preserves legitimate greetings when contextually appropriate', () => {
    for (const greeting of ['Hello', 'Hi!', 'Hey Deku AI', 'Good morning']) {
      expect(isGreetingPrompt(greeting)).toBe(true);
      const reply = 'Hello! How can I help you today?';
      expect(stripLeadingUnsolicitedIdentityIntro(reply, greeting)).toBe(reply);
      expect(runStreamFilter(greeting, ['Hello! ', 'How can I help you today?'])).toBe(reply);
    }

    expect(isGreetingPrompt("Who's Babur?")).toBe(false);
    expect(generateResilientResponse('Hello')).toBe('Hello! How can I help you today?');
  });

  it('preserves identity responses when the user explicitly asks who the assistant is', () => {
    for (const q of ['Who are you?', 'Introduce yourself', 'What can you do?', 'What is Deku AI?']) {
      expect(isIdentityQuestionPrompt(q)).toBe(true);
      const identityReply = 'I am **Deku AI**, an independent AI workspace assistant.';
      expect(stripLeadingUnsolicitedIdentityIntro(identityReply, q)).toBe(identityReply);
      expect(runStreamFilter(q, ['I am **Deku AI**, ', 'an independent AI workspace assistant.'])).toBe(
        identityReply,
      );
    }

    expect(isIdentityQuestionPrompt("Who's Babur?")).toBe(false);
    expect(generateResilientResponse('Who are you?')).toContain('Deku AI');
  });

  it('never prepends an identity introduction in fallback answers for normal questions', () => {
    const answer = generateResilientResponse("Who's Babur?", [{ role: 'user', content: "Who's Babur?" }]);
    expect(answer).not.toMatch(/Hello!\s*I am Deku AI/i);
    expect(answer).not.toMatch(/independent(?: AI)? workspace assistant/i);

    const codeAnswer = generateResilientResponse('Write a TypeScript function to sum numbers');
    expect(codeAnswer).not.toMatch(/Hello!\s*I am Deku AI/i);
    expect(codeAnswer).not.toMatch(/independent(?: AI)? workspace assistant/i);
  });
});
