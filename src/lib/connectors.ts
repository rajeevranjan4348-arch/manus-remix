import { 
  Mail, 
  Calendar, 
  HardDrive, 
  FileText, 
  FileSpreadsheet, 
  Presentation, 
  CheckSquare, 
  Globe, 
  Terminal, 
  ChartBar as BarChart2, 
  Sparkles, 
  Contact, 
  Video, 
  MessageCircle, 
  FileCheck, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Lock, 
  Plug,
  FolderPlus,
  Send,
  Users,
  StickyNote
} from 'lucide-react';
import { getAccessToken, googleSignIn, getCurrentUser, logoutWorkspace } from './workspaceAuth';
import { 
  searchGoogleDriveFiles, 
  listGoogleDriveFiles,
  createGoogleDriveFolder,
  createGoogleDriveFile,
  renameGoogleDriveFile,
  deleteGoogleDriveFile,
  shareGoogleDriveFile,
  listGoogleCalendarEvents, 
  searchGoogleCalendarEvents,
  createGoogleCalendarEvent, 
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  searchGmailMessages, 
  getGmailMessage,
  createGmailDraft, 
  sendGmailEmail,
  trashGmailMessage,
  createGoogleDoc,
  getGoogleDocText,
  appendGoogleDocText,
  replaceGoogleDocText,
  createGoogleSheet,
  getGoogleSheetText,
  getGoogleSheetValues,
  updateGoogleSheetValues,
  appendGoogleSheetValues,
  createGoogleSlide,
  getGoogleSlidesText,
  addGoogleSlide,
  listGoogleTasks,
  createGoogleTask,
  completeGoogleTask,
  deleteGoogleTask,
  createGoogleForm,
  addGoogleFormQuestion,
  getGoogleFormResponses,
  listGoogleContacts,
  createGoogleContact,
  deleteGoogleContact,
  listGoogleChatSpaces,
  sendGoogleChatMessage,
  createGoogleMeetCall,
  createInstantGoogleMeetSpace,
  createGoogleKeepNote
} from './workspaceTools';
import { handleConnectorError, notifyConnectorError, showConnectorErrorToast, inferConnectorIssueType } from './connectorErrorHandler';

export { handleConnectorError, notifyConnectorError, showConnectorErrorToast, inferConnectorIssueType };

export type ConnectorStatus = 
  | 'not_connected' 
  | 'connecting' 
  | 'connected' 
  | 'permission_required' 
  | 'expired' 
  | 'reconnecting' 
  | 'error' 
  | 'disconnected';

export type ConnectorCategory = 'workspace' | 'agent' | 'third_party' | 'custom';

export interface ConnectorAccountInfo {
  id?: string;
  name?: string;
  email?: string;
  username?: string;
  avatarUrl?: string;
  connectedAt?: string;
  expiresAt?: string;
  scopes?: string[];
}

export interface ConnectorToolDef {
  name: string;
  displayName: string;
  description: string;
  connectorId: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[]; required?: boolean }>;
    required?: string[];
  };
  requiresConfirmation?: boolean;
}

export interface ConnectorDef {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  iconName: string;
  iconBg: string;
  authType: 'oauth' | 'apiKey' | 'workspace' | 'custom';
  authUrlEndpoint?: string;
  tools: ConnectorToolDef[];
  websiteUrl?: string;
  docUrl?: string;
  isWorkspaceAuth?: boolean;
  defaultEnabled?: boolean;
}

export interface ConnectorState {
  connectorId: string;
  status: ConnectorStatus;
  account?: ConnectorAccountInfo;
  customConfig?: CustomConnectorConfig;
  errorMessage?: string;
  lastUsedAt?: string;
}

export interface CustomConnectorConfig {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authHeaderName?: string;
  apiKey?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  customTools?: { name: string; description: string; path: string; method: string }[];
}

export interface ToolExecutionResult {
  success: boolean;
  connectorId: string;
  toolName: string;
  data?: any;
  error?: string;
  message?: string;
  requiresConfirmation?: boolean;
  actionDetails?: any;
}

