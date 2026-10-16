import React from 'react';

export interface MicrophonePermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPermissionGranted?: () => void;
}

export function MicrophonePermissionModal(_props: MicrophonePermissionModalProps) {
  return null;
}
