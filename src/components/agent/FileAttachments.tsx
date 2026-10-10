import React from 'react';
import { FileText, FileJson, File, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AttachmentFile {
  name: string;
  type: 'pdf' | 'markdown' | 'json' | 'csv' | 'other';
  size: string;
  url?: string;
}

// Custom icon for Markdown since lucide might not have a specific one used in the design
function FileCodeIcon({ size, className }: { size?: number, className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M9 13h6"/>
      <path d="M9 17h6"/>
      <path d="M12 13v4"/>
    </svg>
  );
}

interface FileCardProps {
  file: AttachmentFile;
}

export function FileCard({ file }: FileCardProps) {
  const getIcon = () => {
    switch (file.type) {
      case 'pdf':
        return <div className="p-2 bg-red-100 rounded-lg text-red-600"><FileText size={20} /></div>;
      case 'markdown':
        return <div className="p-2 bg-slate-100 dark:bg-white/10 rounded-lg text-slate-800 dark:text-white"><FileCodeIcon size={20} /></div>;
      case 'json':
      case 'csv':
        return <div className="p-2 bg-green-100 rounded-lg text-green-600"><FileJson size={20} /></div>;
      default:
        return <div className="p-2 bg-gray-100 rounded-lg text-gray-600"><File size={20} /></div>;
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-white border border-border/60 rounded-xl hover:shadow-sm transition-shadow cursor-pointer min-w-[240px] group">
      {getIcon()}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate text-foreground/90 group-hover:text-primary transition-colors">
          {file.name}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <span className="uppercase">{file.type}</span>
          <span>•</span>
          <span>{file.size}</span>
        </div>
      </div>
    </div>
  );
}

interface FileAttachmentsProps {
  files: AttachmentFile[];
}

export function FileAttachments({ files }: FileAttachmentsProps) {
  if (!files || files.length === 0) return null;

  return (
    <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
      <div className="flex flex-wrap gap-3 mb-4">
        {files.map((file, i) => (
          <FileCard key={i} file={file} />
        ))}
      </div>
      
      <button className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-border/50 bg-white hover:bg-manus-soft/50 transition-colors text-sm font-medium text-muted-foreground hover:text-foreground group">
        <File size={16} className="group-hover:scale-110 transition-transform" />
        View all files in this task
      </button>
    </div>
  );
}
