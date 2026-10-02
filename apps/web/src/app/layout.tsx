import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ScaleLab — see how your system behaves before it goes live',
  description:
    'Drag technologies onto a canvas, connect them, run simulated traffic and watch requests flow, queues build and bottlenecks appear. Free, no login.',
};

export const viewport: Viewport = {
  themeColor: '#0d1017',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
