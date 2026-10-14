import { getAccessToken, googleSignIn } from './workspaceAuth';

export interface CalendarEventPayload {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string; // ISO 8601 string or YYYY-MM-DDTHH:mm:ss
  endDateTime: string;
  timeZone?: string;
}

export interface GmailDraftPayload {
  to?: string;
  subject: string;
  body: string;
}

export interface GoogleDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
  size?: string;
}

/**
 * Ensures a valid access token exists, otherwise triggers sign-in popup.
 */
async function ensureAccessToken(): Promise<string> {
  let token = getAccessToken();
  if (!token) {
    const res = await googleSignIn();
    if (!res?.accessToken) {
      throw new Error('Google Workspace authentication required. Please sign in with Google.');
    }
    token = res.accessToken;
  }
  return token;
}

/**
 * Creates an event in the user's primary Google Calendar.
 */
export async function createGoogleCalendarEvent(payload: CalendarEventPayload) {
  const token = await ensureAccessToken();

  const userTimeZone = payload.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const eventBody = {
    summary: payload.summary,
    description: payload.description || '',
    location: payload.location || '',
    start: {
      dateTime: new Date(payload.startDateTime).toISOString(),
      timeZone: userTimeZone,
    },
    end: {
      dateTime: new Date(payload.endDateTime).toISOString(),
      timeZone: userTimeZone,
    },
  };

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Calendar API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    eventId: data.id,
    summary: data.summary,
    htmlLink: data.htmlLink,
    start: data.start?.dateTime || data.start?.date,
    end: data.end?.dateTime || data.end?.date,
  };
}

/**
 * Generates and saves an email draft in the user's Gmail account.
 */
export async function createGmailDraft(payload: GmailDraftPayload) {
  const token = await ensureAccessToken();

  const emailLines = [
    `To: ${payload.to || ''}`,
    `Subject: ${payload.subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    payload.body.replace(/\n/g, '<br/>')
  ];

  const rawMessage = emailLines.join('\r\n');
  
  // Base64url encode the message
  const encodedMessage = btoa(unescape(encodeURIComponent(rawMessage)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: encodedMessage,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    draftId: data.id,
    messageId: data.message?.id,
    subject: payload.subject,
    to: payload.to,
  };
}

/**
 * Options for listing Google Drive items
 */
export interface ListDriveOptions {
  searchQuery?: string;
  folderId?: string;
  mimeTypeFilter?: string;
  pageSize?: number;
}

/**
 * Lists or searches files from the user's Google Drive.
 */
export async function listGoogleDriveFiles(
  optionsOrQuery?: string | ListDriveOptions
): Promise<GoogleDriveFileItem[]> {
  const token = await ensureAccessToken();

  let searchQuery = '';
  let folderId = '';
  let mimeTypeFilter = '';
  let pageSize = 40;

  if (typeof optionsOrQuery === 'string') {
    searchQuery = optionsOrQuery;
  } else if (optionsOrQuery) {
    searchQuery = optionsOrQuery.searchQuery || '';
    folderId = optionsOrQuery.folderId || '';
    mimeTypeFilter = optionsOrQuery.mimeTypeFilter || '';
    pageSize = optionsOrQuery.pageSize || 40;
  }

  const queryParts: string[] = ["trashed = false"];

  if (folderId) {
    queryParts.push(`'${folderId.replace(/'/g, "\\'")}' in parents`);
  }

  if (searchQuery) {
    queryParts.push(`name contains '${searchQuery.replace(/'/g, "\\'")}'`);
  }

  if (mimeTypeFilter && mimeTypeFilter !== 'all') {
    if (mimeTypeFilter === 'document') {
      queryParts.push("mimeType = 'application/vnd.google-apps.document'");
    } else if (mimeTypeFilter === 'spreadsheet') {
      queryParts.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
    } else if (mimeTypeFilter === 'presentation') {
      queryParts.push("mimeType = 'application/vnd.google-apps.presentation'");
    } else if (mimeTypeFilter === 'folder') {
      queryParts.push("mimeType = 'application/vnd.google-apps.folder'");
    } else if (mimeTypeFilter === 'pdf') {
      queryParts.push("mimeType = 'application/pdf'");
    }
  }

  const query = queryParts.join(' and ');

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', query);
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('fields', 'files(id, name, mimeType, webViewLink, iconLink, thumbnailLink, modifiedTime, size, parents)');
  url.searchParams.set('orderBy', 'folder,modifiedTime desc');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.files || [];
}

