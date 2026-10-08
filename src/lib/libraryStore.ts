export interface LibraryFileItem {
  id: string;
  name: string;
  type: 'photo' | 'video' | 'doc' | 'audio' | 'website' | 'graph';
  url?: string;
  thumbnail?: string;
  size?: string;
  createdAt: string;
  source?: string;
  description?: string;
}

const STORAGE_KEY = 'manus_library_files';

export function getLibraryItems(): LibraryFileItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveLibraryItem(item: LibraryFileItem): void {
  try {
    const current = getLibraryItems();
    // Avoid duplicate ID
    const filtered = current.filter(i => i.id !== item.id);
    const updated = [item, ...filtered];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    // Dispatch custom event so Library UI can update reactively if open
    window.dispatchEvent(new CustomEvent('manus_library_updated', { detail: item }));
  } catch (error) {
    console.error('Failed to save to library', error);
  }
}

export async function saveSharedFileToLibrary(file: File, source: string = 'Shared with AI'): Promise<LibraryFileItem | null> {
  try {
    let fileType: LibraryFileItem['type'] = 'doc';
    if (file.type.startsWith('image/')) fileType = 'photo';
    else if (file.type.startsWith('video/')) fileType = 'video';
    else if (file.type.startsWith('audio/')) fileType = 'audio';

    const formattedSize = file.size > 1024 * 1024 
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(file.size / 1024).toFixed(1)} KB`;

    // Read file as Data URL if smaller than 8MB for persistence
    let fileUrl = '#';
    if (file.size < 8 * 1024 * 1024) {
      fileUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string || '#');
        reader.onerror = () => resolve('#');
        reader.readAsDataURL(file);
      });
    } else {
      fileUrl = URL.createObjectURL(file);
    }

    const newItem: LibraryFileItem = {
      id: `lib-shared-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: file.name,
      type: fileType,
      url: fileUrl,
      thumbnail: fileType === 'photo' ? fileUrl : undefined,
      size: formattedSize,
      createdAt: new Date().toISOString(),
      source,
      description: `Shared with AI (${file.type || 'file'})`
    };

    saveLibraryItem(newItem);
    return newItem;
  } catch (err) {
    console.error('Error saving shared file to library', err);
    return null;
  }
}

export function syncTasksToLibrary(tasks: any[]): void {
  if (!Array.isArray(tasks) || tasks.length === 0) return;
  const currentItems = getLibraryItems();
  const existingIds = new Set(currentItems.map(i => i.id));
  const newItems: LibraryFileItem[] = [];

  tasks.forEach(task => {
    if (!task) return;
    const title = task.title || (task.prompt ? (task.prompt.length > 35 ? task.prompt.substring(0, 35) + '...' : task.prompt) : 'Task Document');
    const taskId = task.id || `task-${Date.now()}`;
    const createdAt = task.created_at || new Date().toISOString();

    // 1. Task with generated web app output
    if (task.outputFormat === 'website' || task.websiteName) {
      const siteDocId = `lib-task-site-${taskId}`;
      if (!existingIds.has(siteDocId)) {
        newItems.push({
          id: siteDocId,
          name: `${task.websiteName || title} - Web Application.html`,
          type: 'website',
          size: '420 KB',
          createdAt,
          source: 'Generated Web Project',
          description: `Interactive web application generated from task`,
          url: '#'
        });
      }
    }

    // 2. Task with report or document output
    if (task.outputFormat === 'report' || task.outputFormat === 'slides' || task.outputFormat === 'doc') {
      const docId = `lib-task-doc-${taskId}`;
      if (!existingIds.has(docId)) {
        newItems.push({
          id: docId,
          name: `${title} - Executive Report.pdf`,
          type: 'doc',
          size: '890 KB',
          createdAt,
          source: 'Task Document Output',
          description: `Structured analytical document report`,
          url: '#'
        });
      }
    }

    // 3. Task with charts or spreadsheets
    if (task.outputFormat === 'graph' || task.outputFormat === 'spreadsheet' || task.chartData) {
      const graphId = `lib-task-graph-${taskId}`;
      if (!existingIds.has(graphId)) {
        newItems.push({
          id: graphId,
          name: `${title} - Dataset & Analytics.json`,
          type: 'graph',
          size: '230 KB',
          createdAt,
          source: 'Task Data Export',
          description: `Structured data points & chart metrics`,
          url: '#'
        });
      }
    }

    // 4. Check if prompt contained shared file attachments
    if (task.prompt && task.prompt.includes('[Attached:')) {
      const matches = task.prompt.match(/\[Attached:\s*([^\]]+)\]/gi);
      if (matches) {
        matches.forEach((m: string) => {
          const fileName = m.replace(/\[Attached:\s*/i, '').replace(/\]$/, '').trim();
          if (fileName) {
            const attachedId = `lib-task-attach-${taskId}-${fileName}`;
            if (!existingIds.has(attachedId)) {
              let fileType: LibraryFileItem['type'] = 'doc';
              if (/\.(png|jpe?g|webp|gif|svg)$/i.test(fileName)) fileType = 'photo';
              else if (/\.(mp4|webm|mov)$/i.test(fileName)) fileType = 'video';
              else if (/\.(mp3|wav|ogg|m4a)$/i.test(fileName)) fileType = 'audio';

              newItems.push({
                id: attachedId,
                name: fileName,
                type: fileType,
                size: '1.4 MB',
                createdAt,
                source: 'Shared in Task Chat',
                description: `Document shared for task: "${title}"`,
                url: '#'
              });
            }
          }
        });
      }
    }
  });

  if (newItems.length > 0) {
    const updated = [...newItems, ...currentItems];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('manus_library_updated'));
  }
}