// Full Catalog of Connectors
export const CONNECTOR_CATALOG: ConnectorDef[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'workspace',
    description: 'Read, search, and generate email drafts directly from Gmail',
    iconName: 'Mail',
    iconBg: 'bg-red-500/10 text-red-500',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'gmail_search_emails',
        displayName: 'Search Emails',
        description: 'Search emails in user Gmail mailbox by query or keyword',
        connectorId: 'gmail',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term, sender, or subject' },
            maxResults: { type: 'number', description: 'Maximum emails to return (default: 5)' }
          },
          required: ['query']
        }
      },
      {
        name: 'gmail_create_draft',
        displayName: 'Create Email Draft',
        description: 'Save a new email draft in Gmail',
        connectorId: 'gmail',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Body text or HTML content' }
          },
          required: ['subject', 'body']
        }
      },
      {
        name: 'gmail_send_email',
        displayName: 'Send Email',
        description: 'Send an email from the user Gmail account',
        connectorId: 'gmail',
        requiresConfirmation: true,
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email message body' },
            cc: { type: 'string', description: 'Optional CC email address' }
          },
          required: ['to', 'subject', 'body']
        }
      },
      {
        name: 'gmail_get_email',
        displayName: 'Get Email Details',
        description: 'Fetch complete message content and body from Gmail',
        connectorId: 'gmail',
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'ID of the email message' }
          },
          required: ['messageId']
        }
      },
      {
        name: 'gmail_trash_email',
        displayName: 'Trash Email',
        description: 'Move an email message to Trash in Gmail',
        connectorId: 'gmail',
        requiresConfirmation: true,
        parameters: {
          type: 'object',
          properties: {
            messageId: { type: 'string', description: 'ID of the email to trash' }
          },
          required: ['messageId']
        }
      }
    ]
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    category: 'workspace',
    description: 'Fetch schedule, upcoming events, and create calendar meetings',
    iconName: 'Calendar',
    iconBg: 'bg-blue-500/10 text-blue-500',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'calendar_list_events',
        displayName: 'List Calendar Events',
        description: 'Get upcoming schedule or events from Google Calendar',
        connectorId: 'calendar',
        parameters: {
          type: 'object',
          properties: {
            timeMin: { type: 'string', description: 'Start time in ISO format' },
            timeMax: { type: 'string', description: 'End time in ISO format' }
          }
        }
      },
      {
        name: 'calendar_search_events',
        displayName: 'Search Calendar Events',
        description: 'Search for events in Google Calendar matching a query',
        connectorId: 'calendar',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or title' }
          },
          required: ['query']
        }
      },
      {
        name: 'calendar_create_event',
        displayName: 'Create Calendar Meeting',
        description: 'Schedule a new event or meeting in Google Calendar',
        connectorId: 'calendar',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Event title' },
            startDateTime: { type: 'string', description: 'Start ISO datetime' },
            endDateTime: { type: 'string', description: 'End ISO datetime' },
            description: { type: 'string', description: 'Event details' },
            location: { type: 'string', description: 'Location or video link' }
          },
          required: ['summary', 'startDateTime', 'endDateTime']
        }
      },
      {
        name: 'calendar_update_event',
        displayName: 'Update Calendar Event',
        description: 'Update the title, time, or location of an existing calendar event',
        connectorId: 'calendar',
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'ID of the calendar event' },
            summary: { type: 'string', description: 'New event title' },
            startDateTime: { type: 'string', description: 'New start datetime' },
            endDateTime: { type: 'string', description: 'New end datetime' }
          },
          required: ['eventId']
        }
      },
      {
        name: 'calendar_delete_event',
        displayName: 'Delete Calendar Event',
        description: 'Cancel or delete an event from Google Calendar',
        connectorId: 'calendar',
        requiresConfirmation: true,
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: 'Calendar event ID to delete' }
          },
          required: ['eventId']
        }
      }
    ]
  },
  {
    id: 'drive',
    name: 'Google Drive',
    category: 'workspace',
    description: 'Access, search, create folders, upload, rename, and share files in Google Drive',
    iconName: 'HardDrive',
    iconBg: 'bg-emerald-500/10 text-emerald-500',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'drive_search_files',
        displayName: 'Search Drive Files',
        description: 'Find documents, PDFs, spreadsheets, and files in Google Drive',
        connectorId: 'drive',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'File name, keyword, or extension' },
            mimeType: { type: 'string', description: 'Optional mimeType filter' }
          },
          required: ['query']
        }
      },
      {
        name: 'drive_create_folder',
        displayName: 'Create Drive Folder',
        description: 'Create a new organized folder in Google Drive',
        connectorId: 'drive',
        parameters: {
          type: 'object',
          properties: {
            folderName: { type: 'string', description: 'Name of the folder to create' },
            parentFolderId: { type: 'string', description: 'Optional parent folder ID' }
          },
          required: ['folderName']
        }
      },
      {
        name: 'drive_create_file',
        displayName: 'Create Drive File',
        description: 'Create and save a new text or markdown file directly in Google Drive',
        connectorId: 'drive',
        parameters: {
          type: 'object',
          properties: {
            fileName: { type: 'string', description: 'File name e.g. notes.txt or summary.md' },
            content: { type: 'string', description: 'File text content' },
            mimeType: { type: 'string', description: 'Optional mime type, defaults to text/plain' }
          },
          required: ['fileName', 'content']
        }
      },
      {
        name: 'drive_rename_file',
        displayName: 'Rename Drive File',
        description: 'Rename an existing file or folder in Google Drive',
        connectorId: 'drive',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID' },
            newName: { type: 'string', description: 'New name for the file' }
          },
          required: ['fileId', 'newName']
        }
      },
      {
        name: 'drive_delete_file',
        displayName: 'Delete Drive File',
        description: 'Move a file in Google Drive to the Trash',
        connectorId: 'drive',
        requiresConfirmation: true,
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID to trash' }
          },
          required: ['fileId']
        }
      },
      {
        name: 'drive_share_file',
        displayName: 'Share Drive File',
        description: 'Share a Google Drive file with collaborator email or set permission',
        connectorId: 'drive',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID' },
            emailAddress: { type: 'string', description: 'Optional email to invite' },
            role: { type: 'string', enum: ['reader', 'commenter', 'writer'], description: 'Permission role' }
          },
          required: ['fileId']
        }
      }
    ]
  },
  {
    id: 'docs',
    name: 'Google Docs',
    category: 'workspace',
    description: 'Create, read, append, and edit documents in Google Docs',
    iconName: 'FileText',
    iconBg: 'bg-blue-600/10 text-blue-600',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'docs_create_doc',
        displayName: 'Create Google Doc',
        description: 'Create a new Google Document with formatted title and initial body text',
        connectorId: 'docs',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Document title' },
            content: { type: 'string', description: 'Initial document body text' }
          },
          required: ['title']
        }
      },
      {
        name: 'docs_read_document',
        displayName: 'Read Google Doc',
        description: 'Fetch text content and headings from a Google Doc',
        connectorId: 'docs',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'Google Document ID' }
          },
          required: ['documentId']
        }
      },
      {
        name: 'docs_append_text',
        displayName: 'Append Text to Doc',
        description: 'Append new paragraphs or sections to an existing Google Doc',
        connectorId: 'docs',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'Google Document ID' },
            text: { type: 'string', description: 'Text to append to the end of the document' }
          },
          required: ['documentId', 'text']
        }
      },
      {
        name: 'docs_replace_text',
        displayName: 'Replace Text in Doc',
        description: 'Find and replace text across a Google Doc',
        connectorId: 'docs',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'Google Document ID' },
            findText: { type: 'string', description: 'Text to search for' },
            replaceText: { type: 'string', description: 'Replacement text' }
          },
          required: ['documentId', 'findText', 'replaceText']
        }
      }
    ]
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    category: 'workspace',
    description: 'Create, read, update, and append data in Google Sheets spreadsheets',
    iconName: 'FileSpreadsheet',
    iconBg: 'bg-emerald-600/10 text-emerald-600',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'sheets_create_sheet',
        displayName: 'Create Spreadsheet',
        description: 'Create a new Google Sheet with title and initial table values',
        connectorId: 'sheets',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Spreadsheet title' },
            values: { type: 'array', description: '2D array of rows and column cell values' }
          },
          required: ['title']
        }
      },
      {
        name: 'sheets_read_data',
        displayName: 'Read Sheet Rows',
        description: 'Extract data rows and columns from Google Sheets',
        connectorId: 'sheets',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
            range: { type: 'string', description: 'Range e.g. Sheet1!A1:E50' }
          },
          required: ['spreadsheetId']
        }
      },
      {
        name: 'sheets_append_data',
        displayName: 'Append Rows to Sheet',
        description: 'Append rows of data to the end of a Google Sheets table',
        connectorId: 'sheets',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
            range: { type: 'string', description: 'Sheet range e.g. Sheet1!A1' },
            values: { type: 'array', description: '2D array of row items to append' }
          },
          required: ['spreadsheetId', 'values']
        }
      },
      {
        name: 'sheets_update_data',
        displayName: 'Update Sheet Range',
        description: 'Update specific cells or range in a Google Sheet',
        connectorId: 'sheets',
        parameters: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
            range: { type: 'string', description: 'Cell range to update e.g. Sheet1!A1:B5' },
            values: { type: 'array', description: '2D array of values' }
          },
          required: ['spreadsheetId', 'range', 'values']
        }
      }
    ]
  },
  {
    id: 'tasks',
    name: 'Google Tasks',
    category: 'workspace',
    description: 'Manage to-do lists, create tasks, and mark items complete in Google Tasks',
    iconName: 'CheckSquare',
    iconBg: 'bg-amber-500/10 text-amber-500',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'tasks_list_pending',
        displayName: 'List Tasks',
        description: 'Get pending task items from Google Tasks',
        connectorId: 'tasks',
        parameters: { 
          type: 'object', 
          properties: {
            showCompleted: { type: 'boolean', description: 'Whether to include completed tasks' }
          } 
        }
      },
      {
        name: 'tasks_create_task',
        displayName: 'Create Task',
        description: 'Create a new to-do item in Google Tasks with title, notes, and due date',
        connectorId: 'tasks',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            notes: { type: 'string', description: 'Task notes or description' },
            dueDate: { type: 'string', description: 'Due date in ISO format or YYYY-MM-DD' }
          },
          required: ['title']
        }
      },
      {
        name: 'tasks_complete_task',
        displayName: 'Complete Task',
        description: 'Mark a task as completed in Google Tasks',
        connectorId: 'tasks',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to mark complete' }
          },
          required: ['taskId']
        }
      },
      {
        name: 'tasks_delete_task',
        displayName: 'Delete Task',
        description: 'Delete a task from Google Tasks',
        connectorId: 'tasks',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to delete' }
          },
          required: ['taskId']
        }
      }
    ]
  },
  // 6. Google Slides
  {
    id: 'slides',
    name: 'Google Slides',
    category: 'workspace',
    description: 'Create presentations, read slide content, and add new slides in Google Slides',
    iconName: 'Presentation',
    iconBg: 'bg-amber-600/10 text-amber-600',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'slides_create_presentation',
        displayName: 'Create Presentation',
        description: 'Create a new Google Slides deck with a title',
        connectorId: 'slides',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Presentation title' }
          },
          required: ['title']
        }
      },
      {
        name: 'slides_read_presentation',
        displayName: 'Read Presentation',
        description: 'Read slides text, layout, and contents from a presentation',
        connectorId: 'slides',
        parameters: {
          type: 'object',
          properties: {
            presentationId: { type: 'string', description: 'Presentation ID' }
          },
          required: ['presentationId']
        }
      },
      {
        name: 'slides_add_slide',
        displayName: 'Add Slide',
        description: 'Add a new slide with title and body text to a presentation',
        connectorId: 'slides',
        parameters: {
          type: 'object',
          properties: {
            presentationId: { type: 'string', description: 'Presentation ID' },
            title: { type: 'string', description: 'Slide title' },
            body: { type: 'string', description: 'Slide body text or bullet points' }
          },
          required: ['presentationId']
        }
      }
    ]
  },

  // 7. Google Forms
  {
    id: 'forms',
    name: 'Google Forms',
    category: 'workspace',
    description: 'Create forms and surveys, add questions, and inspect responses in Google Forms',
    iconName: 'FileCheck',
    iconBg: 'bg-purple-600/10 text-purple-600',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'forms_create_form',
        displayName: 'Create Form',
        description: 'Create a new Google Form or survey',
        connectorId: 'forms',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Form title' }
          },
          required: ['title']
        }
      },
      {
        name: 'forms_add_question',
        displayName: 'Add Form Question',
        description: 'Add a question with choices or text to a Google Form',
        connectorId: 'forms',
        parameters: {
          type: 'object',
          properties: {
            formId: { type: 'string', description: 'Google Form ID' },
            questionTitle: { type: 'string', description: 'Question text' },
            type: { type: 'string', enum: ['TEXT', 'MULTIPLE_CHOICE', 'CHECKBOX', 'PARAGRAPH'], description: 'Question type' },
            options: { type: 'array', description: 'Choices for multiple choice or checkbox' }
          },
          required: ['formId', 'questionTitle']
        }
      },
      {
        name: 'forms_get_responses',
        displayName: 'Get Form Responses',
        description: 'Retrieve submitted respondent answers from a Google Form',
        connectorId: 'forms',
        parameters: {
          type: 'object',
          properties: {
            formId: { type: 'string', description: 'Google Form ID' }
          },
          required: ['formId']
        }
      }
    ]
  },
  // 8. Google Contacts
  {
    id: 'contacts',
    name: 'Google Contacts',
    category: 'workspace',
    description: 'Search, list, and create contacts in Google Contacts',
    iconName: 'Contact',
    iconBg: 'bg-cyan-600/10 text-cyan-600',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'contacts_list',
        displayName: 'List Contacts',
        description: 'List or search people in Google Contacts by name or email',
        connectorId: 'contacts',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional search query for name or email' }
          }
        }
      },
      {
        name: 'contacts_create',
        displayName: 'Create Contact',
        description: 'Create a new person entry in Google Contacts',
        connectorId: 'contacts',
        parameters: {
          type: 'object',
          properties: {
            givenName: { type: 'string', description: 'First name' },
            familyName: { type: 'string', description: 'Last name' },
            email: { type: 'string', description: 'Email address' },
            phone: { type: 'string', description: 'Phone number' },
            company: { type: 'string', description: 'Company name' },
            jobTitle: { type: 'string', description: 'Job title' }
          },
          required: ['givenName']
        }
      },
      {
        name: 'contacts_delete',
        displayName: 'Delete Contact',
        description: 'Delete a contact from Google Contacts',
        connectorId: 'contacts',
        requiresConfirmation: true,
        parameters: {
          type: 'object',
          properties: {
            resourceName: { type: 'string', description: 'Contact resource name e.g. people/c12345' }
          },
          required: ['resourceName']
        }
      }
    ]
  },

  // 9. Google Chat
  {
    id: 'chat',
    name: 'Google Chat',
    category: 'workspace',
    description: 'List spaces and post messages in Google Chat',
    iconName: 'MessageCircle',
    iconBg: 'bg-green-600/10 text-green-600',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'chat_list_spaces',
        displayName: 'List Chat Spaces',
        description: 'List accessible Google Chat rooms and spaces',
        connectorId: 'chat',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'chat_send_message',
        displayName: 'Send Chat Message',
        description: 'Post a message into a Google Chat space',
        connectorId: 'chat',
        requiresConfirmation: true,
        parameters: {
          type: 'object',
          properties: {
            spaceName: { type: 'string', description: 'Space name e.g. spaces/AAAA...' },
            text: { type: 'string', description: 'Message text to send' }
          },
          required: ['spaceName', 'text']
        }
      }
    ]
  },

  // 10. Google Meet
  {
    id: 'meet',
    name: 'Google Meet',
    category: 'workspace',
    description: 'Create scheduled video calls and instant video meeting spaces with Google Meet',
    iconName: 'Video',
    iconBg: 'bg-emerald-500/10 text-emerald-500',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'meet_create_meeting',
        displayName: 'Create Video Call',
        description: 'Schedule a Google Meet video conference with joining link',
        connectorId: 'meet',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Meeting topic or title' },
            startDateTime: { type: 'string', description: 'Start time in ISO format' },
            endDateTime: { type: 'string', description: 'End time in ISO format' }
          },
          required: ['summary', 'startDateTime', 'endDateTime']
        }
      },
      {
        name: 'meet_instant_meeting',
        displayName: 'Instant Meet Link',
        description: 'Generate an instant Google Meet video meeting link ready to join',
        connectorId: 'meet',
        parameters: { type: 'object', properties: {} }
      }
    ]
  },

  // 11. Google Keep
  {
    id: 'keep',
    name: 'Google Keep Notes',
    category: 'workspace',
    description: 'Save notes and thoughts to Google Keep / Drive note storage',
    iconName: 'StickyNote',
    iconBg: 'bg-yellow-500/10 text-yellow-500',
    authType: 'workspace',
    isWorkspaceAuth: true,
    tools: [
      {
        name: 'keep_create_note',
        displayName: 'Create Keep Note',
        description: 'Save a note with title and body text',
        connectorId: 'keep',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title' },
            content: { type: 'string', description: 'Note body content' }
          },
          required: ['title', 'content']
        }
      }
    ]
  },
  {
    id: 'web_search',
    name: 'Web Search',
    category: 'agent',
    description: 'Real-time live internet search & fact verification',
    iconName: 'Globe',
    iconBg: 'bg-indigo-500/10 text-indigo-500',
    authType: 'apiKey',
    defaultEnabled: true,
    tools: [
      {
        name: 'web_search',
        displayName: 'Live Web Search',
        description: 'Perform real-time Google web search for current events and news',
        connectorId: 'web_search',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term' }
          },
          required: ['query']
        }
      }
    ]
  },
  {
    id: 'code_sandbox',
    name: 'Python Sandbox',
    category: 'agent',
    description: 'Execute code scripts, process datasets, and generate output files',
    iconName: 'Terminal',
    iconBg: 'bg-cyan-500/10 text-cyan-500',
    authType: 'apiKey',
    defaultEnabled: true,
    tools: [
      {
        name: 'code_sandbox',
        displayName: 'Run Code Sandbox',
        description: 'Execute Python/JavaScript analysis scripts in sandbox container',
        connectorId: 'code_sandbox',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Code to execute' }
          },
          required: ['code']
        }
      }
    ]
  },
  {
    id: 'charts',
    name: 'Chart Visualizer',
    category: 'agent',
    description: 'Render interactive graphs, charts, and data visualizers',
    iconName: 'BarChart2',
    iconBg: 'bg-purple-500/10 text-purple-500',
    authType: 'apiKey',
    defaultEnabled: true,
    tools: [
      {
        name: 'chart_visualizer',
        displayName: 'Render Chart',
        description: 'Create interactive charts and graphs',
        connectorId: 'charts',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'bar, line, pie, etc.' },
            data: { type: 'object', description: 'Chart dataset' }
          }
        }
      }
    ]
  }
];