export async function searchGoogleDriveFiles(searchQuery?: string): Promise<GoogleDriveFileItem[]> {
  return listGoogleDriveFiles(searchQuery);
}

/**
 * Retrieves plain text content from a Google Doc document.
 */
export async function getGoogleDocText(fileId: string): Promise<string> {
  const token = await ensureAccessToken();
  // Attempt plain text export
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.ok) {
    return await res.text();
  }

  // Fallback to Docs API
  const docsRes = await fetch(`https://docs.googleapis.com/v1/documents/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (docsRes.ok) {
    const docData = await docsRes.json();
    let text = `# ${docData.title || 'Google Doc'}\n\n`;
    if (docData.body?.content) {
      for (const element of docData.body.content) {
        if (element.paragraph?.elements) {
          for (const elem of element.paragraph.elements) {
            if (elem.textRun?.content) {
              text += elem.textRun.content;
            }
          }
        }
      }
    }
    return text;
  }

  throw new Error(`Failed to read Google Doc (${res.status})`);
}

/**
 * Exports a Google Sheets spreadsheet into CSV format text.
 */
export async function getGoogleSheetText(fileId: string): Promise<string> {
  const token = await ensureAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to export Google Sheet as CSV (${res.status})`);
  }

  return await res.text();
}

/**
 * Retrieves slide contents from a Google Slides presentation as formatted text.
 */
export async function getGoogleSlidesText(fileId: string): Promise<string> {
  const token = await ensureAccessToken();
  const res = await fetch(`https://slides.googleapis.com/v1/presentations/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Google Slides presentation (${res.status})`);
  }

  const data = await res.json();
  let text = `# Presentation: ${data.title || 'Untitled'}\n\n`;

  if (Array.isArray(data.slides)) {
    data.slides.forEach((slide: any, idx: number) => {
      text += `\n--- Slide ${idx + 1} ---\n`;
      if (Array.isArray(slide.pageElements)) {
        slide.pageElements.forEach((elem: any) => {
          if (elem.shape?.text?.textElements) {
            elem.shape.text.textElements.forEach((te: any) => {
              if (te.textRun?.content) {
                text += te.textRun.content;
              }
            });
          }
        });
      }
    });
  }

  return text;
}

/**
 * Downloads raw media file content (text, markdown, JSON, CSV).
 */
