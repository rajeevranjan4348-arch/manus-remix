export type RobotHeadState =
  | 'idle'
  | 'thinking'
  | 'searching'
  | 'listening'
  | 'speaking'
  | 'working'
  | 'happy'
  | 'error'
  | 'sleeping';

export type RobotHeadShape = 'rectangle' | 'square' | 'circle' | 'hexagon';

export const ROBOT_ANIMATION_CYCLE: RobotHeadState[] = [
  'idle',
  'thinking',
  'happy',
  'searching',
  'working',
  'listening',
  'speaking',
  'sleeping',
];

export const AMBIENT_ROBOT_EXPRESSION_SEQUENCE: {
  state: RobotHeadState;
  durationMs: number;
}[] = [
  { state: 'idle', durationMs: 4200 },
  { state: 'thinking', durationMs: 2800 },
  { state: 'idle', durationMs: 3600 },
  { state: 'happy', durationMs: 2600 },
  { state: 'idle', durationMs: 4000 },
  { state: 'searching', durationMs: 2500 },
  { state: 'idle', durationMs: 3800 },
  { state: 'working', durationMs: 2600 },
  { state: 'happy', durationMs: 2200 },
];

export function getNextCycledRobotState(current: RobotHeadState): RobotHeadState {
  const idx = ROBOT_ANIMATION_CYCLE.indexOf(current);
  if (idx === -1) return 'happy';
  return ROBOT_ANIMATION_CYCLE[(idx + 1) % ROBOT_ANIMATION_CYCLE.length];
}

export interface ContextualRobotStateParams {
  baseState: RobotHeadState;
  manualOverrideState?: RobotHeadState | null;
  ambientState?: RobotHeadState | null;
  isHappyExpression?: boolean;
  isExtracting?: boolean;
  isListening?: boolean;
  isThinkHarder?: boolean;
  isTypingPrompt?: boolean;
  promptText?: string;
  activeIntentLabel?: string | null;
  chatWorkMode?: 'chat' | 'work';
}

/**
 * Resolves the active RobotHead animation state from user interactions, prompt context, and ambient animations.
 */
export function resolveContextualRobotState(params: ContextualRobotStateParams): RobotHeadState {
  const {
    baseState,
    manualOverrideState,
    ambientState,
    isHappyExpression,
    isExtracting,
    isListening,
    isThinkHarder,
    isTypingPrompt,
    promptText = '',
    activeIntentLabel,
    chatWorkMode,
  } = params;

  if (manualOverrideState) {
    return manualOverrideState;
  }

  if (isHappyExpression) {
    return 'happy';
  }

  if (isListening) {
    return 'listening';
  }

  if (isExtracting) {
    return 'thinking';
  }

  if (isTypingPrompt && promptText.trim().length > 0) {
    const clean = promptText.trim().toLowerCase();
    if (/\b(hi|hello|hey|thanks|thank you|awesome|great|good|love|nice|happy)\b/.test(clean)) {
      return 'happy';
    }
    if (/\b(search|find|look up|where|who is|news|latest|research)\b/.test(clean)) {
      return 'searching';
    }
    if (/\b(build|create|code|write|generate|make|design|fix)\b/.test(clean)) {
      return 'working';
    }
    return 'thinking';
  }

  if (isThinkHarder) {
    return 'thinking';
  }

  if (activeIntentLabel === 'Research' || activeIntentLabel === 'Research link') {
    return 'searching';
  }

  if (activeIntentLabel === 'Build website' || activeIntentLabel === 'Data analysis') {
    return 'working';
  }

  if (baseState && baseState !== 'idle') {
    return baseState;
  }

  if (chatWorkMode === 'work' && (!ambientState || ambientState === 'idle')) {
    return 'working';
  }

  if (ambientState) {
    return ambientState;
  }

  return baseState || 'idle';
}
