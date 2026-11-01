import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { TALK_TRACK, renderTalkTrackMarkdown } from '../server/src/talkTrack.js';
import { MISTAKES } from '../server/src/definition.js';

const file = new URL('../docs/talk-track.md', import.meta.url);

test('docs/talk-track.md is exactly what the talk-track data renders (run: npm run talk-track)', () => {
  assert.equal(fs.readFileSync(file, 'utf8'), renderTalkTrackMarkdown(), 'docs/talk-track.md is stale; regenerate it and commit the result');
});

test('the renderer is driven by the data: a changed beat changes the document', () => {
  const edited = { ...TALK_TRACK, beats: TALK_TRACK.beats.map((b, i) => (i === 0 ? { ...b, say: 'A changed beat.' } : b)) };
  assert.notEqual(renderTalkTrackMarkdown(edited), renderTalkTrackMarkdown());
  assert.match(renderTalkTrackMarkdown(edited), /^1\. \*\*Frame it \(30 s\)\.\*\* A changed beat\.$/m);
});

test('the track has the numbered beats, the honest close and names the mistakes it asks the presenter to run', () => {
  const t = renderTalkTrackMarkdown();
  assert.ok((t.match(/^\d+\. \*\*/gm) || []).length >= 6);
  assert.match(t, /still to be verified against product documentation/);
  assert.match(t, /organisational step with no protocol/);
  for (const id of ['unlisted_connector', 'wrong_verifier', 'wrong_audience', 'passthrough']) {
    assert.ok(t.includes(`\`${id}\``), `the talk track names ${id}`);
    assert.ok(MISTAKES.some((m) => m.id === id), `${id} is a real mistake id`);
  }
});
