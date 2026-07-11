import { readFileSync } from 'node:fs';

export interface Route {
  url: string;
  kind: string;
  expect: number;
}

export interface Matrix {
  target: string;
  baseUrl: string;
  routes: Route[];
}

export function loadMatrix(): Matrix {
  const path = new URL('../.shakedown/matrix.json', import.meta.url);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('No matrix found. Run `npm run matrix` first.');
  }
}

/** Signatures of PHP/Twig failure output in a rendered page body. */
export const ERROR_SIGNATURES = [
  'Fatal error',
  'Parse error',
  'Warning: ',
  'Notice: ',
  'Deprecated: ',
  'Uncaught Error',
  'Twig\\Error',
  'Stack trace:',
];
