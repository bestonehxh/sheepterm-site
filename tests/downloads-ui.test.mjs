import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Linux download selector exposes both architectures and quick link opens the choices', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../assets/site.js', import.meta.url), 'utf8');
  assert.match(html, /id="linux-downloads"/);
  assert.match(html, /href="\/download\/linux">x86_64 <small>Intel \/ AMD<\/small>/);
  assert.match(html, /href="\/download\/linux-arm64">ARM64 <small>aarch64<\/small>/);
  assert.match(script, /a\.href="\/#linux-downloads"/);
});

test('Linux install instructions explain the executable permission and data migration', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Properties → Permissions/);
  assert.match(html, /Allow executing file as program/);
  assert.match(html, /chmod \+x SheepTerm-\*\.AppImage/);
  assert.match(html, /existing <code>Data<\/code> folder beside the AppImage/);
});
