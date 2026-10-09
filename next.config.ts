import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['postgres', 'bcryptjs'],
};
export default config;
