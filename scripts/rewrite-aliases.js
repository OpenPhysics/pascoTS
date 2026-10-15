import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distRoot = path.resolve('dist');
const specifierPattern = /(['"])@\/(types|utils|device|ble)\/([^'"]+)\1/g;

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(full)));
    } else if (/\.(?:js|d\.ts)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function rewrite(file, source) {
  return source.replace(specifierPattern, (_full, quote, alias, rest) => {
    const target = path.join(distRoot, alias, rest);
    let relative = path.relative(path.dirname(file), target);
    if (!relative.startsWith('.')) {
      relative = `./${relative}`;
    }
    return `${quote}${relative.split(path.sep).join('/')}${quote}`;
  });
}

const files = await filesUnder(distRoot);
let unresolved = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (!source.includes('@/')) continue;
  const rewritten = rewrite(file, source);
  specifierPattern.lastIndex = 0;
  if (specifierPattern.test(rewritten)) {
    console.error(`unresolved alias in ${path.relative(distRoot, file)}`);
    unresolved += 1;
  }
  specifierPattern.lastIndex = 0;
  if (rewritten !== source) {
    await writeFile(file, rewritten);
  }
}

if (unresolved > 0) {
  process.exit(1);
}
