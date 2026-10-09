import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['postgres', 'bcryptjs'],
  // receipt photos and PDFs go up through a server action, one file per request; src/lib/attachments.ts allows 4 MB per file
  // and the host accepts about 4.5 MB per request
  experimental: { serverActions: { bodySizeLimit: '4.5mb' } },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
};
export default config;
