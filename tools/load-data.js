// Node에서 data/*.json 읽기
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DATA_FILES, buildData } from '../core/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadRawData() {
  const raw = {};
  for (const f of DATA_FILES) raw[f] = JSON.parse(readFileSync(join(ROOT, 'data', `${f}.json`), 'utf8'));
  return raw;
}

export const loadData = () => buildData(loadRawData());