const CONNECTORS_STATE_KEY = 'manus_connector_states_v2';
const CUSTOM_CONNECTORS_KEY = 'manus_custom_connectors_v2';

// Local storage state helpers
export function getStoredConnectorStates(): Record<string, ConnectorState> {
  try {
    const raw = localStorage.getItem(CONNECTORS_STATE_KEY);
    if (!raw) {
      // Default setup
      const initial: Record<string, ConnectorState> = {};
      CONNECTOR_CATALOG.forEach(c => {
        if (c.defaultEnabled) {
          initial[c.id] = { connectorId: c.id, status: 'connected' };
        } else if (c.isWorkspaceAuth && getAccessToken()) {
          const u = getCurrentUser();
          initial[c.id] = {
            connectorId: c.id,
            status: 'connected',
            account: { email: u?.email || 'user@workspace.google.com', name: u?.displayName || 'Workspace User' }
          };
        } else {
          initial[c.id] = { connectorId: c.id, status: 'not_connected' };
        }
      });
      return initial;
    }
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveStoredConnectorStates(states: Record<string, ConnectorState>) {
  try {
    localStorage.setItem(CONNECTORS_STATE_KEY, JSON.stringify(states));
    window.dispatchEvent(new CustomEvent('manus_connectors_state_changed', { detail: states }));
  } catch (err) {
    console.warn('Failed to save connector states:', err);
  }
}

export function getConnectorState(connectorId: string): ConnectorState {
  // Check workspace auth dynamically for Google services
  const catalogItem = CONNECTOR_CATALOG.find(c => c.id === connectorId);
  if (catalogItem?.isWorkspaceAuth) {
    const token = getAccessToken();
    if (token) {
      const u = getCurrentUser();
      return {
        connectorId,
        status: 'connected',
        account: {
          email: u?.email || 'user@workspace.google.com',
          name: u?.displayName || 'Google Workspace Account',
          connectedAt: new Date().toISOString()
        }
      };
    }
  }

  const states = getStoredConnectorStates();
  return states[connectorId] || { connectorId, status: 'not_connected' };
}

export function updateConnectorState(connectorId: string, updates: Partial<ConnectorState>) {
  const states = getStoredConnectorStates();
  const current = states[connectorId] || { connectorId, status: 'not_connected' };
  states[connectorId] = {
    ...current,
    ...updates,
    connectorId,
    lastUsedAt: new Date().toISOString()
  };
  saveStoredConnectorStates(states);
  return states[connectorId];
}

// Custom Connectors Store
export function getCustomConnectors(): CustomConnectorConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CONNECTORS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomConnector(config: CustomConnectorConfig): boolean {
  try {
    // SSRF Check for Base URL
    const url = new URL(config.baseUrl);
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '169.254.169.254' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('172.16.')
    ) {
      throw new Error('Local, private network, and cloud metadata URLs are prohibited to prevent SSRF vulnerabilities.');
    }

    const current = getCustomConnectors();
    const updated = [...current.filter(c => c.id !== config.id), config];
    localStorage.setItem(CUSTOM_CONNECTORS_KEY, JSON.stringify(updated));

    // Register in connector state
    updateConnectorState(config.id, {
      connectorId: config.id,
      status: 'connected',
      customConfig: config,
      account: { name: config.name, email: config.baseUrl }
    });

    return true;
  } catch (err: any) {
    console.error('Custom connector registration failed:', err);
    throw err;
  }
}

export function deleteCustomConnector(id: string): boolean {
  try {
    const current = getCustomConnectors();
    const updated = current.filter(c => c.id !== id);
    localStorage.setItem(CUSTOM_CONNECTORS_KEY, JSON.stringify(updated));
    
    const states = getStoredConnectorStates();
    delete states[id];
    saveStoredConnectorStates(states);
    return true;
  } catch {
    return false;
  }
}

// Global List of Tools Discoverable by AI
export function listTools(onlyConnected = true): ConnectorToolDef[] {
  const tools: ConnectorToolDef[] = [];
  const catalog = CONNECTOR_CATALOG;

  catalog.forEach(item => {
    const state = getConnectorState(item.id);
    if (!onlyConnected || state.status === 'connected') {
      tools.push(...item.tools);
    }
  });

  // Include Custom Connectors
  const custom = getCustomConnectors();
  custom.forEach(cc => {
    const state = getConnectorState(cc.id);
    if (!onlyConnected || state.status === 'connected') {
      tools.push({
        name: `custom_${cc.id}_query`,
        displayName: `${cc.name} Query`,
        description: cc.description || `Query endpoint for ${cc.name}`,
        connectorId: cc.id,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or request parameter' }
          }
        }
      });
    }
  });

  return tools;
}

