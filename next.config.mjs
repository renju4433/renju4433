/** @type {import('next').NextConfig} */
const nextConfig = {
  // 托管网关会按 URL 缓存整页 HTML，且缓存无法主动刷新。
  // 页面本身实时刷新赛事数据，这里统一禁止边缘缓存。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.espncdn.com',
      },
      {
        protocol: 'https',
        hostname: '**.espn.com',
      },
    ],
  },
};

export default nextConfig;
