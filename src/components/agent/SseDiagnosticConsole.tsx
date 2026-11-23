import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SseConnectionState,
  SseDiagnosticSnapshot,
  sseStreamDiagnostics,
  SSE_HANG_THRESHOLD_MS,
} from '@/lib/sseStreamDiagnostics';

export interface SseDiagnosticConsoleProps {
  isStreamingResponse: boolean;
  status: 'idle' | 'running' | 'completed' | 'error';
  taskId?: string | null;
  lastUserPrompt?: string;
  onStop?: () => void;
  onRestartStream: (promptToRestart?: string) => void;
}

const STATE_BADGE_CONFIG: Record<
  SseConnectionState,
  { label: string; dotClass: string; badgeClass: string }
> = {
  idle: {
    label: 'IDLE',
    dotClass: 'bg-zinc-400',
    badgeClass: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
  },
  connecting: {
    label: 'CONNECTING',
    dotClass: 'bg-amber-400 animate-pulse',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  },
  streaming: {
    label: 'STREAMING',
    dotClass: 'bg-emerald-500 animate-ping',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  },
  stalled: {
    label: 'STALLED (>5s)',
    dotClass: 'bg-rose-500 animate-pulse',
    badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  },
  completed: {
    label: 'COMPLETED',
    dotClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  error: {
    label: 'ERROR',
    dotClass: 'bg-rose-500',
    badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  },
  restarting: {
    label: 'RESTARTING',
    dotClass: 'bg-amber-500 animate-spin',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
};

export function SseDiagnosticConsole({
  isStreamingResponse,
  status,
  taskId,
  lastUserPrompt,
  onStop,
  onRestartStream,
}: SseDiagnosticConsoleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<SseDiagnosticSnapshot>(() =>
    sseStreamDiagnostics.getSnapshot(Date.now(), isStreamingResponse)
  );

  // Subscribe to real-time SSE diagnostic events
  useEffect(() => {
    const unsubscribe = sseStreamDiagnostics.subscribe((nextSnap) => {
      setSnapshot(nextSnap);
    });
    return unsubscribe;
  }, []);

  // Poll every 250ms while streaming or open to evaluate the >5000ms hang watchdog accurately
  useEffect(() => {
    const shouldPoll =
      isStreamingResponse ||
      status === 'running' ||
      isOpen ||
      snapshot.connectionState === 'connecting' ||
      snapshot.connectionState === 'streaming' ||
      snapshot.connectionState === 'stalled';

    if (!shouldPoll) return;

    const interval = setInterval(() => {
      const updated = sseStreamDiagnostics.evaluateWatchdog(Date.now(), isStreamingResponse);
      setSnapshot(updated);
    }, 250);

    return () => clearInterval(interval);
  }, [isStreamingResponse, status, isOpen, snapshot.connectionState]);

  const handleRestartStream = () => {
    sseStreamDiagnostics.recordRestartRequested();
    if (onStop) {
      try {
        onStop();
      } catch {}
    }
    onRestartStream(lastUserPrompt);
  };

  const stateBadge =
    STATE_BADGE_CONFIG[snapshot.connectionState] || STATE_BADGE_CONFIG.idle;
  const silenceSec = (snapshot.silenceDurationMs / 1000).toFixed(1);
  const showRestartButton =
    snapshot.isHungOverThreshold ||
    snapshot.connectionState === 'stalled' ||
    (isStreamingResponse && snapshot.silenceDurationMs >= SSE_HANG_THRESHOLD_MS);

  return (
    <div
      data-testid="sse-diagnostic-console"
      data-connection-state={snapshot.connectionState}
      data-is-hung={showRestartButton ? 'true' : 'false'}
      className="max-w-3xl mx-auto w-full my-2"
    >
      <div
        className={cn(
          'rounded-xl border transition-colors overflow-hidden backdrop-blur-xs',
          showRestartButton
            ? 'border-rose-500/40 bg-rose-500/5 dark:bg-rose-950/20'
            : 'border-border/50 bg-card/70 dark:bg-card/60'
        )}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <button
            type="button"
            data-testid="sse-diagnostic-toggle"
            onClick={() => setIsOpen((prev) => !prev)}
            className="flex items-center gap-2 text-left min-w-0 flex-1 cursor-pointer"
          >
            <Terminal size={13} className="text-muted-foreground shrink-0" />
            <span className="text-xs font-mono font-semibold text-foreground/90 truncate">
              SSE Stream Console
            </span>
            <span
              data-testid="sse-connection-state-badge"
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border shrink-0',
                stateBadge.badgeClass
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', stateBadge.dotClass)} />
              {stateBadge.label}
            </span>
            <span className="hidden sm:inline-block text-[11px] font-mono text-muted-foreground truncate">
              Events: {snapshot.totalEventsLogged} · {(snapshot.totalBytesReceived / 1024).toFixed(1)} KB
              {snapshot.silenceDurationMs > 0 && (
                <> · Idle: {silenceSec}s</>
              )}
            </span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {showRestartButton && (
              <button
                type="button"
                data-testid="sse-restart-stream-button"
                onClick={handleRestartStream}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer animate-in fade-in duration-150"
                title="Connection hung for >5 seconds — abort and restart stream"
              >
                <RotateCw size={12} />
                <span>Restart Stream</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              aria-label={isOpen ? 'Collapse SSE diagnostic console' : 'Expand SSE diagnostic console'}
            >
              {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Hang Alert Banner when connection hangs > 5s even if console is collapsed */}
        {showRestartButton && !isOpen && (
          <div
            data-testid="sse-hang-warning-banner"
            className="px-3 py-1.5 border-t border-rose-500/20 bg-rose-500/10 flex items-center justify-between gap-2 text-xs text-rose-700 dark:text-rose-300"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle size={13} className="shrink-0 text-rose-500" />
              <span className="truncate font-mono text-[11px]">
                No SSE frame received for {silenceSec}s (threshold: 5.0s). Stream may be stalled.
              </span>
            </div>
          </div>
        )}

        {/* Expanded Console Log View */}
        {isOpen && (
          <div className="border-t border-border/40 bg-[#0D0E11] text-zinc-200 p-3 space-y-2 font-mono text-[11px]">
            {/* Telemetry Summary Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800 text-[10px] text-zinc-400">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  REQ:{' '}
                  <strong className="text-zinc-200">
                    {snapshot.activeRequestId || taskId || 'none'}
                  </strong>
                </span>
                <span>
                  ENDPOINT:{' '}
                  <strong className="text-zinc-200">
                    {snapshot.endpoint || '/api/gemini/stream'}
                  </strong>
                </span>
                <span>
                  SILENCE:{' '}
                  <strong
                    className={cn(
                      showRestartButton ? 'text-rose-400 font-bold' : 'text-zinc-200'
                    )}
                  >
                    {snapshot.silenceDurationMs}ms
                  </strong>
                </span>
                {snapshot.restartCount > 0 && (
                  <span>
                    RESTARTS: <strong className="text-amber-400">{snapshot.restartCount}</strong>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="sse-clear-logs-button"
                  onClick={() => sseStreamDiagnostics.clearLogs()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
                  title="Clear diagnostic log buffer"
                >
                  <Trash2 size={11} />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Event ID & Payload Chunk Stream Log */}
            <div
              data-testid="sse-diagnostic-log-list"
              className="max-h-52 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar"
            >
              {snapshot.logs.length === 0 ? (
                <div className="py-4 text-center text-zinc-500 flex items-center justify-center gap-1.5">
                  <Activity size={13} />
                  <span>Waiting for incoming SSE events and payload chunks...</span>
                </div>
              ) : (
                snapshot.logs.map((entry) => (
                  <div
                    key={`${entry.seq}_${entry.eventId}`}
                    data-testid="sse-diagnostic-log-entry"
                    data-event-id={entry.eventId}
                    data-event-type={entry.eventType}
                    className="rounded bg-zinc-900/90 border border-zinc-800/80 px-2.5 py-1.5 space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-zinc-500">#{entry.seq}</span>
                        <span
                          className={cn(
                            'px-1.5 py-0.2 rounded font-semibold uppercase',
                            entry.eventType === 'error'
                              ? 'bg-rose-500/20 text-rose-300'
                              : entry.eventType === 'text-delta'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : entry.eventType === 'done' || entry.eventType === 'finish'
                                  ? 'bg-sky-500/20 text-sky-300'
                                  : 'bg-zinc-800 text-zinc-300'
                          )}
                        >
                          {entry.eventType}
                        </span>
                        <span
                          data-testid="sse-log-event-id"
                          className="text-amber-300/90 truncate"
                          title={`Event ID: ${entry.eventId}`}
                        >
                          id={entry.eventId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-500 shrink-0">
                        <span>+{entry.deltaSinceLastFrameMs}ms</span>
                        <span>{entry.byteLength}B</span>
                      </div>
                    </div>
                    <div
                      data-testid="sse-log-payload-chunk"
                      className="text-zinc-300 break-all whitespace-pre-wrap leading-relaxed text-[10.5px]"
                    >
                      {entry.payloadChunk}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
