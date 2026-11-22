import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Cue GitHub MCP Server',
  description: 'Authenticated, read-only GitHub tools over the Model Context Protocol.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f7f8fa', color: '#16181d', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