// Intent Detection: Match user natural language prompt to candidate connector tools
export interface DetectedToolIntent {
  matched: boolean;
  connectorId: string;
  connectorName: string;
  toolName: string;
  status: ConnectorStatus;
  suggestedAction: string;
  args: Record<string, any>;
  requiresConfirmation?: boolean;
}

export function detectToolIntent(userPrompt: string): DetectedToolIntent | null {
  const p = userPrompt.toLowerCase().trim();

  // 1. Google Drive
  if (/(create folder|new folder|make a folder)/i.test(p)) {
    const state = getConnectorState('drive');
    const folderName = userPrompt.replace(/(create|new|make a|make|folder|called|named|in drive|in google drive)/gi, '').trim() || 'New Folder';
    return {
      matched: true,
      connectorId: 'drive',
      connectorName: 'Google Drive',
      toolName: 'drive_create_folder',
      status: state.status,
      suggestedAction: `Creating Google Drive folder "${folderName}"`,
      args: { folderName }
    };
  }

  if (/(share file|share drive file|give access to file)/i.test(p)) {
    const state = getConnectorState('drive');
    const emailMatch = userPrompt.match(/[\w.-]+@[\w.-]+\.\w+/);
    return {
      matched: true,
      connectorId: 'drive',
      connectorName: 'Google Drive',
      toolName: 'drive_share_file',
      status: state.status,
      suggestedAction: 'Sharing Google Drive file',
      args: { fileId: 'root', emailAddress: emailMatch ? emailMatch[0] : undefined, role: 'reader' }
    };
  }

  if (/(pdf|drive|google drive|find my file|search my documents|latest document|my drive|stored file|search drive|files in drive)/i.test(p)) {
    const state = getConnectorState('drive');
    const query = userPrompt.replace(/(find my|search|latest|in google drive|in drive|my|files in drive|file|pdf|document)/gi, '').trim() || 'PDF';
    return {
      matched: true,
      connectorId: 'drive',
      connectorName: 'Google Drive',
      toolName: 'drive_search_files',
      status: state.status,
      suggestedAction: `Searching Google Drive for "${query}"`,
      args: { query }
    };
  }

  // 2. Google Docs
  if (/(create google doc|create doc|new google doc|new doc|create document|write doc|make a doc)/i.test(p)) {
    const state = getConnectorState('docs');
    const title = userPrompt.replace(/(create google doc|create doc|new google doc|new doc|create document|write doc|make a doc|called|named|titled|about)/gi, '').trim() || 'Untitled Document';
    return {
      matched: true,
      connectorId: 'docs',
      connectorName: 'Google Docs',
      toolName: 'docs_create_doc',
      status: state.status,
      suggestedAction: `Creating Google Doc "${title}"`,
      args: { title, content: `Document: ${title}\nGenerated by Manus AI Assistant.` }
    };
  }

  if (/(append to doc|append to document|add text to doc|add to google doc)/i.test(p)) {
    const state = getConnectorState('docs');
    return {
      matched: true,
      connectorId: 'docs',
      connectorName: 'Google Docs',
      toolName: 'docs_append_text',
      status: state.status,
      suggestedAction: 'Appending content to Google Doc',
      args: { documentId: 'latest', text: userPrompt }
    };
  }

  if (/(read google doc|read doc|read document|document content)/i.test(p)) {
    const state = getConnectorState('docs');
    return {
      matched: true,
      connectorId: 'docs',
      connectorName: 'Google Docs',
      toolName: 'docs_read_document',
      status: state.status,
      suggestedAction: 'Reading Google Doc content',
      args: { documentId: 'latest' }
    };
  }

  // 3. Google Sheets
  if (/(create google sheet|create sheet|new google sheet|new sheet|create spreadsheet|make a sheet|new spreadsheet)/i.test(p)) {
    const state = getConnectorState('sheets');
    const title = userPrompt.replace(/(create google sheet|create sheet|new google sheet|new sheet|create spreadsheet|make a sheet|new spreadsheet|called|named|titled|about)/gi, '').trim() || 'New Spreadsheet';
    return {
      matched: true,
      connectorId: 'sheets',
      connectorName: 'Google Sheets',
      toolName: 'sheets_create_sheet',
      status: state.status,
      suggestedAction: `Creating Google Sheet "${title}"`,
      args: { title, values: [['Item', 'Category', 'Date', 'Amount']] }
    };
  }

  if (/(read sheet|read google sheet|sheet data|spreadsheet data|rows in sheet)/i.test(p)) {
    const state = getConnectorState('sheets');
    return {
      matched: true,
      connectorId: 'sheets',
      connectorName: 'Google Sheets',
      toolName: 'sheets_read_data',
      status: state.status,
      suggestedAction: 'Reading Google Sheets data',
      args: { spreadsheetId: 'latest', range: 'Sheet1!A1:Z50' }
    };
  }

  // 4. Google Slides
  if (/(create google slide|create presentation|new presentation|make slides|make presentation|new slide deck)/i.test(p)) {
    const state = getConnectorState('slides');
    const title = userPrompt.replace(/(create google slide|create presentation|new presentation|make slides|make presentation|new slide deck|called|named|titled|about)/gi, '').trim() || 'New Presentation';
    return {
      matched: true,
      connectorId: 'slides',
      connectorName: 'Google Slides',
      toolName: 'slides_create_presentation',
      status: state.status,
      suggestedAction: `Creating Google Slides presentation "${title}"`,
      args: { title }
    };
  }

  if (/(add slide|new slide in presentation)/i.test(p)) {
    const state = getConnectorState('slides');
    return {
      matched: true,
      connectorId: 'slides',
      connectorName: 'Google Slides',
      toolName: 'slides_add_slide',
      status: state.status,
      suggestedAction: 'Adding new slide to presentation',
      args: { presentationId: 'latest', title: 'New Slide', body: userPrompt }
    };
  }

  // 5. Google Calendar
  if (/(schedule meeting|create calendar event|schedule a meeting|schedule a call|set up meeting|calendar event)/i.test(p)) {
    const state = getConnectorState('calendar');
    const summary = userPrompt.replace(/(schedule meeting|create calendar event|schedule a meeting|schedule a call|set up meeting|calendar event|with|for|at|on)/gi, '').trim() || 'Meeting';
    const tomorrow = new Date(Date.now() + 86400000);
    return {
      matched: true,
      connectorId: 'calendar',
      connectorName: 'Google Calendar',
      toolName: 'calendar_create_event',
      status: state.status,
      suggestedAction: `Scheduling Google Calendar event "${summary}"`,
      args: {
        summary,
        startDateTime: tomorrow.toISOString(),
        endDateTime: new Date(tomorrow.getTime() + 3600000).toISOString()
      }
    };
  }

  if (/(calendar|events|meetings|upcoming schedule|agenda|team sync|my schedule|what is on my calendar)/i.test(p)) {
    const state = getConnectorState('calendar');
    return {
      matched: true,
      connectorId: 'calendar',
      connectorName: 'Google Calendar',
      toolName: 'calendar_list_events',
      status: state.status,
      suggestedAction: 'Fetching upcoming Google Calendar events',
      args: { timeMin: new Date().toISOString() }
    };
  }

  // 6. Gmail
  if (/(send email|send mail|compose and send email)/i.test(p)) {
    const state = getConnectorState('gmail');
    const emailMatch = userPrompt.match(/[\w.-]+@[\w.-]+\.\w+/);
    const to = emailMatch ? emailMatch[0] : 'recipient@example.com';
    return {
      matched: true,
      connectorId: 'gmail',
      connectorName: 'Gmail',
      toolName: 'gmail_send_email',
      status: state.status,
      suggestedAction: `Sending email via Gmail to ${to}`,
      args: {
        to,
        subject: 'Follow-up from Manus Assistant',
        body: userPrompt
      },
      requiresConfirmation: true
    };
  }

  if (/(draft email|create email draft|save email draft|email draft)/i.test(p)) {
    const state = getConnectorState('gmail');
    const emailMatch = userPrompt.match(/[\w.-]+@[\w.-]+\.\w+/);
    return {
      matched: true,
      connectorId: 'gmail',
      connectorName: 'Gmail',
      toolName: 'gmail_create_draft',
      status: state.status,
      suggestedAction: 'Creating Gmail draft',
      args: {
        to: emailMatch ? emailMatch[0] : '',
        subject: 'Project Update & Action Items',
        body: userPrompt
      }
    };
  }

  if (/(email|gmail|emails|mail|project deadline|inbox|check email|search mail)/i.test(p)) {
    const state = getConnectorState('gmail');
    const query = userPrompt.replace(/(search my|emails|gmail|for|find|mail|inbox|project|deadline|check)/gi, '').trim() || 'in:inbox';
    return {
      matched: true,
      connectorId: 'gmail',
      connectorName: 'Gmail',
      toolName: 'gmail_search_emails',
      status: state.status,
      suggestedAction: `Searching Gmail emails for "${query}"`,
      args: { query }
    };
  }

  // 7. Google Tasks
  if (/(create task|add task|add to-do|add todo|new task|remind me to)/i.test(p)) {
    const state = getConnectorState('tasks');
    const title = userPrompt.replace(/(create task|add task|add to-do|add todo|new task|remind me to|to)/gi, '').trim() || 'New Task';
    return {
      matched: true,
      connectorId: 'tasks',
      connectorName: 'Google Tasks',
      toolName: 'tasks_create_task',
      status: state.status,
      suggestedAction: `Creating Google Task "${title}"`,
      args: { title }
    };
  }

  if (/(tasks|to-do list|todo list|pending tasks|my tasks|my todos)/i.test(p)) {
    const state = getConnectorState('tasks');
    return {
      matched: true,
      connectorId: 'tasks',
      connectorName: 'Google Tasks',
      toolName: 'tasks_list_pending',
      status: state.status,
      suggestedAction: 'Listing Google Tasks',
      args: {}
    };
  }

  // 8. Google Forms
  if (/(create google form|create form|new form|make a survey|create survey)/i.test(p)) {
    const state = getConnectorState('forms');
    const title = userPrompt.replace(/(create google form|create form|new form|make a survey|create survey|called|named|titled|about)/gi, '').trim() || 'Feedback Survey';
    return {
      matched: true,
      connectorId: 'forms',
      connectorName: 'Google Forms',
      toolName: 'forms_create_form',
      status: state.status,
      suggestedAction: `Creating Google Form "${title}"`,
      args: { title }
    };
  }

  if (/(form responses|survey responses|survey results)/i.test(p)) {
    const state = getConnectorState('forms');
    return {
      matched: true,
      connectorId: 'forms',
      connectorName: 'Google Forms',
      toolName: 'forms_get_responses',
      status: state.status,
      suggestedAction: 'Fetching Google Form responses',
      args: { formId: 'latest' }
    };
  }

  // 9. Google Contacts
  if (/(add contact|create contact|save contact|new contact)/i.test(p)) {
    const state = getConnectorState('contacts');
    const emailMatch = userPrompt.match(/[\w.-]+@[\w.-]+\.\w+/);
    const words = userPrompt.replace(/(add contact|create contact|save contact|new contact|named|called|with email)/gi, '').trim().split(/\s+/);
    const givenName = words[0] || 'New Contact';
    const familyName = words[1] || '';
    return {
      matched: true,
      connectorId: 'contacts',
      connectorName: 'Google Contacts',
      toolName: 'contacts_create',
      status: state.status,
      suggestedAction: `Creating Google Contact "${givenName} ${familyName}"`.trim(),
      args: { givenName, familyName, email: emailMatch ? emailMatch[0] : undefined }
    };
  }

  if (/(contacts|my contacts|search contacts|find contact|list contacts)/i.test(p)) {
    const state = getConnectorState('contacts');
    const query = userPrompt.replace(/(contacts|my contacts|search contacts|find contact|list contacts|for|named)/gi, '').trim();
    return {
      matched: true,
      connectorId: 'contacts',
      connectorName: 'Google Contacts',
      toolName: 'contacts_list',
      status: state.status,
      suggestedAction: query ? `Searching contacts for "${query}"` : 'Listing Google Contacts',
      args: { query }
    };
  }

  // 10. Google Chat
  if (/(google chat|chat message|send to chat|post to chat|chat space)/i.test(p)) {
    const state = getConnectorState('chat');
    return {
      matched: true,
      connectorId: 'chat',
      connectorName: 'Google Chat',
      toolName: p.includes('send') || p.includes('post') ? 'chat_send_message' : 'chat_list_spaces',
      status: state.status,
      suggestedAction: p.includes('send') || p.includes('post') ? 'Posting message to Google Chat' : 'Listing Google Chat spaces',
      args: { text: userPrompt, spaceName: 'spaces/general' },
      requiresConfirmation: p.includes('send') || p.includes('post')
    };
  }

  // 11. Google Meet
  if (/(create meet link|google meet|instant meeting|video call|start a meeting|meet link)/i.test(p)) {
    const state = getConnectorState('meet');
    return {
      matched: true,
      connectorId: 'meet',
      connectorName: 'Google Meet',
      toolName: p.includes('instant') ? 'meet_instant_meeting' : 'meet_create_meeting',
      status: state.status,
      suggestedAction: 'Generating Google Meet video conference link',
      args: {
        summary: 'Manus Video Meeting',
        startDateTime: new Date().toISOString(),
        endDateTime: new Date(Date.now() + 3600000).toISOString()
      }
    };
  }

  // 12. Google Keep
  if (/(keep note|save note|create note|take a note)/i.test(p)) {
    const state = getConnectorState('keep');
    const title = userPrompt.replace(/(keep note|save note|create note|take a note|called|named|titled|about)/gi, '').trim() || 'Quick Note';
    return {
      matched: true,
      connectorId: 'keep',
      connectorName: 'Google Keep',
      toolName: 'keep_create_note',
      status: state.status,
      suggestedAction: `Saving Google Keep note "${title}"`,
      args: { title, content: userPrompt }
    };
  }

  return null;
}

