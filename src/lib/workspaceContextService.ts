import { getAccessToken, googleSignIn } from './workspaceAuth';
import { listGoogleDriveFiles, GoogleDriveFileItem } from './workspaceTools';

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  htmlLink?: string;
}

export interface GmailMessageSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

export interface GoogleTaskSummary {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: string;
}

/**
 * Ensures access token is available. Triggers Google sign-in if needed.
 */
async function ensureToken(): Promise<string> {
  let token = getAccessToken();
  if (!token) {
    const res = await googleSignIn();
    if (!res?.accessToken) {
      throw new Error('Google Workspace authentication cancelled or unavailable.');
    }
    token = res.accessToken;
  }
  return token;
}

/**
 * Fetches user's Google Calendar events for today & upcoming days.
 */
export async function fetchCalendarEvents(timeMin?: string, timeMax?: string): Promise<CalendarEvent[]> {
  try {
    const token = await ensureToken();
    const now = new Date();
    const defaultMin = timeMin || new Date(now.setHours(0, 0, 0, 0)).toISOString();
    
    const future = new Date();
    future.setDate(future.getDate() + 7);
    const defaultMax = timeMax || future.toISOString();

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', defaultMin);
    url.searchParams.set('timeMax', defaultMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '15');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Calendar API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return (data.items || []).map((item: any) => ({
      id: item.id,
      summary: item.summary || 'Untitled Event',
      description: item.description,
      start: item.start?.dateTime || item.start?.date || '',
      end: item.end?.dateTime || item.end?.date || '',
      location: item.location,
      htmlLink: item.htmlLink
    }));
  } catch (err) {
    console.warn('Failed to fetch calendar events:', err);
    return [];
  }
}

/**
 * Fetches recent Gmail messages with subject, sender, snippet, date.
 */
export async function fetchRecentEmails(query: string = 'in:inbox', maxResults: number = 5): Promise<GmailMessageSummary[]> {
  try {
    const token = await ensureToken();
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('q', query);
    listUrl.searchParams.set('maxResults', String(maxResults));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!listRes.ok) {
      throw new Error(`Gmail API list failed: ${listRes.statusText}`);
    }

    const listData = await listRes.json();
    const messages = listData.messages || [];

    const results: GmailMessageSummary[] = [];

    // Fetch details for each message
    for (const msg of messages.slice(0, maxResults)) {
      const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!detailRes.ok) continue;

      const detailData = await detailRes.json();
      const headers = detailData.payload?.headers || [];
      const fromHeader = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
      const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
      const dateHeader = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';

      results.push({
        id: detailData.id,
        from: fromHeader,
        subject: subjectHeader,
        snippet: detailData.snippet || '',
        date: dateHeader
      });
    }

    return results;
  } catch (err) {
    console.warn('Failed to fetch recent emails:', err);
    return [];
  }
}

/**
 * Fetches Google Tasks for the user.
 */
export async function fetchGoogleTasks(): Promise<GoogleTaskSummary[]> {
  try {
    const token = await ensureToken();
    const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) return [];

    const data = await res.json();
    return (data.items || []).map((t: any) => ({
      id: t.id,
      title: t.title || 'Untitled Task',
      notes: t.notes,
      due: t.due,
      status: t.status || 'needsAction'
    }));
  } catch (err) {
    console.warn('Failed to fetch tasks:', err);
    return [];
  }
}

/**
 * Master service component to aggregate context from Google Workspace apps based on user tags.
 */
export async function fetchWorkspaceContextSummary(tags: string[]): Promise<string> {
  const normalizedTags = tags.map(t => t.toLowerCase().replace('@', ''));
  const includeAll = normalizedTags.includes('workspace') || normalizedTags.includes('all');
  
  const sections: string[] = [];

  // 1. Google Calendar Context
  if (includeAll || normalizedTags.includes('calendar') || normalizedTags.includes('schedule') || normalizedTags.includes('events')) {
    const events = await fetchCalendarEvents();
    if (events.length > 0) {
      const eventLines = events.map(e => {
        const timeStr = e.start ? new Date(e.start).toLocaleString() : 'All day';
        return `- **${e.summary}** (${timeStr})${e.location ? ` @ ${e.location}` : ''}${e.description ? ` - ${e.description}` : ''}`;
      });
      sections.push(`📅 **Google Calendar Schedule (${events.length} upcoming events):**\n${eventLines.join('\n')}`);
    } else {
      sections.push('📅 **Google Calendar Schedule:** No upcoming events found for today/this week.');
    }
  }

  // 2. Gmail Context
  if (includeAll || normalizedTags.includes('gmail') || normalizedTags.includes('mail') || normalizedTags.includes('email') || normalizedTags.includes('emails')) {
    const emails = await fetchRecentEmails('in:inbox', 5);
    if (emails.length > 0) {
      const emailLines = emails.map(e => 
        `- **Subject:** ${e.subject}\n  **From:** ${e.from}\n  **Summary:** ${e.snippet}`
      );
      sections.push(`✉️ **Gmail Inbox Context (${emails.length} recent emails):**\n${emailLines.join('\n\n')}`);
    } else {
      sections.push('✉️ **Gmail Inbox:** No recent inbox emails retrieved.');
    }
  }

  // 3. Google Drive / Docs / Sheets Context
  if (includeAll || normalizedTags.includes('drive') || normalizedTags.includes('docs') || normalizedTags.includes('sheets') || normalizedTags.includes('slides')) {
    try {
      const driveFiles = await listGoogleDriveFiles();
      if (driveFiles.length > 0) {
        const fileLines = driveFiles.slice(0, 5).map(f => `- **${f.name}** (${f.mimeType.split('.').pop() || 'file'})`);
        sections.push(`📁 **Google Drive Files (${driveFiles.length} recent files):**\n${fileLines.join('\n')}`);
      }
    } catch {
      // Ignore if drive fails
    }
  }

  // 4. Google Tasks Context
  if (includeAll || normalizedTags.includes('tasks') || normalizedTags.includes('todo')) {
    const tasks = await fetchGoogleTasks();
    if (tasks.length > 0) {
      const taskLines = tasks.map(t => `- [ ] **${t.title}**${t.due ? ` (Due: ${new Date(t.due).toLocaleDateString()})` : ''}`);
      sections.push(`☑️ **Google Tasks (${tasks.length} pending tasks):**\n${taskLines.join('\n')}`);
    }
  }

  if (sections.length === 0) {
    return '';
  }

  return `\n\n[AUTHENTICATED GOOGLE WORKSPACE LIVE CONTEXT]\n${sections.join('\n\n')}\n[END WORKSPACE CONTEXT]\n`;
}
