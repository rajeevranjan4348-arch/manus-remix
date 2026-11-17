import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@blinkdotnew/react', () => ({
  useBlinkAuth: () => ({ isAuthenticated: false, user: null }),
  useAgent: () => ({ messages: [], isLoading: false, sendMessage: vi.fn() }),
  Agent: class Agent {},
  webSearch: {},
  fetchUrl: {},
  sandboxTools: [],
}));

import { useAgentTask } from '../src/hooks/useAgentTask';

function StartupProbe() {
  const { taskStatus, messages } = useAgentTask();
  return React.createElement('div', null, `${taskStatus}:${messages.length}`);
}

describe('app startup', () => {
  it('renders the task hook in its initial idle state without crashing', () => {
    expect(renderToString(React.createElement(StartupProbe))).toContain('idle:0');
  });
});