// Tool Execution Pipeline
export async function executeConnectorTool(
  toolName: string, 
  args: Record<string, any>
): Promise<ToolExecutionResult> {
  // Identify parent connector
  const catalogItem = CONNECTOR_CATALOG.find(c => c.tools.some(t => t.name === toolName));
  const connectorId = catalogItem ? catalogItem.id : toolName.split('_')[1] || 'custom';
  const state = getConnectorState(connectorId);

  // Connection & Permission Validation
  if (state.status !== 'connected' && !catalogItem?.defaultEnabled) {
    return {
      success: false,
      connectorId,
      toolName,
      error: 'permission_required',
      message: `The ${catalogItem?.name || connectorId} connector is not connected. Please connect your Google Workspace account to authorize access.`
    };
  }

  try {
    // 1. Google Drive execution
    if (toolName === 'drive_search_files') {
      const files = await searchGoogleDriveFiles(args.query || '');
      return {
        success: true,
        connectorId: 'drive',
        toolName,
        data: files,
        message: `Found ${files.length} document(s) in Google Drive for "${args.query}"`
      };
    }

    if (toolName === 'drive_create_folder') {
      const folder = await createGoogleDriveFolder(args.folderName || 'New Folder', args.parentFolderId);
      return {
        success: true,
        connectorId: 'drive',
        toolName,
        data: folder,
        message: `Created Google Drive folder "${folder.name}" (${folder.webViewLink})`
      };
    }

    if (toolName === 'drive_create_file') {
      const file = await createGoogleDriveFile(args.fileName || 'file.txt', args.content || '', args.mimeType, args.parentFolderId);
      return {
        success: true,
        connectorId: 'drive',
        toolName,
        data: file,
        message: `Created file "${file.name}" in Google Drive (${file.webViewLink})`
      };
    }

    if (toolName === 'drive_rename_file') {
      const file = await renameGoogleDriveFile(args.fileId, args.newName);
      return {
        success: true,
        connectorId: 'drive',
        toolName,
        data: file,
        message: `Renamed file to "${file.name}" in Google Drive`
      };
    }

    if (toolName === 'drive_delete_file') {
      const res = await deleteGoogleDriveFile(args.fileId);
      return {
        success: true,
        connectorId: 'drive',
        toolName,
        data: res,
        message: `Moved file ${args.fileId} to Google Drive Trash`
      };
    }

    if (toolName === 'drive_share_file') {
      const res = await shareGoogleDriveFile(args.fileId, args.role, args.emailAddress);
      return {
        success: true,
        connectorId: 'drive',
        toolName,
        data: res,
        message: `Shared Google Drive file with ${args.emailAddress || 'anyone'} as ${args.role || 'reader'}`
      };
    }

    // 2. Google Docs execution
    if (toolName === 'docs_create_doc') {
      const doc = await createGoogleDoc(args.title || 'Untitled Document', args.content);
      return {
        success: true,
        connectorId: 'docs',
        toolName,
        data: doc,
        message: `Created Google Doc "${doc.title}": ${doc.webViewLink}`
      };
    }

    if (toolName === 'docs_read_document') {
      const text = await getGoogleDocText(args.documentId);
      return {
        success: true,
        connectorId: 'docs',
        toolName,
        data: { text },
        message: `Successfully read Google Doc (${text.length} characters)`
      };
    }

    if (toolName === 'docs_append_text') {
      const res = await appendGoogleDocText(args.documentId, args.text);
      return {
        success: true,
        connectorId: 'docs',
        toolName,
        data: res,
        message: `Appended text to Google Doc ${args.documentId}`
      };
    }

    if (toolName === 'docs_replace_text') {
      const res = await replaceGoogleDocText(args.documentId, args.findText, args.replaceText);
      return {
        success: true,
        connectorId: 'docs',
        toolName,
        data: res,
        message: `Replaced ${res.occurrencesChanged} instance(s) of "${args.findText}" in Google Doc`
      };
    }

    // 3. Google Sheets execution
    if (toolName === 'sheets_create_sheet') {
      const sheet = await createGoogleSheet(args.title || 'New Spreadsheet', args.values);
      return {
        success: true,
        connectorId: 'sheets',
        toolName,
        data: sheet,
        message: `Created Google Sheet "${sheet.title}": ${sheet.webViewLink}`
      };
    }

    if (toolName === 'sheets_read_data') {
      const res = await getGoogleSheetValues(args.spreadsheetId, args.range);
      return {
        success: true,
        connectorId: 'sheets',
        toolName,
        data: res,
        message: `Retrieved ${res.values?.length || 0} rows from range ${res.range}`
      };
    }

    if (toolName === 'sheets_append_data') {
      const res = await appendGoogleSheetValues(args.spreadsheetId, args.range || 'Sheet1!A1', args.values || []);
      return {
        success: true,
        connectorId: 'sheets',
        toolName,
        data: res,
        message: `Appended rows to Google Sheet ${args.spreadsheetId}`
      };
    }

    if (toolName === 'sheets_update_data') {
      const res = await updateGoogleSheetValues(args.spreadsheetId, args.range, args.values);
      return {
        success: true,
        connectorId: 'sheets',
        toolName,
        data: res,
        message: `Updated cells in Google Sheet ${args.spreadsheetId}`
      };
    }

    // 4. Google Slides execution
    if (toolName === 'slides_create_presentation') {
      const slide = await createGoogleSlide(args.title || 'Untitled Presentation');
      return {
        success: true,
        connectorId: 'slides',
        toolName,
        data: slide,
        message: `Created Google Slides deck "${slide.title}": ${slide.webViewLink}`
      };
    }

    if (toolName === 'slides_read_presentation') {
      const text = await getGoogleSlidesText(args.presentationId);
      return {
        success: true,
        connectorId: 'slides',
        toolName,
        data: { text },
        message: `Read presentation slides successfully`
      };
    }

    if (toolName === 'slides_add_slide') {
      const res = await addGoogleSlide(args.presentationId, args.title, args.body);
      return {
        success: true,
        connectorId: 'slides',
        toolName,
        data: res,
        message: `Added slide "${args.title || 'Untitled'}" to presentation`
      };
    }

    // 5. Google Calendar execution
    if (toolName === 'calendar_list_events') {
      const events = await listGoogleCalendarEvents(args.timeMin);
      return {
        success: true,
        connectorId: 'calendar',
        toolName,
        data: events,
        message: `Retrieved ${events.length} upcoming event(s) from Google Calendar`
      };
    }

    if (toolName === 'calendar_search_events') {
      const events = await searchGoogleCalendarEvents(args.query);
      return {
        success: true,
        connectorId: 'calendar',
        toolName,
        data: events,
        message: `Found ${events.length} event(s) matching "${args.query}"`
      };
    }

    if (toolName === 'calendar_create_event') {
      const created = await createGoogleCalendarEvent({
        summary: args.summary || 'Meeting',
        startDateTime: args.startDateTime || new Date().toISOString(),
        endDateTime: args.endDateTime || new Date(Date.now() + 3600000).toISOString(),
        description: args.description || '',
        location: args.location || ''
      });
      return {
        success: true,
        connectorId: 'calendar',
        toolName,
        data: created,
        message: `Successfully scheduled "${created.summary}" on Google Calendar (${created.htmlLink})`
      };
    }

    if (toolName === 'calendar_update_event') {
      const updated = await updateGoogleCalendarEvent(args.eventId, args);
      return {
        success: true,
        connectorId: 'calendar',
        toolName,
        data: updated,
        message: `Updated Google Calendar event "${updated.summary}"`
      };
    }

    if (toolName === 'calendar_delete_event') {
      const res = await deleteGoogleCalendarEvent(args.eventId);
      return {
        success: true,
        connectorId: 'calendar',
        toolName,
        data: res,
        message: `Deleted calendar event ${args.eventId}`
      };
    }

    // 6. Gmail execution
    if (toolName === 'gmail_search_emails') {
      const emails = await searchGmailMessages(args.query || '');
      return {
        success: true,
        connectorId: 'gmail',
        toolName,
        data: emails,
        message: `Found ${emails.length} email thread(s) in Gmail for "${args.query}"`
      };
    }

    if (toolName === 'gmail_get_email') {
      const msg = await getGmailMessage(args.messageId);
      return {
        success: true,
        connectorId: 'gmail',
        toolName,
        data: msg,
        message: `Retrieved email: "${msg.subject}" from ${msg.from}`
      };
    }

    if (toolName === 'gmail_create_draft') {
      const draft = await createGmailDraft({
        to: args.to,
        subject: args.subject || 'Draft',
        body: args.body || ''
      });
      return {
        success: true,
        connectorId: 'gmail',
        toolName,
        data: draft,
        message: `Created Gmail draft: "${args.subject}"`
      };
    }

    if (toolName === 'gmail_send_email') {
      const res = await sendGmailEmail({
        to: args.to,
        subject: args.subject || 'No Subject',
        body: args.body || '',
        cc: args.cc
      });
      return {
        success: true,
        connectorId: 'gmail',
        toolName,
        data: res,
        message: `Successfully sent email to ${args.to} with subject "${args.subject}"`
      };
    }

    if (toolName === 'gmail_trash_email') {
      const res = await trashGmailMessage(args.messageId);
      return {
        success: true,
        connectorId: 'gmail',
        toolName,
        data: res,
        message: `Moved email ${args.messageId} to Trash in Gmail`
      };
    }

    // 7. Google Tasks execution
    if (toolName === 'tasks_list_pending') {
      const tasks = await listGoogleTasks(args.taskListId, args.showCompleted);
      return {
        success: true,
        connectorId: 'tasks',
        toolName,
        data: tasks,
        message: `Retrieved ${tasks.length} task(s) from Google Tasks`
      };
    }

    if (toolName === 'tasks_create_task') {
      const task = await createGoogleTask(args.title, args.notes, args.dueDate);
      return {
        success: true,
        connectorId: 'tasks',
        toolName,
        data: task,
        message: `Created Google Task "${task.title || args.title}"`
      };
    }

    if (toolName === 'tasks_complete_task') {
      const res = await completeGoogleTask(args.taskId, args.taskListId);
      return {
        success: true,
        connectorId: 'tasks',
        toolName,
        data: res,
        message: `Marked task ${args.taskId} as completed in Google Tasks`
      };
    }

    if (toolName === 'tasks_delete_task') {
      const res = await deleteGoogleTask(args.taskId, args.taskListId);
      return {
        success: true,
        connectorId: 'tasks',
        toolName,
        data: res,
        message: `Deleted task ${args.taskId} from Google Tasks`
      };
    }

    // 8. Google Forms execution
    if (toolName === 'forms_create_form') {
      const form = await createGoogleForm(args.title || 'New Form');
      return {
        success: true,
        connectorId: 'forms',
        toolName,
        data: form,
        message: `Created Google Form "${form.title}": ${form.webViewLink}`
      };
    }

    if (toolName === 'forms_add_question') {
      const res = await addGoogleFormQuestion(args.formId, args.questionTitle, args.type, args.options);
      return {
        success: true,
        connectorId: 'forms',
        toolName,
        data: res,
        message: `Added question "${args.questionTitle}" to Google Form`
      };
    }

    if (toolName === 'forms_get_responses') {
      const res = await getGoogleFormResponses(args.formId);
      return {
        success: true,
        connectorId: 'forms',
        toolName,
        data: res,
        message: `Retrieved ${res.length} response(s) from Google Form`
      };
    }

    // 9. Google Contacts execution
    if (toolName === 'contacts_list') {
      const contacts = await listGoogleContacts(args.query);
      return {
        success: true,
        connectorId: 'contacts',
        toolName,
        data: contacts,
        message: `Found ${contacts.length} contact(s) in Google Contacts`
      };
    }

    if (toolName === 'contacts_create') {
      const contact = await createGoogleContact({
        givenName: args.givenName || 'New Contact',
        familyName: args.familyName,
        email: args.email,
        phone: args.phone,
        company: args.company,
        jobTitle: args.jobTitle
      });
      return {
        success: true,
        connectorId: 'contacts',
        toolName,
        data: contact,
        message: `Created Google Contact "${contact.name}" (${contact.email || contact.phone || ''})`
      };
    }

    if (toolName === 'contacts_delete') {
      const res = await deleteGoogleContact(args.resourceName);
      return {
        success: true,
        connectorId: 'contacts',
        toolName,
        data: res,
        message: `Deleted contact from Google Contacts`
      };
    }

    // 10. Google Chat execution
    if (toolName === 'chat_list_spaces') {
      const spaces = await listGoogleChatSpaces();
      return {
        success: true,
        connectorId: 'chat',
        toolName,
        data: spaces,
        message: `Retrieved ${spaces.length} Google Chat space(s)`
      };
    }

    if (toolName === 'chat_send_message') {
      const res = await sendGoogleChatMessage(args.spaceName, args.text);
      return {
        success: true,
        connectorId: 'chat',
        toolName,
        data: res,
        message: `Posted message to Google Chat space ${args.spaceName}`
      };
    }

    // 11. Google Meet execution
    if (toolName === 'meet_create_meeting') {
      const call = await createGoogleMeetCall(args.summary || 'Video Call', args.startDateTime, args.endDateTime);
      return {
        success: true,
        connectorId: 'meet',
        toolName,
        data: call,
        message: `Created Google Meet video call: ${call.meetUri}`
      };
    }

    if (toolName === 'meet_instant_meeting') {
      const call = await createInstantGoogleMeetSpace();
      return {
        success: true,
        connectorId: 'meet',
        toolName,
        data: call,
        message: `Generated instant Google Meet link: ${(call as any).meetingUri || (call as any).meetUri}`
      };
    }

    // 12. Google Keep execution
    if (toolName === 'keep_create_note') {
      const note = await createGoogleKeepNote(args.title, args.content);
      return {
        success: true,
        connectorId: 'keep',
        toolName,
        data: note,
        message: `Saved note "${note.title}" to Google Keep / Drive (${note.webViewLink})`
      };
    }

    // Server API Proxy Execution for other tools
    const serverRes = await fetch('/api/connectors/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId, toolName, args })
    });

    if (serverRes.ok) {
      const serverData = await serverRes.json();
      return {
        success: true,
        connectorId,
        toolName,
        data: serverData.data,
        message: serverData.message || `Executed ${toolName} successfully`
      };
    }

    const errJson = await serverRes.json().catch(() => ({}));
    const errorMsg = errJson.error || errJson.message || `Could not execute ${toolName}`;
    handleConnectorError(connectorId, errorMsg, { rawError: errJson });
    return {
      success: false,
      connectorId,
      toolName,
      error: errJson.error || 'Execution failed',
      message: errJson.message || `Could not execute ${toolName}`
    };

  } catch (err: any) {
    handleConnectorError(connectorId, err, { rawError: err });
    return {
      success: false,
      connectorId,
      toolName,
      error: err.message || 'Execution error',
      message: `Error executing ${toolName}: ${err.message}`
    };
  }
}

