import { mkdir, rm, copyFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
// Explicit allowlist: never publish Apps Script, snapshots, or deployment files.
for (const file of ['index.html', 'app.js', 'style.css', '_headers']) {
  await copyFile(`static_web/${file}`, `dist/${file}`);
}
console.log('Built website in dist/');
