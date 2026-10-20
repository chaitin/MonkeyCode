import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const baseUrl = new URL(import.meta.env.BASE_URL, site ?? 'http://localhost');
  const sitemap = new URL('sitemap.xml', baseUrl);

  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap.href}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
