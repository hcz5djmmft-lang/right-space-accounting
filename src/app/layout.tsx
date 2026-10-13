import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Right Space Accounting',
  applicationName: 'Right Space Accounting',
  // iPhone: Share > Add to Home Screen opens the system full screen with this name and icon
  appleWebApp: { capable: true, title: 'Right Space', statusBarStyle: 'default' },
  // Next writes only the newer mobile-web-app-capable tag; iPhones before iOS 17.4 look for the apple- one
  other: { 'apple-mobile-web-app-capable': 'yes' },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};
// a request that waits on the database gives up after half a minute instead of Vercel's five
export const maxDuration = 30;
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f6f1e7' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Montserrat:wght@600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