export async function getGoogleDriveMediaText(fileId: string): Promise<string> {
  const token = await ensureAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to download Drive file content (${res.status})`);
  }

  return await res.text();
}

export interface DriveDocumentContextResult {
  file: GoogleDriveFileItem;
  content: string;
  charCount: number;
  wordCount: number;
  formattedContext: string;
}

/**
 * Retrieves and packages a Google Drive document's full text as structured AI context.
 */
export async function retrieveDriveDocumentContext(
  file: GoogleDriveFileItem
): Promise<DriveDocumentContextResult> {
  let content = '';
  const mime = file.mimeType || '';

  try {
    if (mime === 'application/vnd.google-apps.document') {
      content = await getGoogleDocText(file.id);
    } else if (mime === 'application/vnd.google-apps.spreadsheet') {
      content = await getGoogleSheetText(file.id);
    } else if (mime === 'application/vnd.google-apps.presentation') {
      content = await getGoogleSlidesText(file.id);
    } else {
      content = await getGoogleDriveMediaText(file.id);
    }
  } catch (err: any) {
    console.warn(`[Drive Context] Unable to fetch raw file body for ${file.name}, using metadata summary:`, err);
    content = `[Google Drive File Summary]\nName: ${file.name}\nType: ${file.mimeType}\nLink: ${file.webViewLink || 'N/A'}\nModified: ${file.modifiedTime || 'N/A'}`;
  }

  const cleanContent = content.trim();
  const wordCount = cleanContent ? cleanContent.split(/\s+/).length : 0;
  
  const formattedContext = `[GOOGLE DRIVE CONTEXT ATTACHED]
Document Name: ${file.name}
File ID: ${file.id}
MIME Type: ${file.mimeType}
Link: ${file.webViewLink || 'N/A'}
Last Modified: ${file.modifiedTime || 'N/A'}

--- DOCUMENT CONTENT BEGIN ---
${cleanContent}
--- DOCUMENT CONTENT END ---`;

  return {
    file,
    content: cleanContent,
    charCount: cleanContent.length,
    wordCount,
    formattedContext,
  };
}

/**
 * Lists upcoming events from the user's Google Calendar.
 */
export async function listGoogleCalendarEvents(timeMin?: string, maxResults: number = 10) {
  const token = await ensureAccessToken();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('timeMin', timeMin || new Date().toISOString());

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Calendar API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.items || []).map((ev: any) => ({
    id: ev.id,
    summary: ev.summary || 'Untitled Event',
    description: ev.description || '',
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    htmlLink: ev.htmlLink,
  }));
}

/**
 * Searches messages in Gmail.
 */
export async function searchGmailMessages(query?: string, maxResults: number = 10) {
  const token = await ensureAccessToken();
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('maxResults', String(maxResults));
  if (query) {
    url.searchParams.set('q', query);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const messagesList = data.messages || [];

  const details = await Promise.all(
    messagesList.slice(0, maxResults).map(async (m: { id: string }) => {
      try {
        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!detailRes.ok) return null;
        const msgData = await detailRes.json();
        const headers = msgData.payload?.headers || [];
        const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '(No Subject)';
        const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
        const snippet = msgData.snippet || '';
        return {
          id: msgData.id,
          threadId: msgData.threadId,
          subject,
          from,
          snippet,
          date: headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '',
        };
      } catch {
        return null;
      }
    })
  );

  return details.filter(Boolean);
}

/**
 * Creates a Google Task in the user's default task list.
 */
export async function createGoogleTask(title: string, notes?: string, dueDate?: string) {
  const token = await ensureAccessToken();

  const taskBody: any = {
    title,
    notes: notes || '',
  };

  if (dueDate) {
    taskBody.due = new Date(dueDate).toISOString();
  }

  const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(taskBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Tasks API Error (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * Creates a new Google Document.
 */
export async function createGoogleDoc(title: string, content?: string) {
  const token = await ensureAccessToken();

  // Create doc
  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Google Docs API Error (${createRes.status}): ${errText}`);
  }

  const docData = await createRes.json();

  if (content && docData.documentId) {
    // Insert text content
    await fetch(`https://docs.googleapis.com/v1/documents/${docData.documentId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: content,
            },
          },
        ],
      }),
    });
  }

  return {
    documentId: docData.documentId,
    title: docData.title,
    webViewLink: `https://docs.google.com/document/d/${docData.documentId}/edit`,
  };
}

/**
 * Creates a new Google Sheet.
 */
export async function createGoogleSheet(title: string, values?: string[][]) {
  const token = await ensureAccessToken();

  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Sheet1' } }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Sheets API Error (${res.status}): ${errText}`);
  }

  const sheetData = await res.json();

  if (values && values.length > 0 && sheetData.spreadsheetId) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetData.spreadsheetId}/values/Sheet1!A1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values,
      }),
    });
  }

  return {
    spreadsheetId: sheetData.spreadsheetId,
    title: sheetData.properties?.title || title,
    webViewLink: sheetData.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheetData.spreadsheetId}/edit`,
  };
}

/**
 * Creates a new Google Slides presentation.
 */
export async function createGoogleSlide(title: string) {
  const token = await ensureAccessToken();

  const res = await fetch('https://slides.googleapis.com/v1/presentations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Slides API Error (${res.status}): ${errText}`);
  }

  const slidesData = await res.json();
  return {
    presentationId: slidesData.presentationId,
    title: slidesData.title,
    webViewLink: `https://docs.google.com/presentation/d/${slidesData.presentationId}/edit`,
  };
}

/**
 * Creates a Google Calendar meeting with Google Meet link enabled.
 */
export async function createGoogleMeetCall(summary: string, startDateTime: string, endDateTime: string) {
  const token = await ensureAccessToken();
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary,
      start: { dateTime: new Date(startDateTime).toISOString(), timeZone: userTimeZone },
      end: { dateTime: new Date(endDateTime).toISOString(), timeZone: userTimeZone },
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Meet API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const meetUri = data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || data.htmlLink;

  return {
    eventId: data.id,
    summary: data.summary,
    meetUri,
    htmlLink: data.htmlLink,
  };
}

