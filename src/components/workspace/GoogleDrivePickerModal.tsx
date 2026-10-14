import React from 'react';
import { GoogleDriveFileExplorer } from './GoogleDriveFileExplorer';
import { GoogleDriveFileItem } from '@/lib/workspaceTools';

interface GoogleDrivePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (file: GoogleDriveFileItem, contextString?: string) => void;
}

export function GoogleDrivePickerModal({
  isOpen,
  onClose,
  onSelectFile
}: GoogleDrivePickerModalProps) {
  const handleAttachContext = (contextString: string, fileItems: GoogleDriveFileItem[]) => {
    if (fileItems.length > 0) {
      onSelectFile(fileItems[0], contextString);
    }
  };

  return (
    <GoogleDriveFileExplorer
      isOpen={isOpen}
      onClose={onClose}
      onAttachContext={handleAttachContext}
      title="Google Drive Explorer & AI Context"
    />
  );
}

