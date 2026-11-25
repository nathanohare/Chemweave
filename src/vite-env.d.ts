/// <reference types="vite/client" />

/** This build's id (vite.config.ts); the web version's version.json carries the same id. */
declare const __WEB_BUILD__: string;

declare module 'hyphen/en-us/index.js' {
  const hyphen: { hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number; debug?: boolean; exceptions?: string[] }): string };
  export default hyphen;
}
