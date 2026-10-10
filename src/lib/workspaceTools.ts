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
 * Lists or searches files from the user's Google Drive.
 */
export async function listGoogleDriveFiles(searchQuery?: string): Promise<GoogleDriveFileItem[]> {
  const token = await ensureAccessToken();

  let query = "trashed = false";
  if (searchQuery) {
    query += ` and name contains '${searchQuery.replace(/'/g, "\\'")}'`;
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', query);
  url.searchParams.set('pageSize', '25');
  url.searchParams.set('fields', 'files(id, name, mimeType, webViewLink, iconLink, thumbnailLink, modifiedTime, size)');
  url.searchParams.set('orderBy', 'modifiedTime desc');

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
