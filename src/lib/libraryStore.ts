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