// OAuth Flow Handler
export async function startOAuthFlow(connectorId: string): Promise<boolean> {
  const item = CONNECTOR_CATALOG.find(c => c.id === connectorId);
  
  if (item?.isWorkspaceAuth) {
    try {
      updateConnectorState(connectorId, { status: 'connecting' });
      const res = await googleSignIn();
      if (res) {
        updateConnectorState(connectorId, {
          status: 'connected',
          account: { email: res.user.email || '', name: res.user.displayName || 'Google Workspace Account' }
        });
        return true;
      }
    } catch (e: any) {
      handleConnectorError(connectorId, e, { issueType: 'connection_failed', customMessage: e?.message || 'Google Workspace authentication failed' });
      return false;
    }
  }

  try {
    updateConnectorState(connectorId, { status: 'connecting' });
    
    // Fetch OAuth URL from server endpoint
    const res = await fetch(`/api/connectors/${connectorId}/auth-url`);
    if (res.ok) {
      const data = await res.json();
      if (data.url) {
        // Open OAuth provider popup
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        
        window.open(data.url, `OAuth_${connectorId}`, `width=${width},height=${height},top=${top},left=${left}`);
      }
    }

    // Simulate instant secure authorization connection in container preview
    await new Promise(r => setTimeout(r, 600));
    updateConnectorState(connectorId, {
      status: 'connected',
      account: {
        id: `${connectorId}_usr_101`,
        name: `${item?.name || connectorId} Connected User`,
        email: `connected.${connectorId}@manus.ai`,
        connectedAt: new Date().toISOString()
      }
    });

    return true;
  } catch (err: any) {
    handleConnectorError(connectorId, err, { issueType: 'connection_failed', customMessage: err.message });
    return false;
  }
}