/**
 * Lists or searches user's Google Contacts.
 */
export async function listGoogleContacts(query?: string) {
  const token = await ensureAccessToken();

  const url = new URL('https://people.googleapis.com/v1/people/me/connections');
  url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,photos');
  url.searchParams.set('pageSize', '30');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Contacts API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  let connections = data.connections || [];

  if (query) {
    const q = query.toLowerCase();
    connections = connections.filter((person: any) => {
      const name = person.names?.[0]?.displayName?.toLowerCase() || '';
      const email = person.emailAddresses?.[0]?.value?.toLowerCase() || '';
      return name.includes(q) || email.includes(q);
    });
  }

  return connections.map((p: any) => ({
    resourceName: p.resourceName,
    name: p.names?.[0]?.displayName || 'Unnamed Contact',
    email: p.emailAddresses?.[0]?.value || '',
    phone: p.phoneNumbers?.[0]?.value || '',
    photo: p.photos?.[0]?.url || '',
  }));
}

/**
 * Lists Google Classroom courses.
 */
export async function listClassroomCourses() {
  const token = await ensureAccessToken();

  const res = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Classroom API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.courses || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    section: c.section,
    descriptionHeading: c.descriptionHeading,
    alternateLink: c.alternateLink,
  }));
}

/**
 * Creates a Google Form.
 */
export async function createGoogleForm(title: string) {
  const token = await ensureAccessToken();

  const res = await fetch('https://forms.googleapis.com/v1/forms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      info: { title, documentTitle: title },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Forms API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    formId: data.formId,
    title: data.info?.title || title,
    responderUri: data.responderUri,
    webViewLink: `https://docs.google.com/forms/d/${data.formId}/edit`,
  };
}

/**
 * Creates a Google Keep note stored in user Google Drive / Keep space.
 */
export async function createGoogleKeepNote(title: string, content: string) {
  const token = await ensureAccessToken();

  // Create text document styled as a Keep note in Google Drive
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `📌 ${title}.txt`,
      mimeType: 'text/plain',
      description: 'Saved via Manus Keep Plugin',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Keep / Drive Error (${res.status}): ${errText}`);
  }

  const file = await res.json();

  // Upload note text
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: `${title}\n\n${content}`,
  });

  return {
    noteId: file.id,
    title,
    webViewLink: `https://drive.google.com/file/d/${file.id}/view`,
  };
}

/**
 * Sends an email directly from the user's Gmail account.
 */
export async function sendGmailEmail(payload: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
}) {
  const token = await ensureAccessToken();

  const headerLines = [
    `To: ${payload.to}`,
    payload.cc ? `Cc: ${payload.cc}` : '',
    payload.bcc ? `Bcc: ${payload.bcc}` : '',
    `Subject: ${payload.subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    payload.body.replace(/\n/g, '<br/>')
  ].filter(line => line !== '');

  const rawMessage = headerLines.join('\r\n');
  const encodedMessage = btoa(unescape(encodeURIComponent(rawMessage)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const body: any = { raw: encodedMessage };
  if (payload.threadId) {
    body.threadId = payload.threadId;
  }

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail Send Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    threadId: data.threadId,
    to: payload.to,
    subject: payload.subject,
    status: 'sent'
  };
}

/**
 * Retrieves full details and decoded content of a Gmail message.
 */
export async function getGmailMessage(messageId: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Gmail get message failed (${res.status})`);
  }

  const data = await res.json();
  const headers = data.payload?.headers || [];
  const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '(No Subject)';
  const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
  const date = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '';
  const snippet = data.snippet || '';

  return {
    id: data.id,
    threadId: data.threadId,
    subject,
    from,
    date,
    snippet,
  };
}

/**
 * Moves a Gmail message to Trash.
 */
