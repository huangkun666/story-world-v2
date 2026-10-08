import { readFileSync } from 'node:fs';

// Follow the production module family when an action moves out of index.js.
export function readHostSource() {
    return ['extraction-actions.js', 'index.js', 'extraction-progress.js'].map(file => readFileSync(new URL('../web/' + file, import.meta.url), 'utf8')).join('\n');
}
