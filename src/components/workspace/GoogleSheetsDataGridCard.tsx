import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  RefreshCw,
  Plus,
  Save,
  ExternalLink,
  Check,
  AlertCircle,
  Loader2,
  Table,
  FolderOpen,
  ShieldAlert,
} from 'lucide-react';
import { getAccessToken, googleSignIn } from '@/lib/workspaceAuth';
import {
  getGoogleSpreadsheetMetadata,
  getGoogleSheetValues,
  updateGoogleSheetValues,
  appendGoogleSheetValues,
  createGoogleSheet,
  GoogleSheetTabProperty,
} from '@/lib/workspaceTools';
import { googleDriveService, GoogleDriveFileItem } from '@/lib/googleDriveService';
import { toast } from 'sonner';

export interface GoogleSheetsDataGridCardProps {
  initialTitle?: string;
  initialSpreadsheetId?: string;
  initialValues?: string[][];
  onSelectSpreadsheet?: (spreadsheetId: string, title: string) => void;
}

type PendingSheetMutation =
  | {
      kind: 'update_grid';
      spreadsheetId: string;
      spreadsheetTitle: string;
      sheetTab: string;
      range: string;
      values: string[][];
    }
  | {
      kind: 'append_row';
      spreadsheetId: string;
      spreadsheetTitle: string;
      sheetTab: string;
      rowValues: string[];
    }
  | {
      kind: 'create_sheet';
      title: string;
      values: string[][];
    };

const DEFAULT_SAMPLE_GRID: string[][] = [
  ['Item', 'Category', 'Status', 'Owner'],
  ['Q4 Roadmap', 'Planning', 'In Progress', 'Product'],
  ['API Integration', 'Engineering', 'Completed', 'Platform'],
  ['Launch Review', 'Operations', 'Pending', 'Leadership'],
];

function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  return trimmed;
}