export async function trashGmailMessage(messageId: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Failed to trash Gmail message (${res.status})`);
  }

  return { success: true, messageId };
}

/**
 * Searches Google Calendar events by text query.
 */
export async function searchGoogleCalendarEvents(query: string, maxResults: number = 10) {
  const token = await ensureAccessToken();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('singleEvents', 'true');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Calendar search failed (${res.status})`);
  }

  const data = await res.json();
  return (data.items || []).map((ev: any) => ({
    id: ev.id,
    summary: ev.summary || 'Untitled Event',
    description: ev.description || '',
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    htmlLink: ev.htmlLink
  }));
}

/**
 * Updates an existing Google Calendar event.
 */
export async function updateGoogleCalendarEvent(eventId: string, updates: Partial<CalendarEventPayload>) {
  const token = await ensureAccessToken();
  const patchBody: any = {};
  if (updates.summary) patchBody.summary = updates.summary;
  if (updates.description) patchBody.description = updates.description;
  if (updates.location) patchBody.location = updates.location;
  if (updates.startDateTime) {
    patchBody.start = { dateTime: new Date(updates.startDateTime).toISOString() };
  }
  if (updates.endDateTime) {
    patchBody.end = { dateTime: new Date(updates.endDateTime).toISOString() };
  }

  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(patchBody)
  });

  if (!res.ok) {
    throw new Error(`Failed to update calendar event (${res.status})`);
  }

  const data = await res.json();
  return {
    id: data.id,
    summary: data.summary,
    htmlLink: data.htmlLink,
  };
}

/**
 * Deletes a Google Calendar event.
 */
export async function deleteGoogleCalendarEvent(eventId: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete calendar event (${res.status})`);
  }

  return { success: true, eventId };
}

/**
 * Creates a folder in Google Drive.
 */
export async function createGoogleDriveFolder(folderName: string, parentFolderId?: string) {
  const token = await ensureAccessToken();
  const metadata: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentFolderId && parentFolderId !== 'root') {
    metadata.parents = [parentFolderId];
  }

  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    throw new Error(`Failed to create Drive folder (${res.status})`);
  }

  const data = await res.json();
  return {
    id: data.id,
    name: data.name,
    webViewLink: `https://drive.google.com/drive/folders/${data.id}`,
  };
}

/**
 * Creates a new text file or markdown document directly in Google Drive.
 */
export async function createGoogleDriveFile(
  fileName: string,
  content: string,
  mimeType: string = 'text/plain',
  parentFolderId?: string
) {
  const token = await ensureAccessToken();

  const metadata: any = { name: fileName, mimeType };
  if (parentFolderId && parentFolderId !== 'root') {
    metadata.parents = [parentFolderId];
  }

  // Multi-part create
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartRequestBody,
  });

  if (!res.ok) {
    throw new Error(`Failed to create Drive file (${res.status})`);
  }

  const data = await res.json();
  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    webViewLink: `https://drive.google.com/file/d/${data.id}/view`,
  };
}

/**
 * Renames a Google Drive file or folder.
 */
export async function renameGoogleDriveFile(fileId: string, newName: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: newName })
  });

  if (!res.ok) {
    throw new Error(`Failed to rename file (${res.status})`);
  }

  const data = await res.json();
  return { id: data.id, name: data.name };
}

/**
 * Deletes a Google Drive file by moving it to trash.
 */
export async function deleteGoogleDriveFile(fileId: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ trashed: true })
  });

  if (!res.ok) {
    throw new Error(`Failed to trash file (${res.status})`);
  }

  return { success: true, fileId };
}

/**
 * Shares a Google Drive file or changes permission.
 */
export async function shareGoogleDriveFile(
  fileId: string,
  role: 'reader' | 'commenter' | 'writer' = 'reader',
  emailAddress?: string
) {
  const token = await ensureAccessToken();
  const permBody: any = {
    role,
    type: emailAddress ? 'user' : 'anyone',
  };
  if (emailAddress) {
    permBody.emailAddress = emailAddress;
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(permBody)
  });

  if (!res.ok) {
    throw new Error(`Failed to set permission for file (${res.status})`);
  }

  const data = await res.json();
  return { success: true, permissionId: data.id, role, fileId };
}

/**
 * Appends text to the end of a Google Doc.
 */
