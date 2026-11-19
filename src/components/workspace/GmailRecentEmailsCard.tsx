import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Reply,
  Trash2,
  Loader2,
  AlertCircle,
  Check,
  ShieldAlert,
  ExternalLink,
} from 'lucide-react';
import { getAccessToken, googleSignIn } from '@/lib/workspaceAuth';
import {
  fetchRecentGmailMessages,
  createGmailDraft,
  trashGmailMessage,
  GmailMessageSummary,
} from '@/lib/workspaceTools';
import { toast } from 'sonner';

export interface GmailRecentEmailsCardProps {
  initialQuery?: string;
  maxResults?: number;
}

type PendingGmailMutation =
  | {
      kind: 'save_reply_draft';
      message: GmailMessageSummary;
      replyBody: string;
    }
  | {
      kind: 'trash_message';
      message: GmailMessageSummary;
    };

function formatCompactEmailDate(rawDate: string): string {
  if (!rawDate) return '';
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return rawDate.slice(0, 16);
  const now = new Date();
  const isToday =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  if (isToday) {
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function GmailRecentEmailsCard({
  initialQuery = 'in:inbox',
  maxResults = 5,
}: GmailRecentEmailsCardProps) {
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getAccessToken());
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [emails, setEmails] = useState<GmailMessageSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [replyDraftTextByEmail, setReplyDraftTextByEmail] = useState<Record<string, string>>({});
  const [pendingMutation, setPendingMutation] = useState<PendingGmailMutation | null>(null);
  const [mutating, setMutating] = useState<boolean>(false);

  const loadRecentEmails = useCallback(
    async (queryToRun?: string) => {
      if (!getAccessToken()) {
        setNeedsAuth(true);
        return;
      }
      setNeedsAuth(false);
      setLoading(true);
      setErrorMessage(null);
      try {
        const results = await fetchRecentGmailMessages({
          query: queryToRun !== undefined ? queryToRun : searchQuery,
          maxResults,
        });
        setEmails(results);
      } catch (err: any) {
        const msg = err?.message || 'Failed to fetch recent emails from Gmail.';
        setErrorMessage(msg);
      } finally {
        setLoading(false);
      }
    },
    [searchQuery, maxResults]
  );

  useEffect(() => {
    if (getAccessToken()) {
      loadRecentEmails(initialQuery);
    }
  }, [initialQuery, loadRecentEmails]);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    const res = await googleSignIn();
    if (res?.accessToken) {
      setNeedsAuth(false);
      toast.success('Connected to Gmail');
      await loadRecentEmails(searchQuery);
    } else {
      setNeedsAuth(true);
    }
  };

  const executeConfirmedMutation = async () => {
    if (!pendingMutation) return;
    setMutating(true);
    setErrorMessage(null);
    try {
      if (pendingMutation.kind === 'save_reply_draft') {
        const targetTo =
          pendingMutation.message.senderEmail || pendingMutation.message.from;
        const replySubject = pendingMutation.message.subject.toLowerCase().startsWith('re:')
          ? pendingMutation.message.subject
          : `Re: ${pendingMutation.message.subject}`;

        await createGmailDraft({
          to: targetTo,
          subject: replySubject,
          body: pendingMutation.replyBody,
        });
        toast.success(`Saved reply draft to ${pendingMutation.message.senderName}`);
      } else if (pendingMutation.kind === 'trash_message') {
        await trashGmailMessage(pendingMutation.message.id);
        setEmails((prev) => prev.filter((item) => item.id !== pendingMutation.message.id));
        toast.success('Moved email to Trash');
      }
      setPendingMutation(null);
    } catch (err: any) {
      const msg = err?.message || 'Gmail operation failed.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setMutating(false);
    }
  };

  return (
    <div
      data-testid="gmail-recent-emails-card"
      className="my-3 rounded-xl border border-border/80 bg-card/60 backdrop-blur-md p-3.5 shadow-sm transition-all hover:border-border max-w-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20">
            <Mail className="w-4 h-4 text-red-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-foreground truncate">
                Recent Gmail Messages
              </h4>
              {emails.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">
                  {emails.length} messages
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              Compact inbox view & quick reply drafts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => loadRecentEmails(searchQuery)}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-secondary/70 hover:bg-secondary text-foreground transition-colors disabled:opacity-50"
            title="Fetch recent emails"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{emails.length > 0 ? 'Refresh' : 'Fetch Emails'}</span>
          </button>
          <a
            href="https://mail.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            title="Open Gmail"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadRecentEmails(searchQuery);
        }}
        className="mt-2.5 flex items-center gap-1.5"
      >
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter Gmail (e.g. in:inbox, is:unread, from:team)..."
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg text-xs bg-background/80 border border-border/70 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-red-400"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {/* Sign in prompt if unauthenticated */}
      {needsAuth && (
        <div className="mt-3 rounded-lg border border-border/60 bg-background/50 p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Connect your Google account to fetch recent Gmail messages.
          </p>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="gsi-material-button"
            style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
          >
            <div className="gsi-material-button-state"></div>
            <div className="gsi-material-button-content-wrapper">
              <div
                className="gsi-material-button-icon"
                style={{ width: '14px', height: '14px', marginRight: '8px' }}
              >
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  style={{ display: 'block' }}
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  ></path>
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  ></path>
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  ></path>
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  ></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span className="gsi-material-button-contents">Sign in with Google</span>
            </div>
          </button>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div className="mt-3 flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-red-400" />
          <span>Fetching recent emails from Gmail...</span>
        </div>
      )}

      {/* Compact Email Cards List */}
      {!loading && emails.length > 0 && (
        <div className="mt-2.5 space-y-2 max-h-80 overflow-y-auto pr-0.5">
          {emails.map((email) => {
            const isExpanded = expandedEmailId === email.id;
            const replyText =
              replyDraftTextByEmail[email.id] ??
              `Hi ${email.senderName},\n\nThank you for your email regarding "${email.subject}".\n\nBest regards`;

            return (
              <div
                key={email.id}
                data-testid="gmail-compact-email-item"
                className={`rounded-lg border transition-colors p-2.5 ${
                  email.isUnread
                    ? 'border-red-500/30 bg-red-500/5'
                    : 'border-border/60 bg-background/60 hover:bg-background/90'
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setExpandedEmailId((prev) => (prev === email.id ? null : email.id))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedEmailId((prev) => (prev === email.id ? null : email.id));
                    }
                  }}
                  className="cursor-pointer select-none"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {email.isUnread && (
                        <span
                          className="h-2 w-2 rounded-full bg-red-500 shrink-0"
                          title="Unread"
                        />
                      )}
                      <span className="text-xs font-semibold text-foreground truncate">
                        {email.senderName}
                      </span>
                      {email.senderEmail && (
                        <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                          &lt;{email.senderEmail}&gt;
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
                      <span>{formatCompactEmailDate(email.date)}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </div>

                  <p className="mt-0.5 text-xs font-medium text-foreground/90 truncate">
                    {email.subject}
                  </p>
                  <p
                    className={`mt-0.5 text-[11px] text-muted-foreground ${
                      isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
                    }`}
                  >
                    {email.snippet || '(No snippet preview)'}
                  </p>
                </div>

                {/* Expanded Actions: Quick Reply Draft & Trash (both with confirmation) */}
                {isExpanded && (
                  <div className="mt-2.5 pt-2 border-t border-border/50 space-y-2">
                    <textarea
                      rows={2}
                      value={replyText}
                      onChange={(e) =>
                        setReplyDraftTextByEmail((prev) => ({
                          ...prev,
                          [email.id]: e.target.value,
                        }))
                      }
                      className="w-full rounded-md border border-border/70 bg-background/90 p-2 text-xs text-foreground focus:outline-none focus:border-red-400"
                      placeholder="Write a reply draft..."
                    />
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setPendingMutation({
                            kind: 'trash_message',
                            message: email,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Trash</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setPendingMutation({
                            kind: 'save_reply_draft',
                            message: email,
                            replyBody: replyText,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 transition-colors"
                      >
                        <Reply className="w-3 h-3" />
                        <span>Save Reply Draft</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !needsAuth && emails.length === 0 && !errorMessage && (
        <div className="mt-3 rounded-lg border border-border/50 bg-background/40 p-3 text-center text-xs text-muted-foreground">
          No messages matched "{searchQuery}". Click Refresh or try another search filter.
        </div>
      )}

      {/* Explicit Confirmation Banner for Gmail Mutations */}
      {pendingMutation && (
        <div
          data-testid="gmail-mutation-confirmation"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-foreground space-y-1">
              <p className="font-semibold">Confirm Gmail Action</p>
              {pendingMutation.kind === 'save_reply_draft' ? (
                <p className="text-muted-foreground">
                  Create a Gmail reply draft to{' '}
                  <span className="font-medium text-foreground">
                    {pendingMutation.message.senderName}
                  </span>{' '}
                  for subject "{pendingMutation.message.subject}"?
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Move email{' '}
                  <span className="font-medium text-foreground">
                    "{pendingMutation.message.subject}"
                  </span>{' '}
                  from {pendingMutation.message.senderName} to Trash?
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingMutation(null)}
              disabled={mutating}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeConfirmedMutation}
              disabled={mutating}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
            >
              {mutating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Confirm</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

export default GmailRecentEmailsCard;
