import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Onest } from 'next/font/google';

import './globals.css';

const onest = Onest({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-onest' });

export const metadata: Metadata = {
  title: 'OpenDocs',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={onest.variable}>
      <body className={onest.className}>{children}</body>
    </html>
  );
}
