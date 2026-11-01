// Writes docs/talk-track.md from the talk-track data (server/src/talkTrack.js), so the doc cannot drift from it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderTalkTrackMarkdown } from '../server/src/talkTrack.js';

const file = fileURLToPath(new URL('../docs/talk-track.md', import.meta.url));
fs.writeFileSync(file, renderTalkTrackMarkdown());
console.log('wrote docs/talk-track.md');