function getColumnLabel(colIndex: number): string {
  let label = '';
  let n = colIndex;
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export function GoogleSheetsDataGridCard({
  initialTitle = 'Workspace Spreadsheet',
  initialSpreadsheetId = '',
  initialValues,
  onSelectSpreadsheet,
}: GoogleSheetsDataGridCardProps) {
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getAccessToken());
  const [spreadsheetId, setSpreadsheetId] = useState<string>(initialSpreadsheetId);
  const [spreadsheetInput, setSpreadsheetInput] = useState<string>(initialSpreadsheetId);
  const [spreadsheetTitle, setSpreadsheetTitle] = useState<string>(initialTitle);
  const [webViewLink, setWebViewLink] = useState<string>('');
  const [sheetTabs, setSheetTabs] = useState<GoogleSheetTabProperty[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');

  const [gridValues, setGridValues] = useState<string[][]>(() =>
    initialValues && initialValues.length > 0 ? initialValues : DEFAULT_SAMPLE_GRID
  );
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [newRowCells, setNewRowCells] = useState<string[]>([]);

  const [driveSpreadsheets, setDriveSpreadsheets] = useState<GoogleDriveFileItem[]>([]);
  const [showDrivePicker, setShowDrivePicker] = useState<boolean>(false);
  const [loadingDriveList, setLoadingDriveList] = useState<boolean>(false);

  const [loadingSheet, setLoadingSheet] = useState<boolean>(false);
  const [mutating, setMutating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<PendingSheetMutation | null>(null);

  const columnCount = Math.max(
    4,
    ...gridValues.map((row) => row.length),
    newRowCells.length
  );

  useEffect(() => {
    setNewRowCells((prev) => {
      if (prev.length === columnCount) return prev;
      return Array.from({ length: columnCount }, (_, i) => prev[i] || '');
    });
  }, [columnCount]);

  const loadSpreadsheet = useCallback(
    async (targetId: string, requestedTab?: string) => {
      const cleanId = extractSpreadsheetId(targetId);
      if (!cleanId) return;

      if (!getAccessToken()) {
        setNeedsAuth(true);
        return;
      }

      setLoadingSheet(true);
      setErrorMessage(null);
      try {
        const metadata = await getGoogleSpreadsheetMetadata(cleanId);
        setSpreadsheetId(metadata.spreadsheetId);
        setSpreadsheetInput(metadata.spreadsheetId);
        setSpreadsheetTitle(metadata.title);
        setWebViewLink(metadata.spreadsheetUrl);
        setSheetTabs(metadata.sheets);

        const resolvedTab =
          requestedTab && metadata.sheets.some((s) => s.title === requestedTab)
            ? requestedTab
            : metadata.sheets[0]?.title || '';

        setActiveTab(resolvedTab);

        const rangeToFetch = resolvedTab ? `${resolvedTab}!A1:Z50` : undefined;
        const result = await getGoogleSheetValues(metadata.spreadsheetId, rangeToFetch);
        const loadedRows =
          result.values && result.values.length > 0
            ? result.values.map((r) => r.map((cell) => String(cell ?? '')))
            : [['Column A', 'Column B', 'Column C', 'Column D']];

        setGridValues(loadedRows);
        setIsDirty(false);
        onSelectSpreadsheet?.(metadata.spreadsheetId, metadata.title);
      } catch (err: any) {
        const msg = err?.message || 'Failed to load Google Sheet.';
        setErrorMessage(msg);
        toast.error(msg);
      } finally {
        setLoadingSheet(false);
      }
    },
    [onSelectSpreadsheet]
  );

  const handleLoadDriveSpreadsheets = async () => {
    if (!getAccessToken()) {
      setNeedsAuth(true);
      return;
    }
    setShowDrivePicker((prev) => !prev);
    setLoadingDriveList(true);
    setErrorMessage(null);
    try {
      const files = await googleDriveService.listSpreadsheets('', 20);
      setDriveSpreadsheets(files);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not list spreadsheets from Google Drive.');
    } finally {
      setLoadingDriveList(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    const res = await googleSignIn();
    if (res?.accessToken) {
      setNeedsAuth(false);
      toast.success('Connected to Google Workspace');
      if (spreadsheetId) {
        await loadSpreadsheet(spreadsheetId);
      }
    } else {
      setNeedsAuth(true);
    }
  };

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    setGridValues((prev) => {
      const next = prev.map((row) => [...row]);
      while (next.length <= rowIndex) {
        next.push(Array.from({ length: columnCount }, () => ''));
      }
      while (next[rowIndex].length < columnCount) {
        next[rowIndex].push('');
      }
      next[rowIndex][colIndex] = value;
      return next;
    });
    setIsDirty(true);
  };

  const handleAddBlankRowToLocalGrid = () => {
    setGridValues((prev) => [...prev, Array.from({ length: columnCount }, () => '')]);
    setIsDirty(true);
  };

  const requestSaveGridMutation = () => {
    if (!getAccessToken()) {
      setNeedsAuth(true);
      return;
    }
    if (!spreadsheetId) {
      setPendingMutation({
        kind: 'create_sheet',
        title: spreadsheetTitle.trim() || 'Workspace Spreadsheet',
        values: gridValues,
      });
      return;
    }
    const targetTab = activeTab || sheetTabs[0]?.title || '';
    const lastCol = getColumnLabel(columnCount - 1);
    const range = targetTab
      ? `${targetTab}!A1:${lastCol}${gridValues.length}`
      : `A1:${lastCol}${gridValues.length}`;

    setPendingMutation({
      kind: 'update_grid',
      spreadsheetId,
      spreadsheetTitle,
      sheetTab: targetTab || 'First Tab',
      range,
      values: gridValues,
    });
  };

  const requestAppendRowMutation = () => {
    if (!getAccessToken()) {
      setNeedsAuth(true);
      return;
    }
    const hasContent = newRowCells.some((c) => c.trim().length > 0);
    if (!hasContent) {
      toast.error('Enter at least one cell value to append a row.');
      return;
    }
    if (!spreadsheetId) {
      const nextValues = [...gridValues, [...newRowCells]];
      setGridValues(nextValues);
      setNewRowCells(Array.from({ length: columnCount }, () => ''));
      setIsDirty(true);
      toast.success('Row added to grid preview. Click "Create & Save Sheet" to write to Google Sheets.');
      return;
    }
    const targetTab = activeTab || sheetTabs[0]?.title || '';
    setPendingMutation({
      kind: 'append_row',
      spreadsheetId,
      spreadsheetTitle,
      sheetTab: targetTab || 'First Tab',
      rowValues: [...newRowCells],
    });
  };

  const executeConfirmedMutation = async () => {
    if (!pendingMutation) return;
    setMutating(true);
    setErrorMessage(null);
    try {
      if (pendingMutation.kind === 'create_sheet') {
        const created = await createGoogleSheet(pendingMutation.title, pendingMutation.values);
        setSpreadsheetId(created.spreadsheetId);
        setSpreadsheetInput(created.spreadsheetId);
        setSpreadsheetTitle(created.title);
        setWebViewLink(created.webViewLink);
        setIsDirty(false);
        toast.success(`Created Google Sheet "${created.title}"`);
        await loadSpreadsheet(created.spreadsheetId);
      } else if (pendingMutation.kind === 'update_grid') {
        await updateGoogleSheetValues(
          pendingMutation.spreadsheetId,
          pendingMutation.range,
          pendingMutation.values
        );
        setIsDirty(false);
        toast.success(`Updated ${pendingMutation.range} in "${pendingMutation.spreadsheetTitle}"`);
      } else if (pendingMutation.kind === 'append_row') {
        const range = pendingMutation.sheetTab ? `${pendingMutation.sheetTab}!A1` : 'A1';
        await appendGoogleSheetValues(pendingMutation.spreadsheetId, range, [
          pendingMutation.rowValues,
        ]);
        setGridValues((prev) => [...prev, pendingMutation.rowValues]);
        setNewRowCells(Array.from({ length: columnCount }, () => ''));
        toast.success(`Appended row to "${pendingMutation.spreadsheetTitle}"`);
      }
      setPendingMutation(null);
    } catch (err: any) {
      const msg = err?.message || 'Google Sheets write operation failed.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setMutating(false);
    }
  };

  return (
    <div
      data-testid="google-sheets-data-grid-card"
      className="my-3 rounded-xl border border-border/80 bg-card/60 backdrop-blur-md p-3.5 shadow-sm transition-all hover:border-border max-w-2xl"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={spreadsheetTitle}
                onChange={(e) => setSpreadsheetTitle(e.target.value)}
                aria-label="Spreadsheet title"
                className="text-xs font-semibold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-emerald-500 focus:outline-none truncate max-w-[220px]"
              />
              {spreadsheetId && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
                  Live Sheet
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {spreadsheetId
                ? `ID: ${spreadsheetId.slice(0, 18)}...${activeTab ? ` • Tab: ${activeTab}` : ''}`
                : 'Interactive Google Sheets Data Grid (Read & Write)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleLoadDriveSpreadsheets}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-secondary/70 hover:bg-secondary text-foreground transition-colors"
            title="Select a Google Sheet from your Drive"
          >
            <FolderOpen className="w-3.5 h-3.5 text-emerald-500" />
            <span>Select from Drive</span>
          </button>

          {spreadsheetId && (
            <button
              type="button"
              onClick={() => loadSpreadsheet(spreadsheetId, activeTab)}
              disabled={loadingSheet}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-secondary/70 hover:bg-secondary text-foreground transition-colors disabled:opacity-50"
              title="Refresh sheet data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSheet ? 'animate-spin' : ''}`} />
            </button>
          )}

          {webViewLink && (
            <a
              href={webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-emerald-500 hover:bg-emerald-500/10 transition-colors"
              title="Open in Google Sheets"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Spreadsheet ID / URL loader bar */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={spreadsheetInput}
          onChange={(e) => setSpreadsheetInput(e.target.value)}
          placeholder="Paste Google Sheet ID or URL to read live rows..."
          className="flex-1 min-w-[200px] text-xs px-2.5 py-1.5 rounded-lg bg-background/80 border border-border/70 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={() => loadSpreadsheet(spreadsheetInput)}
          disabled={loadingSheet || !spreadsheetInput.trim()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
        >
          {loadingSheet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Table className="w-3.5 h-3.5" />}
          <span>Load Sheet</span>
        </button>
      </div>

      {/* Drive Spreadsheet Picker Dropdown */}
      {showDrivePicker && (
        <div className="mt-2.5 rounded-lg border border-border/70 bg-background/90 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Select a Google Sheet from Drive</span>
            <button
              type="button"
              onClick={() => setShowDrivePicker(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          {loadingDriveList ? (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
              <span>Loading spreadsheets from your Google Drive...</span>
            </div>
          ) : driveSpreadsheets.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No Google Sheets found in Drive, or sign in required.
            </p>
          ) : (
            <div className="max-h-36 overflow-y-auto divide-y divide-border/40">
              {driveSpreadsheets.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => {
                    setShowDrivePicker(false);
                    loadSpreadsheet(file.id);
                  }}
                  className="w-full flex items-center justify-between gap-2 py-1.5 px-2 text-left text-xs hover:bg-secondary/60 rounded transition-colors"
                >
                  <span className="truncate font-medium text-foreground">{file.name}</span>
                  <span className="text-[10px] text-emerald-500 shrink-0">Load Grid</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dynamic Sheet Tabs Selector */}
      {sheetTabs.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1 overflow-x-auto pb-1">
          {sheetTabs.map((tab) => (
            <button
              key={tab.sheetId}
              type="button"
              onClick={() => {
                setActiveTab(tab.title);
                loadSpreadsheet(spreadsheetId, tab.title);
              }}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 ${
                activeTab === tab.title
                  ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.title}
            </button>
          ))}
        </div>
      )}

      {/* Data Grid Table */}
      <div className="mt-2.5 overflow-x-auto rounded-lg border border-border/70 bg-background/60">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-secondary/60 border-b border-border/70 text-[10px] font-semibold text-muted-foreground">
              <th className="w-8 py-1.5 px-2 text-center border-r border-border/50">#</th>
              {Array.from({ length: columnCount }, (_, colIdx) => (
                <th
                  key={colIdx}
                  className="py-1.5 px-2.5 text-left border-r border-border/50 last:border-r-0 min-w-[100px]"
                >
                  {getColumnLabel(colIdx)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {gridValues.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={
                  rowIdx === 0
                    ? 'bg-emerald-500/5 font-medium'
                    : 'hover:bg-secondary/30 transition-colors'
                }
              >
                <td className="py-1 px-2 text-center text-[10px] text-muted-foreground border-r border-border/40 select-none">
                  {rowIdx + 1}
                </td>
                {Array.from({ length: columnCount }, (_, colIdx) => (
                  <td
                    key={colIdx}
                    className="p-0 border-r border-border/40 last:border-r-0"
                  >
                    <input
                      type="text"
                      value={row[colIdx] ?? ''}
                      onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                      aria-label={`Row ${rowIdx + 1} Column ${getColumnLabel(colIdx)}`}
                      className="w-full px-2 py-1.5 bg-transparent text-xs text-foreground focus:outline-none focus:bg-emerald-500/10"
                    />
                  </td>
                ))}
              </tr>
            ))}

            {/* Quick Append Row Input Bar */}
            <tr className="bg-secondary/20 border-t border-border/70">
              <td className="py-1 px-2 text-center text-[10px] text-emerald-500 font-semibold border-r border-border/40">
                +
              </td>
              {Array.from({ length: columnCount }, (_, colIdx) => (
                <td key={colIdx} className="p-0 border-r border-border/40 last:border-r-0">
                  <input
                    type="text"
                    value={newRowCells[colIdx] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewRowCells((prev) => {
                        const copy = [...prev];
                        copy[colIdx] = val;
                        return copy;
                      });
                    }}
                    placeholder={`Add ${getColumnLabel(colIdx)}...`}
                    aria-label={`New row Column ${getColumnLabel(colIdx)}`}
                    className="w-full px-2 py-1.5 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:bg-emerald-500/10"
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Explicit Confirmation Banner for Mutating Sheet Actions */}
      {pendingMutation && (
        <div
          data-testid="sheets-mutation-confirmation"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-foreground space-y-1">
              <p className="font-semibold">Confirm Google Sheets Write Operation</p>
              {pendingMutation.kind === 'create_sheet' && (
                <p className="text-muted-foreground">
                  Create a new spreadsheet titled{' '}
                  <span className="font-medium text-foreground">"{pendingMutation.title}"</span> with{' '}
                  {pendingMutation.values.length} rows of data?
                </p>
              )}
              {pendingMutation.kind === 'update_grid' && (
                <p className="text-muted-foreground">
                  Write {pendingMutation.values.length} rows to range{' '}
                  <span className="font-mono text-foreground">{pendingMutation.range}</span> in{' '}
                  <span className="font-medium text-foreground">
                    "{pendingMutation.spreadsheetTitle}"
                  </span>
                  ?
                </p>
              )}
              {pendingMutation.kind === 'append_row' && (
                <p className="text-muted-foreground">
                  Append row{' '}
                  <span className="font-mono text-foreground">
                    [{pendingMutation.rowValues.filter(Boolean).join(', ')}]
                  </span>{' '}
                  to tab <span className="font-medium text-foreground">{pendingMutation.sheetTab}</span>{' '}
                  in "{pendingMutation.spreadsheetTitle}"?
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
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {mutating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Confirm & Write to Google Sheets</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}

      {/* Footer Actions & Official Google Sign-In */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleAddBlankRowToLocalGrid}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-secondary/70 hover:bg-secondary text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Grid Row</span>
          </button>

          <button
            type="button"
            onClick={requestAppendRowMutation}
            disabled={mutating}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 border border-emerald-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Append New Row</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {needsAuth && (
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
          )}

          <button
            type="button"
            onClick={requestSaveGridMutation}
            disabled={mutating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>
              {spreadsheetId
                ? isDirty
                  ? 'Save Grid Changes'
                  : 'Write Grid to Sheet'
                : 'Create & Save Sheet'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
export default GoogleSheetsDataGridCard;
