import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLang } from '@/lib/lang';

export const metadata: Metadata = {
  title: 'Right Space',
  applicationName: 'Right Space',
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
// the phone's browser tints its own bars with the cocoa of the tab row (Warm sand look)
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#3a2b1c' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Readex+Pro:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
