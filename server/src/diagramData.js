// The diagram is diagram-studio/1 DATA (server/diagrams/*.json), loaded by name and checked with the studio's own validator copy
// (diagramStudioValidate.js). Nothing here or in the web app builds nodes or edges by hand: each message is one edge, and the
// step with the same index describes it. The drift test (server/test/diagram.test.js) pins the data to definition.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDiagram } from './diagramStudioValidate.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../diagrams');
export const DIAGRAM_NAMES = ['authorization-flow'];
export const DEFAULT_DIAGRAM = DIAGRAM_NAMES[0];

export function loadDiagram(name) {
  if (typeof name !== 'string' || !DIAGRAM_NAMES.includes(name)) throw Object.assign(new Error('no such diagram'), { code: 'no_such_diagram' });
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  const problems = validateDiagram(doc);
  if (problems.length) throw new Error(`diagram ${name} is not valid diagram-studio/1: ${problems.join('; ')}`);
  return doc;
}

const DOCS = Object.fromEntries(DIAGRAM_NAMES.map((n) => [n, loadDiagram(n)]));
export const diagramByName = (name = DEFAULT_DIAGRAM) => (typeof name === 'string' && Object.hasOwn(DOCS, name) ? DOCS[name] : null);
