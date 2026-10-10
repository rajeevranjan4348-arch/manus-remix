import React, { useState } from 'react';
import { 
  Calendar, Mail, Check, AlertCircle, ExternalLink, Loader2, Sparkles, Clock, 
  MapPin, User, FileText, Table, CheckSquare, Video, StickyNote 
} from 'lucide-react';
import { 
  createGoogleCalendarEvent, createGmailDraft, createGoogleDoc, createGoogleSheet, 
  createGoogleTask, createGoogleMeetCall, createGoogleKeepNote,
  CalendarEventPayload, GmailDraftPayload 
} from '@/lib/workspaceTools';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface WorkspaceToolCardProps {
  type: 'calendar_event' | 'gmail_draft' | 'google_doc' | 'google_sheet' | 'google_task' | 'google_meet' | 'google_keep';
  data: any;
  onSuccess?: (res: any) => void;
}

export function WorkspaceToolCard({ type, data, onSuccess }: WorkspaceToolCardProps) {
  const [status, setStatus] = useState<'pending' | 'loading' | 'success' | 'error'>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleExecute = async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      let res: any;
      if (type === 'calendar_event') {
        const calData = data as CalendarEventPayload;
        res = await createGoogleCalendarEvent(calData);
        toast.success(`Calendar event "${calData.summary}" created!`);
      } else if (type === 'gmail_draft') {
        const mailData = data as GmailDraftPayload;
        res = await createGmailDraft(mailData);
        toast.success(`Gmail draft "${mailData.subject}" saved!`);
      } else if (type === 'google_doc') {
        res = await createGoogleDoc(data.title, data.content);
        toast.success(`Google Doc "${data.title}" created!`);
      } else if (type === 'google_sheet') {
        res = await createGoogleSheet(data.title, data.values);
        toast.success(`Google Sheet "${data.title}" created!`);
      } else if (type === 'google_task') {
        res = await createGoogleTask(data.title, data.notes, data.dueDate);
        toast.success(`Google Task "${data.title}" created!`);
      } else if (type === 'google_meet') {
        res = await createGoogleMeetCall(data.summary, data.startDateTime, data.endDateTime);
        toast.success(`Google Meet call "${data.summary}" scheduled!`);
      } else if (type === 'google_keep') {
        res = await createGoogleKeepNote(data.title, data.content);
        toast.success(`Google Keep note "${data.title}" saved!`);
      }
      setResult(res);
      setStatus('success');
      onSuccess?.(res);
    } catch (err: any) {
      console.error('Workspace Tool Error:', err);
      setStatus('error');
      setErrorMessage(err.message || 'Operation failed. Please check Google permissions.');
    }
  };

  if (type === 'calendar_event') {
    const calData = data as CalendarEventPayload;
    return (
      <div className="w-full rounded-2xl border border-blue-500/30 bg-card p-4 my-3 shadow-md">
        <div className="flex items-center gap-2.5 pb-3 border-b border-border/50">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
            <Calendar size={18} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">Google Calendar Event Proposal</h4>
            <p className="text-[11px] text-muted-foreground">Add event to primary calendar with your permission</p>
          </div>
        </div>

        <div className="py-3 space-y-2 text-xs">
          <div className="font-semibold text-foreground text-sm">{calData.summary}</div>
          
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock size={14} className="shrink-0 text-blue-500" />
            <span>
              {new Date(calData.startDateTime).toLocaleString()} - {new Date(calData.endDateTime).toLocaleTimeString()}
            </span>
          </div>

          {calData.location && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin size={14} className="shrink-0 text-red-500" />
              <span>{calData.location}</span>
            </div>
          )}

          {calData.description && (
            <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40 text-muted-foreground text-[11px] leading-relaxed">
              {calData.description}
            </div>
          )}
        </div>

        {status === 'pending' && (
          <div className="pt-2 flex items-center justify-between border-t border-border/40">
            <span className="text-[11px] text-muted-foreground">Requires your confirmation to create</span>
            <button
              onClick={handleExecute}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Check size={14} />
              <span>Confirm & Add Event</span>
            </button>
          </div>
        )}

        {status === 'loading' && (
          <div className="pt-2 flex items-center gap-2 text-xs text-blue-500 font-medium">
            <Loader2 size={15} className="animate-spin" />
            <span>Adding event to Google Calendar...</span>
          </div>
        )}

        {status === 'success' && (
          <div className="pt-2 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <div className="flex items-center gap-1.5">
              <Check size={16} />
              <span>Event added successfully!</span>
            </div>
            {result?.htmlLink && (
              <a
                href={result.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-blue-500 hover:underline text-[11px]"
              >
                <span>View Event</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="pt-2 space-y-2">
            <div className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle size={15} />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={handleExecute}
              className="px-3 py-1 rounded-lg bg-muted border border-border text-xs font-medium hover:bg-muted/80"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  if (type === 'gmail_draft') {
    const mailData = data as GmailDraftPayload;
    return (
      <div className="w-full rounded-2xl border border-red-500/30 bg-card p-4 my-3 shadow-md">
        <div className="flex items-center gap-2.5 pb-3 border-b border-border/50">
          <div className="p-2 rounded-xl bg-red-500/10 text-red-500">
            <Mail size={18} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">Gmail Draft Proposal</h4>
            <p className="text-[11px] text-muted-foreground">Generate and save email draft in your Gmail account</p>
          </div>
        </div>

        <div className="py-3 space-y-2 text-xs">
          {mailData.to && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <User size={14} className="shrink-0 text-red-500" />
              <span>To: <strong className="text-foreground">{mailData.to}</strong></span>
            </div>
          )}

          <div className="font-semibold text-foreground text-sm">
            Subject: {mailData.subject}
          </div>

          <div className="p-3 rounded-xl bg-muted/40 border border-border/40 text-muted-foreground text-[11px] leading-relaxed max-h-40 overflow-y-auto">
            {mailData.body}
          </div>
        </div>

        {status === 'pending' && (
          <div className="pt-2 flex items-center justify-between border-t border-border/40">
            <span className="text-[11px] text-muted-foreground">Requires confirmation to save draft</span>
            <button
              onClick={handleExecute}
              className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Check size={14} />
              <span>Confirm & Save Draft</span>
            </button>
          </div>
        )}

        {status === 'loading' && (
          <div className="pt-2 flex items-center gap-2 text-xs text-red-500 font-medium">
            <Loader2 size={15} className="animate-spin" />
            <span>Saving draft to Gmail...</span>
          </div>
        )}

        {status === 'success' && (
          <div className="pt-2 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <div className="flex items-center gap-1.5">
              <Check size={16} />
              <span>Draft saved to Gmail!</span>
            </div>
            <a
              href="https://mail.google.com/mail/#drafts"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-red-500 hover:underline text-[11px]"
            >
              <span>Open Gmail Drafts</span>
              <ExternalLink size={12} />
            </a>
          </div>
        )}

        {status === 'error' && (
          <div className="pt-2 space-y-2">
            <div className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle size={15} />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={handleExecute}
              className="px-3 py-1 rounded-lg bg-muted border border-border text-xs font-medium hover:bg-muted/80"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  // Google Doc, Sheet, Task, Meet, Keep universal card renderer
  if (['google_doc', 'google_sheet', 'google_task', 'google_meet', 'google_keep'].includes(type)) {
    const config = {
      google_doc: { label: 'Google Doc Proposal', icon: FileText, color: 'text-blue-500', border: 'border-blue-500/30', btn: 'bg-blue-600 hover:bg-blue-700' },
      google_sheet: { label: 'Google Sheet Proposal', icon: Table, color: 'text-emerald-500', border: 'border-emerald-500/30', btn: 'bg-emerald-600 hover:bg-emerald-700' },
      google_task: { label: 'Google Task Proposal', icon: CheckSquare, color: 'text-amber-500', border: 'border-amber-500/30', btn: 'bg-amber-600 hover:bg-amber-700' },
      google_meet: { label: 'Google Meet Call Proposal', icon: Video, color: 'text-indigo-500', border: 'border-indigo-500/30', btn: 'bg-indigo-600 hover:bg-indigo-700' },
      google_keep: { label: 'Google Keep Note Proposal', icon: StickyNote, color: 'text-amber-500', border: 'border-amber-500/30', btn: 'bg-amber-600 hover:bg-amber-700' },
    }[type as 'google_doc' | 'google_sheet' | 'google_task' | 'google_meet' | 'google_keep'];

    const Icon = config.icon;

    return (
      <div className={cn("w-full rounded-2xl border bg-card p-4 my-3 shadow-md", config.border)}>
        <div className="flex items-center gap-2.5 pb-3 border-b border-border/50">
          <div className={cn("p-2 rounded-xl bg-muted", config.color)}>
            <Icon size={18} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">{config.label}</h4>
            <p className="text-[11px] text-muted-foreground">Action ready to perform in your Google Workspace</p>
          </div>
        </div>

        <div className="py-3 space-y-1.5 text-xs">
          <div className="font-semibold text-foreground text-sm">{data.title || data.summary || 'New Workspace Item'}</div>
          {data.content && <p className="text-muted-foreground text-[11px] line-clamp-3">{data.content}</p>}
          {data.notes && <p className="text-muted-foreground text-[11px]">{data.notes}</p>}
        </div>

        {status === 'pending' && (
          <div className="pt-2 flex items-center justify-between border-t border-border/40">
            <span className="text-[11px] text-muted-foreground">Click to execute in Google Workspace</span>
            <button
              onClick={handleExecute}
              className={cn("px-4 py-1.5 rounded-xl text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs", config.btn)}
            >
              <Check size={14} />
              <span>Confirm & Create</span>
            </button>
          </div>
        )}

        {status === 'loading' && (
          <div className={cn("pt-2 flex items-center gap-2 text-xs font-medium", config.color)}>
            <Loader2 size={15} className="animate-spin" />
            <span>Processing Google Workspace action...</span>
          </div>
        )}

        {status === 'success' && (
          <div className="pt-2 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <div className="flex items-center gap-1.5">
              <Check size={16} />
              <span>Action completed successfully!</span>
            </div>
            {(result?.webViewLink || result?.meetUri || result?.responderUri) && (
              <a
                href={result.webViewLink || result.meetUri || result.responderUri}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-primary hover:underline text-[11px]"
              >
                <span>Open in Google</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="pt-2 space-y-2">
            <div className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle size={15} />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={handleExecute}
              className="px-3 py-1 rounded-lg bg-muted border border-border text-xs font-medium hover:bg-muted/80"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}