export interface GitHubRepository {
  id: number | string;
  name: string;
  fullName: string;
  description?: string;
  url: string;
  stars: number;
  forks?: number;
  language?: string;
  openIssuesCount?: number;
  defaultBranch?: string;
  isPrivate: boolean;
  updatedAt?: string;
}

/**
 * Fetches user-accessible repositories from GitHub connector
 */
export async function listRepositories(args: {
  visibility?: 'all' | 'public' | 'private' | string;
  sort?: 'created' | 'updated' | 'pushed' | 'full_name' | string;
  perPage?: number;
} = {}): Promise<{
  success: boolean;
  data?: GitHubRepository[];
  error?: string;
  message?: string;
}> {
  try {
    const res = await fetch('/api/connectors/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectorId: 'github',
        toolName: 'listRepositories',
        args
      })
    });
    if (res.ok) {
      const json = await res.json();
      return {
        success: true,
        data: json.data || [],
        message: json.message
      };
    }
    const err = await res.json().catch(() => ({}));
    return {
      success: false,
      error: err.error || 'EXECUTION_FAILED',
      message: err.message || 'Could not fetch repositories'
    };
  } catch (err: any) {
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: err.message || 'Failed to fetch repositories from GitHub'
    };
  }
}

export async function disconnectConnector(connectorId: string): Promise<boolean> {
  const item = CONNECTOR_CATALOG.find(c => c.id === connectorId);
  
  if (item?.isWorkspaceAuth) {
    await logoutWorkspace();
  }

  updateConnectorState(connectorId, {
    status: 'not_connected',
    account: undefined,
    errorMessage: undefined
  });

  try {
    await fetch(`/api/connectors/${connectorId}/disconnect`, { method: 'POST' });
  } catch {}

  return true;
}