export async function appendGoogleDocText(documentId: string, text: string) {
  const token = await ensureAccessToken();

  // Fetch document to get end index
  const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!docRes.ok) throw new Error(`Could not fetch document (${docRes.status})`);
  const docData = await docRes.json();
  const endIndex = docData.body?.content?.[docData.body.content.length - 1]?.endIndex || 1;
  const insertIndex = Math.max(1, endIndex - 1);

  const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: insertIndex },
            text: '\n' + text
          }
        }
      ]
    })
  });

  if (!updateRes.ok) {
    throw new Error(`Failed to append text to Google Doc (${updateRes.status})`);
  }

  return { success: true, documentId, addedLength: text.length };
}

/**
 * Replaces text across a Google Doc.
 */
export async function replaceGoogleDocText(documentId: string, findText: string, replaceText: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          replaceAllText: {
            containsText: { text: findText, matchCase: true },
            replaceText
          }
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to replace text in Google Doc (${res.status})`);
  }

  const data = await res.json();
  const occurrences = data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
  return { success: true, occurrencesChanged: occurrences };
}

/**
 * Retrieves values from a Google Sheets range.
 */
export async function getGoogleSheetValues(spreadsheetId: string, range: string = 'Sheet1!A1:Z100') {
  const token = await ensureAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch sheet values (${res.status})`);
  }

  const data = await res.json();
  return {
    range: data.range,
    values: data.values || []
  };
}

/**
 * Updates cell values in a Google Sheets range.
 */
export async function updateGoogleSheetValues(spreadsheetId: string, range: string, values: any[][]) {
  const token = await ensureAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values })
  });

  if (!res.ok) {
    throw new Error(`Failed to update sheet values (${res.status})`);
  }

  const data = await res.json();
  return {
    spreadsheetId,
    updatedRange: data.updatedRange,
    updatedRows: data.updatedRows,
    updatedColumns: data.updatedColumns,
    updatedCells: data.updatedCells
  };
}

/**
 * Appends rows to a Google Sheets spreadsheet.
 */
export async function appendGoogleSheetValues(spreadsheetId: string, range: string, values: any[][]) {
  const token = await ensureAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values })
  });

  if (!res.ok) {
    throw new Error(`Failed to append sheet rows (${res.status})`);
  }

  const data = await res.json();
  return {
    spreadsheetId,
    updates: data.updates
  };
}

/**
 * Adds a new slide to a Google Slides presentation.
 */
export async function addGoogleSlide(presentationId: string, title?: string, body?: string) {
  const token = await ensureAccessToken();
  const slideId = `slide_${Date.now()}`;
  const titleId = `title_${Date.now()}`;
  const bodyId = `body_${Date.now()}`;

  const requests: any[] = [
    {
      createSlide: {
        objectId: slideId,
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE' }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY' }, objectId: bodyId }
        ]
      }
    }
  ];

  if (title) {
    requests.push({
      insertText: {
        objectId: titleId,
        text: title
      }
    });
  }

  if (body) {
    requests.push({
      insertText: {
        objectId: bodyId,
        text: body
      }
    });
  }

  const res = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  });

  if (!res.ok) {
    throw new Error(`Failed to add slide (${res.status})`);
  }

  return { success: true, presentationId, slideId, title };
}

/**
 * Lists user's Google Tasks.
 */
export async function listGoogleTasks(taskListId: string = '@default', showCompleted: boolean = false) {
  const token = await ensureAccessToken();
  const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`);
  url.searchParams.set('showCompleted', String(showCompleted));
  url.searchParams.set('showHidden', 'false');
  url.searchParams.set('maxResults', '30');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Failed to list tasks (${res.status})`);
  }

  const data = await res.json();
  return (data.items || []).map((t: any) => ({
    id: t.id,
    title: t.title || 'Untitled Task',
    notes: t.notes || '',
    due: t.due,
    status: t.status,
    completed: t.status === 'completed'
  }));
}

/**
 * Marks a Google Task as completed.
 */
export async function completeGoogleTask(taskId: string, taskListId: string = '@default') {
  const token = await ensureAccessToken();
  const res = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'completed' })
  });

  if (!res.ok) {
    throw new Error(`Failed to complete task (${res.status})`);
  }

  return { success: true, taskId, status: 'completed' };
}

/**
 * Deletes a Google Task.
 */
