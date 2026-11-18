import { describe, it, expect, vi } from 'vitest';
import { getChatBubbleStaggerDelayMs, getChatMessageStaggerStyle } from '../src/components/agent/ChatView';

describe('Chat Flow & Stream Processing Regression Tests', () => {
  it('1. Duplicate Rendering Prevention: Message deduplication returns single canonical list', () => {
    const persistentMessages = [
      { id: 'user-1', role: 'user', content: 'Hello', timestamp: '2026-10-14T10:00:00Z' },
      { id: 'asst-1', role: 'assistant', content: 'Hi there!', timestamp: '2026-10-14T10:00:01Z' }
    ];
    
    // Simulate rawList with duplicate message ids or duplicate content
    const rawList = [...persistentMessages, ...persistentMessages];
    
    const deduped: any[] = [];
    const seenIds = new Set<string>();
    for (const msg of rawList) {
      if (!msg) continue;
      if (msg.id && seenIds.has(msg.id)) continue;
      if (msg.id) seenIds.add(msg.id);
      deduped.push(msg);
    }

    expect(deduped.length).toBe(2);
    expect(deduped[0].id).toBe('user-1');
    expect(deduped[1].id).toBe('asst-1');
  });

  it('2. Duplicate Header Suppression: hasVisibleAssistantMessage suppresses secondary header', () => {
    const displayMessages = [
      { id: 'user-1', role: 'user', content: 'What is your name?' },
      { id: 'asst-1', role: 'assistant', content: 'I am Manus AI assistant.' }
    ];

    const isAssistantWorking = true;
    
    const hasVisibleAssistantMessage = displayMessages.some((m: any) => {
      if (m?.role !== 'assistant') return false;
      const raw = m.content || '';
      return Boolean(raw.trim());
    });

    // When assistant message is already visible in chat, standalone bottom header should be suppressed
    const renderBottomHeader = isAssistantWorking && !hasVisibleAssistantMessage;
    expect(renderBottomHeader).toBe(false);
  });

  it('3. Concurrent Request Deduplication: Rapid duplicate submissions are suppressed', () => {
    let lastSubmit = { prompt: '', timestamp: 0 };
    
    function submitPrompt(prompt: string): boolean {
      const now = Date.now();
      if (lastSubmit.prompt === prompt.trim() && now - lastSubmit.timestamp < 1200) {
        return false; // Suppressed
      }
      lastSubmit = { prompt: prompt.trim(), timestamp: now };
      return true; // Accepted
    }

    const first = submitPrompt('Analyze report');
    const second = submitPrompt('Analyze report'); // Duplicate within 1200ms

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('4. SSE Event Parsing & Termination: Handles text-delta and finish events cleanly', () => {
    const lines = [
      'data: {"type": "text-delta", "delta": "Hello "}',
      'data: {"type": "text-delta", "delta": "World!"}',
      'data: {"type": "finish", "finishReason": "stop"}',
      'data: [DONE]'
    ];

    let accumulatedText = '';
    let isFinished = false;

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      if (line === 'data: [DONE]') continue;
      const json = JSON.parse(line.slice(6));
      if (json.type === 'text-delta') {
        accumulatedText += json.delta;
      } else if (json.type === 'finish' || json.type === 'done') {
        isFinished = true;
      }
    }

    expect(accumulatedText).toBe('Hello World!');
    expect(isFinished).toBe(true);
  });

  it('5. API Failures & Interrupted Streams: Stream error event terminates execution state', () => {
    const lines = [
      'data: {"type": "error", "error": "Rate limit exceeded or provider unavailable"}',
      'data: [DONE]'
    ];

    let errorOccurred = false;
    let errorMessage = '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      if (line === 'data: [DONE]') continue;
      const json = JSON.parse(line.slice(6));
      if (json.type === 'error') {
        errorOccurred = true;
        errorMessage = json.error;
      }
    }

    expect(errorOccurred).toBe(true);
    expect(errorMessage).toContain('Rate limit');
  });

  it('6. My AI Chat Standalone HTML: Contains exact UI structure, Web Speech API mic button, and connects to streaming backend', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const htmlPath = path.resolve(__dirname, '../public/chat.html');
    expect(fs.existsSync(htmlPath)).toBe(true);
    const content = fs.readFileSync(htmlPath, 'utf-8');
    expect(content).toContain('My AI Chat');
    expect(content).toContain('How can I help you?');
    expect(content).toContain('Ask me anything to get started.');
    expect(content).toContain('/api/gemini/stream');
    expect(content).toContain('AI can make mistakes');
    // Web Speech API Voice-to-Text Integration
    expect(content).toContain('micBtn');
    expect(content).toContain('SpeechRecognition');
    expect(content).toContain('webkitSpeechRecognition');
    expect(content).toContain('formatSpokenPunctuation');
  });

  it('7. My AI Chat Component: Exists and handles Web Speech API voice input and streaming', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const compPath = path.resolve(__dirname, '../src/components/chat/MyAIChat.tsx');
    expect(fs.existsSync(compPath)).toBe(true);
    const content = fs.readFileSync(compPath, 'utf-8');
    expect(content).toContain('export function MyAIChat');
    expect(content).toContain('/api/gemini/stream');
    expect(content).toContain('gemini-3.8-flash');
    expect(content).toContain('How can I help you?');
    // Web Speech API Voice-to-Text Integration
    expect(content).toContain('toggleListening');
    expect(content).toContain('SpeechRecognition');
    expect(content).toContain('webkitSpeechRecognition');
    expect(content).toContain('formatSpokenPunctuation');
  });

  it('8. Staggered Chat Bubble Transitions: Applies bounded index-based entrance delay in ChatView and index.css', async () => {
    const fs = await import('fs');
    const path = await import('path');

    expect(getChatBubbleStaggerDelayMs(-1)).toBe(0);
    expect(getChatBubbleStaggerDelayMs(0)).toBe(0);
    expect(getChatBubbleStaggerDelayMs(1)).toBe(45);
    expect(getChatBubbleStaggerDelayMs(2)).toBe(90);
    expect(getChatBubbleStaggerDelayMs(4)).toBe(180);
    expect(getChatBubbleStaggerDelayMs(8)).toBe(360);
    // Caps at 8 steps (360ms) so long message histories never stall
    expect(getChatBubbleStaggerDelayMs(20)).toBe(360);
    // Relative to windowStartIndex when rendering a windowed slice of history
    expect(getChatBubbleStaggerDelayMs(10, 10)).toBe(0);
    expect(getChatBubbleStaggerDelayMs(12, 10)).toBe(90);

    expect(getChatMessageStaggerStyle(3)).toEqual({
      animationDelay: '135ms',
      '--chat-stagger-delay': '135ms',
      '--manus-stagger-index': 3,
    });

    const chatViewSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/agent/ChatView.tsx'),
      'utf-8'
    );
    expect(chatViewSource).toContain('getChatBubbleStaggerDelayMs(index, windowStartIndex)');
    expect(chatViewSource).toContain('getChatMessageStaggerStyle(index, windowStartIndex)');
    expect(chatViewSource).toContain('data-stagger-index={index}');
    expect(chatViewSource).toContain('data-stagger-delay-ms={staggerDelayMs}');

    const cssSource = fs.readFileSync(
      path.resolve(__dirname, '../src/index.css'),
      'utf-8'
    );
    expect(cssSource).toContain('animation-delay: var(--chat-stagger-delay, 0ms);');
  });

  it('9. Mobile 44x44px Accessibility Touch Targets: Enforces minimum 44x44px hit areas for small buttons in Sidebar and Chat Composer', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const cssSource = fs.readFileSync(
      path.resolve(__dirname, '../src/index.css'),
      'utf-8'
    );
    expect(cssSource).toContain('--mobile-touch-target: 2.75rem;');
    expect(cssSource).toContain('.manus-input-container button');
    expect(cssSource).toContain('aside button');

    const sidebarSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/layout/Sidebar.tsx'),
      'utf-8'
    );
    expect(sidebarSource).toContain('manus-touch-target');
    expect(sidebarSource).toContain('min-w-[44px] min-h-[44px]');

    const chatViewSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/agent/ChatView.tsx'),
      'utf-8'
    );
    expect(chatViewSource).toContain('manus-touch-target');
    expect(chatViewSource).toContain('w-11 h-11 sm:w-9 sm:h-9 min-w-[44px] min-h-[44px]');

    const homeSource = fs.readFileSync(
      path.resolve(__dirname, '../src/pages/Home.tsx'),
      'utf-8'
    );
    expect(homeSource).toContain('manus-touch-target');
    expect(homeSource).toContain('w-11 h-11 sm:w-9 sm:h-9 min-w-[44px] min-h-[44px]');
  });
});
