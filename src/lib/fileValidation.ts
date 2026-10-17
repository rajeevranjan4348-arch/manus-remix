/**
 * File validation, sanitization, and extraction utilities for AI processing
 */

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  sanitizedName: string;
  sizeFormatted: string;
  isImage: boolean;
  isText: boolean;
  isPdf: boolean;
}

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];
export const SUPPORTED_TEXT_EXTENSIONS = [
  'txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml',
  'js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css', 'scss',
  'sql', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'sh', 'env'
];
export const SUPPORTED_DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'rtf', 'odt'];

/**
 * Sanitize filename to prevent directory traversal or script injection
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'unnamed_file';
  // Remove path traversal and control characters
  return filename
    .replace(/^.*[\\\/]/, '')
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')
    .slice(0, 120);
}

/**
 * Format bytes to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Validate file on client side before processing
 */
export function validateFile(file: File): FileValidationResult {
  const sanitizedName = sanitizeFilename(file.name);
  const sizeFormatted = formatFileSize(file.size);

  if (file.size <= 0) {
    return {
      valid: false,
      error: 'Selected file is empty (0 bytes).',
      sanitizedName,
      sizeFormatted,
      isImage: false,
      isText: false,
      isPdf: false,
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File is too large (${sizeFormatted}). Maximum allowed size is 25 MB.`,
      sanitizedName,
      sizeFormatted,
      isImage: false,
      isText: false,
      isPdf: false,
    };
  }

  const ext = sanitizedName.split('.').pop()?.toLowerCase() || '';
  const isImage = file.type.startsWith('image/') || SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  const isPdf = file.type === 'application/pdf' || ext === 'pdf';
  const isText = file.type.startsWith('text/') || SUPPORTED_TEXT_EXTENSIONS.includes(ext);
  const isDoc = SUPPORTED_DOC_EXTENSIONS.includes(ext);

  if (!isImage && !isPdf && !isText && !isDoc) {
    return {
      valid: false,
      error: `Unsupported file type (.${ext}). Please select an image, PDF, document, or code/text file.`,
      sanitizedName,
      sizeFormatted,
      isImage,
      isText,
      isPdf,
    };
  }

  return {
    valid: true,
    sanitizedName,
    sizeFormatted,
    isImage,
    isText,
    isPdf,
  };
}

/**
 * Read file content optimized for AI agent consumption
 */
export async function readFileForAI(file: File): Promise<{
  dataUrl?: string;
  textContent?: string;
  summary: string;
}> {
  const val = validateFile(file);
  if (!val.valid) {
    throw new Error(val.error || 'Invalid file');
  }

  // 1. Images: Read as DataURL for Vision AI models
  if (val.isImage) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        resolve({
          dataUrl,
          summary: `[Attached Image: ${val.sanitizedName} (${val.sizeFormatted})]`
        });
      };
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });
  }

  // 2. Text, Code, CSV, JSON: Read text content up to safe boundary
  if (val.isText) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const fullText = (e.target?.result as string) || '';
        const previewText = fullText.slice(0, 30000); // 30k char context limit
        const truncatedNotice = fullText.length > 30000 ? `\n... [Truncated ${fullText.length - 30000} additional characters]` : '';
        resolve({
          textContent: fullText,
          summary: `[Attached File: ${val.sanitizedName} (${val.sizeFormatted})]\n\`\`\`\n${previewText}${truncatedNotice}\n\`\`\``
        });
      };
      reader.onerror = () => reject(new Error('Failed to read text file.'));
      reader.readAsText(file);
    });
  }

  // 3. PDF and Binary Documents: Read text or provide metadata
  if (val.isPdf) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) || '';
        // Extract basic ASCII printable text from PDF stream if available
        const cleanAscii = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').slice(0, 15000);
        resolve({
          textContent: cleanAscii,
          summary: `[Attached PDF Document: ${val.sanitizedName} (${val.sizeFormatted})]\n${cleanAscii ? `\`\`\`\n${cleanAscii}\n\`\`\`` : 'PDF document ready for analysis.'}`
        });
      };
      reader.onerror = () => {
        resolve({
          summary: `[Attached PDF Document: ${val.sanitizedName} (${val.sizeFormatted})]`
        });
      };
      reader.readAsText(file);
    });
  }

  return {
    summary: `[Attached Document: ${val.sanitizedName} (${val.sizeFormatted})]`
  };
}

/**
 * Use browser File Picker API if available with fallback to HTML input
 */
export async function pickFilesNative(options: {
  acceptTypes?: 'image' | 'file';
  multiple?: boolean;
}): Promise<File[]> {
  const isImageOnly = options.acceptTypes === 'image';
  
  // Try modern File System Access API where supported (Desktop Chrome / Edge)
  if (typeof window !== 'undefined' && 'showOpenFilePicker' in window) {
    try {
      const pickerOptions: any = {
        multiple: Boolean(options.multiple),
        types: isImageOnly ? [
          {
            description: 'Images',
            accept: {
              'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']
            }
          }
        ] : [
          {
            description: 'Documents & Code',
            accept: {
              'text/*': ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.html', '.css'],
              'application/pdf': ['.pdf'],
              'image/*': ['.png', '.jpg', '.jpeg', '.webp']
            }
          }
        ]
      };
      const handles = await (window as any).showOpenFilePicker(pickerOptions);
      const files: File[] = [];
      for (const handle of handles) {
        const f = await handle.getFile();
        files.push(f);
      }
      return files;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return []; // User cancelled
      }
      // Fall through to input element
    }
  }

  // Fallback to standard input element
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = Boolean(options.multiple);
    if (isImageOnly) {
      input.accept = 'image/*';
    } else {
      input.accept = '.pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.py,.html,.css,.doc,.docx,image/*';
    }
    input.onchange = () => {
      const files = Array.from(input.files || []);
      resolve(files);
    };
    input.click();
  });
}