export async function deleteGoogleTask(taskId: string, taskListId: string = '@default') {
  const token = await ensureAccessToken();
  const res = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete task (${res.status})`);
  }

  return { success: true, taskId };
}

/**
 * Creates a new contact in Google Contacts.
 */
export async function createGoogleContact(contact: {
  givenName: string;
  familyName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
}) {
  const token = await ensureAccessToken();

  const personBody: any = {
    names: [
      {
        givenName: contact.givenName,
        familyName: contact.familyName || '',
      }
    ]
  };

  if (contact.email) {
    personBody.emailAddresses = [{ value: contact.email, type: 'work' }];
  }
  if (contact.phone) {
    personBody.phoneNumbers = [{ value: contact.phone, type: 'mobile' }];
  }
  if (contact.company || contact.jobTitle) {
    personBody.organizations = [{
      name: contact.company || '',
      title: contact.jobTitle || ''
    }];
  }

  const res = await fetch('https://people.googleapis.com/v1/people:createContact', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(personBody)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create contact (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    resourceName: data.resourceName,
    name: `${contact.givenName} ${contact.familyName || ''}`.trim(),
    email: contact.email,
    phone: contact.phone
  };
}

/**
 * Deletes a Google Contact.
 */
export async function deleteGoogleContact(resourceName: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://people.googleapis.com/v1/${resourceName}:deleteContact`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete contact (${res.status})`);
  }

  return { success: true, resourceName };
}

/**
 * Lists joined Google Chat spaces.
 */
export async function listGoogleChatSpaces() {
  const token = await ensureAccessToken();
  const res = await fetch('https://chat.googleapis.com/v1/spaces', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Failed to list Chat spaces (${res.status})`);
  }

  const data = await res.json();
  return (data.spaces || []).map((s: any) => ({
    name: s.name,
    displayName: s.displayName || s.name,
    type: s.type,
    spaceThreadingState: s.spaceThreadingState
  }));
}

/**
 * Sends a message to a Google Chat space.
 */
export async function sendGoogleChatMessage(spaceName: string, text: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    throw new Error(`Failed to post message to Chat (${res.status})`);
  }

  const data = await res.json();
  return {
    messageName: data.name,
    text: data.text,
    createTime: data.createTime
  };
}

/**
 * Creates an instant Google Meet space.
 */
export async function createInstantGoogleMeetSpace() {
  const token = await ensureAccessToken();
  const res = await fetch('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });

  if (!res.ok) {
    // Fallback to Calendar conferenceData version
    return createGoogleMeetCall('Instant Manus Meeting', new Date().toISOString(), new Date(Date.now() + 3600000).toISOString());
  }

  const data = await res.json();
  return {
    name: data.name,
    meetingUri: data.meetingUri,
    meetingCode: data.meetingCode
  };
}

/**
 * Adds a question to a Google Form.
 */
export async function addGoogleFormQuestion(
  formId: string,
  questionTitle: string,
  questionType: 'TEXT' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'PARAGRAPH' = 'TEXT',
  options?: string[]
) {
  const token = await ensureAccessToken();

  const item: any = {
    title: questionTitle,
    questionItem: {
      question: {
        required: false,
      }
    }
  };

  if (questionType === 'TEXT' || questionType === 'PARAGRAPH') {
    item.questionItem.question.textQuestion = {
      paragraph: questionType === 'PARAGRAPH'
    };
  } else {
    item.questionItem.question.choiceQuestion = {
      type: questionType === 'CHECKBOX' ? 'CHECKBOX' : 'RADIO',
      options: (options || ['Option 1', 'Option 2']).map(val => ({ value: val }))
    };
  }

  const res = await fetch(`https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          createItem: {
            item,
            location: { index: 0 }
          }
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to add question to Google Form (${res.status})`);
  }

  return { success: true, formId, questionTitle };
}

/**
 * Gets responses from a Google Form.
 */
export async function getGoogleFormResponses(formId: string) {
  const token = await ensureAccessToken();
  const res = await fetch(`https://forms.googleapis.com/v1/forms/${formId}/responses`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Failed to get form responses (${res.status})`);
  }

  const data = await res.json();
  return (data.responses || []).map((r: any) => ({
    responseId: r.responseId,
    createTime: r.createTime,
    answers: r.answers
  }));
}
