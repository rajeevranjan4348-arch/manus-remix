import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, ChevronDown, Circle, Clock3, Loader2, X } from 'lucide-react';
import {
  AGENT_ACTIVITY_EVENT,
  AGENT_ACTIVITY_CANCEL_EVENT,
  AgentActivityEvent,
  AgentActivityStatus,
  mergeAgentActivityEvent,
  parseAgentActivityEvent,
} from '@/lib/agentActivity';
import './AgentActivityFeed.css';

interface AgentActivityFeedProps {
  taskId?: string | null;
}

const ACTIVE_STATUSES = new Set<AgentActivityStatus>(['queued', 'running']);
const CACHE_VERSION = 'v1';
const MAX_VISIBLE_ITEMS = 12;
const ACTIVITY_STALE_AFTER_MS = 180_000;

function storageKey(taskId: string): string {
  return `agent-activity:${CACHE_VERSION}:${encodeURIComponent(taskId)}`;
}

function readCachedActivities(taskId?: string | null): AgentActivityEvent[] {
  if (!taskId || typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(storageKey(taskId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(parseAgentActivityEvent).filter((event: AgentActivityEvent | null): event is AgentActivityEvent => Boolean(event && event.taskId === taskId)).slice(-MAX_VISIBLE_ITEMS)
      : [];
  } catch {
    return [];
  }
}

function statusIcon(status: AgentActivityStatus) {
  if (status === 'running') return <Loader2 className="agent-activity-spin" size={13} aria-hidden="true" />;
  if (status === 'completed') return <Check size={13} aria-hidden="true" />;
  if (status === 'failed') return <AlertCircle size={13} aria-hidden="true" />;
  if (status === 'cancelled') return <X size={13} aria-hidden="true" />;
  return <Clock3 size={13} aria-hidden="true" />;
}

function statusLabel(status: AgentActivityStatus): string {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Running';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  return 'Cancelled';
}

export function AgentActivityFeed({ taskId }: AgentActivityFeedProps) {
  const [activities, setActivities] = useState<AgentActivityEvent[]>(() => readCachedActivities(taskId));
  const [expanded, setExpanded] = useState(true);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const cancelledRequestIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    cancelledRequestIdsRef.current.clear();
    setActivities(readCachedActivities(taskId));
    setExpanded(true);
    setExpandedDetails({});
  }, [taskId]);

  useEffect(() => {
    if (!taskId || typeof window === 'undefined') return;
    const handleActivity = (event: Event) => {
      const activity = parseAgentActivityEvent((event as CustomEvent).detail);
      if (!activity || activity.taskId !== taskId) return;
      const cancelledRequestId = Array.from(cancelledRequestIdsRef.current)
        .find(requestId => activity.activityId.startsWith(`${requestId}:`));
      const safeActivity = cancelledRequestId && ACTIVE_STATUSES.has(activity.status)
        ? {
            ...activity,
            eventId: `cancel:${Date.now().toString(36)}:${activity.activityId}`.slice(0, 160),
            status: 'cancelled' as const,
            description: 'This activity was stopped by the user.',
            errorStatus: 'user_cancelled',
          }
        : activity;
      setActivities(previous => {
        const next = mergeAgentActivityEvent(previous, safeActivity, MAX_VISIBLE_ITEMS);
        if (next !== previous) {
          try { sessionStorage.setItem(storageKey(taskId), JSON.stringify(next)); } catch {}
        }
        return next;
      });
    };
    const handleCancellation = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (!detail || detail.taskId !== taskId || typeof detail.requestId !== 'string') return;
      cancelledRequestIdsRef.current.add(detail.requestId);
      while (cancelledRequestIdsRef.current.size > 20) {
        const oldest = cancelledRequestIdsRef.current.values().next().value;
        if (oldest) cancelledRequestIdsRef.current.delete(oldest);
        else break;
      }
      setActivities(previous => {
        let next = previous;
        for (const activity of previous) {
          if (!ACTIVE_STATUSES.has(activity.status) || !activity.activityId.startsWith(`${detail.requestId}:`)) continue;
          next = mergeAgentActivityEvent(next, {
            ...activity,
            eventId: `cancel:${Date.now().toString(36)}:${detail.requestId}:${activity.activityId}`.slice(0, 160),
            timestamp: new Date().toISOString(),
            status: 'cancelled',
            description: 'This activity was stopped by the user.',
            errorStatus: 'user_cancelled',
          }, MAX_VISIBLE_ITEMS);
        }
        try { sessionStorage.setItem(storageKey(taskId), JSON.stringify(next)); } catch {}
        return next;
      });
    };
    window.addEventListener(AGENT_ACTIVITY_EVENT, handleActivity);
    window.addEventListener(AGENT_ACTIVITY_CANCEL_EVENT, handleCancellation);
    return () => {
      window.removeEventListener(AGENT_ACTIVITY_EVENT, handleActivity);
      window.removeEventListener(AGENT_ACTIVITY_CANCEL_EVENT, handleCancellation);
    };
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const active = activities.filter(item => ACTIVE_STATUSES.has(item.status));
    if (!active.length) return;
    const oldestExpiry = Math.min(...active.map(item => Date.parse(item.timestamp) + ACTIVITY_STALE_AFTER_MS));
    const delay = Math.max(0, oldestExpiry - Date.now());
    const timer = setTimeout(() => {
      setActivities(previous => {
        let next = previous;
        for (const item of previous.filter(entry => ACTIVE_STATUSES.has(entry.status))) {
          if (Date.now() - Date.parse(item.timestamp) < ACTIVITY_STALE_AFTER_MS) continue;
          next = mergeAgentActivityEvent(next, {
            ...item,
            eventId: `interrupted:${Date.now().toString(36)}:${item.activityId}`.slice(0, 160),
            timestamp: new Date().toISOString(),
            status: 'failed',
            description: 'No completion signal arrived for this activity; its status may be incomplete.',
            errorStatus: 'completion_signal_missing',
          }, MAX_VISIBLE_ITEMS);
        }
        try { sessionStorage.setItem(storageKey(taskId), JSON.stringify(next)); } catch {}
        return next;
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [activities, taskId]);

  const latestRunning = useMemo(
    () => [...activities].reverse().find(item => ACTIVE_STATUSES.has(item.status)),
    [activities]
  );
  const currentActivity = latestRunning || activities[activities.length - 1];
  if (!taskId || !currentActivity) return null;

  return (
    <section className="agent-activity-feed" data-testid="agent-activity-feed" aria-label="Agent activity">
      <button
        type="button"
        className="agent-activity-header"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        aria-controls={`agent-activity-list-${taskId.replace(/[^A-Za-z0-9_-]/g, '-')}`}
      >
        <span className={`agent-activity-avatar ${latestRunning ? 'is-running' : ''}`} aria-hidden="true">
          <Bot size={15} />
        </span>
        <span className="agent-activity-current">
          <span className="agent-activity-title">{currentActivity.title}</span>
          <span className="agent-activity-description">{currentActivity.description}</span>
        </span>
        <span className={`agent-activity-current-status status-${currentActivity.status}`}>
          {statusIcon(currentActivity.status)}
          <span>{statusLabel(currentActivity.status)}</span>
        </span>
        <ChevronDown size={14} className={`agent-activity-chevron ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      {expanded && (
        <ol id={`agent-activity-list-${taskId.replace(/[^A-Za-z0-9_-]/g, '-')}`} className="agent-activity-list" aria-live="polite">
          {activities.slice(-MAX_VISIBLE_ITEMS).map(activity => {
            const showDetails = Boolean(activity.resultSummary || activity.details || activity.errorStatus);
            const detailsOpen = Boolean(expandedDetails[activity.activityId]);
            return (
              <li key={activity.activityId} className={`agent-activity-item status-${activity.status}`}>
                <span className={`agent-activity-marker status-${activity.status}`} aria-hidden="true">
                  {statusIcon(activity.status)}
                </span>
                <div className="agent-activity-item-content">
                  <div className="agent-activity-item-heading">
                    <span className="agent-activity-item-title">{activity.title}</span>
                    <span className={`agent-activity-item-state status-${activity.status}`}>{statusLabel(activity.status)}</span>
                  </div>
                  <p className="agent-activity-item-description">{activity.description}</p>
                  {showDetails && (
                    <button
                      type="button"
                      className="agent-activity-details-toggle"
                      onClick={() => setExpandedDetails(previous => ({ ...previous, [activity.activityId]: !previous[activity.activityId] }))}
                      aria-expanded={detailsOpen}
                    >
                      {detailsOpen ? 'Hide details' : 'Show details'}
                    </button>
                  )}
                  {detailsOpen && showDetails && (
                    <div className="agent-activity-details">
                      {activity.resultSummary && <p>{activity.resultSummary}</p>}
                      {activity.details && <p>{activity.details}</p>}
                      {activity.errorStatus && <p>Issue: {activity.errorStatus.replace(/[_-]+/g, ' ')}</p>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
