/**
 * Vinext's production worker entry.
 *
 * Keep this file as the outer application entry so both Sites and Cloudflare
 * builds include the company PWA/login router. The framework handler remains
 * the final fallback in vinext-base.ts.
 */
export { default } from "./entry-with-pwa";
