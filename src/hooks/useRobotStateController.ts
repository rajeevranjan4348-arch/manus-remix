import { useCallback, useEffect, useRef, useState } from 'react';

export type RobotState = 'idle' | 'thinking' | 'searching' | 'listening' | 'speaking' | 'working' | 'happy' | 'error' | 'sleeping';
export type RobotEvent =
  | 'USER_TYPING' | 'USER_SUBMITTED' | 'AI_GENERATION_STARTED' | 'AI_GENERATION_ENDED'
  | 'SEARCH_STARTED' | 'SEARCH_ENDED' | 'TOOL_STARTED' | 'TOOL_COMPLETED'
  | 'VOICE_LISTENING_STARTED' | 'VOICE_LISTENING_STOPPED'
  | 'VOICE_PLAYBACK_STARTED' | 'VOICE_PLAYBACK_ENDED'
  | 'TASK_SUCCEEDED' | 'TASK_FAILED' | 'USER_ACTIVITY' | 'INACTIVITY_TIMEOUT';

type Activity = 'thinking' | 'searching' | 'listening' | 'speaking' | 'working' | null;
const ACTIVE_EVENTS: Record<string, Activity> = {
  USER_SUBMITTED: 'thinking', AI_GENERATION_STARTED: 'thinking',
  SEARCH_STARTED: 'searching', TOOL_STARTED: 'working',
  VOICE_LISTENING_STARTED: 'listening', VOICE_PLAYBACK_STARTED: 'speaking',
};
const PRIORITY: Record<Exclude<Activity, null>, number> = {
  thinking: 1, searching: 2, working: 3, listening: 4, speaking: 5,
};

export function resolveRobotState(input: {
  error: boolean; activity: Activity; happy: boolean; sleeping: boolean;
}): RobotState {
  if (input.error) return 'error';
  if (input.activity && PRIORITY[input.activity] >= 4) return input.activity;
  if (input.activity === 'working') return 'working';
  if (input.activity === 'searching') return 'searching';
  if (input.activity === 'thinking') return 'thinking';
  if (input.happy) return 'happy';
  return input.sleeping ? 'sleeping' : 'idle';
}

export function useRobotStateController(inactivityMs = 60_000) {
  const [state, setState] = useState<RobotState>('idle');
  const [draft, setDraft] = useState('');
  const activityRef = useRef<Activity>(null);
  const errorRef = useRef(false);
  const happyRef = useRef(false);
  const sleepingRef = useRef(false);
  const typingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const happyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const publish = useCallback(() => {
    if (mountedRef.current) setState(resolveRobotState({
      error: errorRef.current, activity: activityRef.current,
      happy: happyRef.current, sleeping: sleepingRef.current,
    }));
  }, []);

  const clearInactivity = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleInactivity = useCallback(() => {
    clearInactivity();
    if (activityRef.current || typingRef.current || typeof document === 'undefined' || document.hidden) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!activityRef.current && !typingRef.current && mountedRef.current) {
        sleepingRef.current = true;
        publish();
      }
    }, Math.max(5_000, inactivityMs));
  }, [clearInactivity, inactivityMs, publish]);

  const dispatch = useCallback((event: RobotEvent) => {
    if (event === 'USER_TYPING') {
      typingRef.current = true; sleepingRef.current = false; errorRef.current = false;
      if (typingPauseTimerRef.current) clearTimeout(typingPauseTimerRef.current);
      typingPauseTimerRef.current = setTimeout(() => {
        typingPauseTimerRef.current = null;
        typingRef.current = false;
        publish();
        scheduleInactivity();
      }, 1800);
      clearInactivity();
    } else if (event === 'USER_SUBMITTED' || event === 'AI_GENERATION_STARTED') {
      typingRef.current = false; sleepingRef.current = false; errorRef.current = false;
      activityRef.current = 'thinking';
    } else if (event === 'SEARCH_STARTED') activityRef.current = 'searching';
    else if (event === 'TOOL_STARTED') activityRef.current = 'working';
    else if (event === 'VOICE_LISTENING_STARTED') activityRef.current = 'listening';
    else if (event === 'VOICE_PLAYBACK_STARTED') activityRef.current = 'speaking';
    else if (event === 'VOICE_LISTENING_STOPPED' || event === 'VOICE_PLAYBACK_ENDED' ||
      event === 'AI_GENERATION_ENDED' || event === 'SEARCH_ENDED' || event === 'TOOL_COMPLETED') {
      activityRef.current = null;
    } else if (event === 'TASK_FAILED') {
      activityRef.current = null; errorRef.current = true; happyRef.current = false;
    } else if (event === 'TASK_SUCCEEDED') {
      activityRef.current = null; errorRef.current = false; happyRef.current = true;
      if (happyTimerRef.current) clearTimeout(happyTimerRef.current);
      happyTimerRef.current = setTimeout(() => {
        happyRef.current = false; publish(); scheduleInactivity();
      }, 1800);
    } else if (event === 'USER_ACTIVITY') {
      sleepingRef.current = false; errorRef.current = false;
      if (!activityRef.current) typingRef.current = false;
    } else if (event === 'INACTIVITY_TIMEOUT') {
      if (!activityRef.current && !typingRef.current) sleepingRef.current = true;
    }
    publish();
    if (!activityRef.current && !typingRef.current && event !== 'TASK_SUCCEEDED') scheduleInactivity();
    else clearInactivity();
  }, [clearInactivity, publish, scheduleInactivity]);

  const onDraftChange = useCallback((value: string) => {
    setDraft(value);
    if (value.length > 0) dispatch('USER_TYPING');
    else { typingRef.current = false; dispatch('USER_ACTIVITY'); }
  }, [dispatch]);

  useEffect(() => {
    mountedRef.current = true;
    const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    const onActivity = () => dispatch('USER_ACTIVITY');
    const onVisibility = () => {
      if (document.hidden) clearInactivity();
      else { sleepingRef.current = false; publish(); scheduleInactivity(); }
    };
    activityEvents.forEach(name => window.addEventListener(name, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    scheduleInactivity();
    return () => {
      mountedRef.current = false;
      clearInactivity();
      if (happyTimerRef.current) clearTimeout(happyTimerRef.current);
      if (typingPauseTimerRef.current) clearTimeout(typingPauseTimerRef.current);
      activityEvents.forEach(name => window.removeEventListener(name, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clearInactivity, dispatch, publish, scheduleInactivity]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<RobotEvent>).detail;
      if (detail) dispatch(detail);
    };
    window.addEventListener('manus_robot_event', listener);
    return () => window.removeEventListener('manus_robot_event', listener);
  }, [dispatch]);

  return { state, draft, onDraftChange, dispatch };
}

export function emitRobotEvent(event: RobotEvent) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('manus_robot_event', { detail: event }));
}
