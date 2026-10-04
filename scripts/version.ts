// Version shown in the app, derived from git so that a dev build never passes for a release.
// Run directly to print it: node scripts/version.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * A clean checkout of the tag `vX.Y.Z` is the release `X.Y.Z`. Anything else is a
 * pre-release of the version in package.json: `X.Y.Z-<branch>.<commits since last tag>+<commit>[.dirty]`.
 * APP_VERSION overrides it for builds without git, such as the Docker image.
 */
export function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const target: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const commit = git('rev-parse', '--short', 'HEAD');
  if (!commit) return `${target}-nogit`;

  const dirty = git('status', '--porcelain') !== '';
  const tag = git('describe', '--tags', '--exact-match', '--match', 'v[0-9]*');
  if (tag && !dirty) return tag.slice(1);

  const branch = (git('symbolic-ref', '--short', '-q', 'HEAD') ?? 'detached').replace(/[^0-9A-Za-z-]+/g, '-');
  const lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
  const commits = git('rev-list', '--count', lastTag ? `${lastTag}..HEAD` : 'HEAD');
  return `${target}-${branch}.${commits}+${commit}${dirty ? '.dirty' : ''}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(appVersion());
