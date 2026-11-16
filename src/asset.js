/**
 * URL for a file in public/. The site is not always served from the domain
 * root (GitHub Pages hosts it under /Astr0/), so root-absolute paths such as
 * "/projects/edge.jpg" have to be resolved against Vite's base path.
 */
export function asset(path) {
  return import.meta.env.BASE_URL + path.replace(/^\//, '')
}
