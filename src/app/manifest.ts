import type { MetadataRoute } from 'next';

// lets a phone add the system to its home screen and open it full screen like an app; no service worker,
// so every open loads the latest deployment
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Right Space',
    short_name: 'Right Space',
    description: 'Right Space Development accounting',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f1e7',
    theme_color: '#f6f1e7',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
