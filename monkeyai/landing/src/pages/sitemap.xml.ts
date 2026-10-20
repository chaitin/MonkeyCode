import type { APIRoute } from 'astro';

const paths = ['', 'user-service/', 'privacy-policy/', 'user-agreement/'];

export const GET: APIRoute = ({ site }) => {
  const baseUrl = new URL(import.meta.env.BASE_URL, site ?? 'http://localhost');
  const urls = paths
    .map((path) => `<url><loc>${new URL(path, baseUrl).href}</loc><changefreq>${path ? 'yearly' : 'weekly'}</changefreq><priority>${path ? '0.3' : '1.0'}</priority></url>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
