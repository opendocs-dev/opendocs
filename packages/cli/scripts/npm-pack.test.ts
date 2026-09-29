import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pack } from './npm-pack';

const VERSION = '0.1.0-alpha.1';

const BINARIES = [
  'opendocs-bun-linux-x64',
  'opendocs-bun-linux-arm64',
  'opendocs-bun-darwin-arm64',
  'opendocs-bun-darwin-x64',
  'opendocs-bun-windows-x64.exe',
];

let distDir: string;
let outDir: string;

async function readJson(p: string): Promise<any> {
  return JSON.parse(await readFile(p, 'utf8'));
}

beforeEach(async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'npm-pack-'));
  distDir = path.join(tmp, 'dist');
  outDir = path.join(tmp, 'out');
  await mkdir(distDir, { recursive: true });
  for (const name of BINARIES) {
    await writeFile(path.join(distDir, name), 'dummy binary');
  }
});

afterEach(async () => {
  await rm(path.dirname(distDir), { recursive: true, force: true });
});

describe('pack', () => {
  test('writes 6 packages with one version', async () => {
    await pack(distDir, outDir, VERSION);

    const names = [
      'opendocs-cli-linux-x64',
      'opendocs-cli-linux-arm64',
      'opendocs-cli-darwin-arm64',
      'opendocs-cli-darwin-x64',
      'opendocs-cli-windows-x64',
      'opendocs-cli',
    ];

    for (const name of names) {
      const pkg = await readJson(path.join(outDir, name, 'package.json'));
      expect(pkg.version).toBe(VERSION);
      expect(pkg.license).toBe('MIT');
      expect(pkg.repository).toEqual({
        type: 'git',
        url: 'git+https://github.com/opendocs-dev/opendocs.git',
        directory: 'packages/cli',
      });
    }
  });

  test('platform packages set os and cpu', async () => {
    await pack(distDir, outDir, VERSION);

    const cases: Array<[string, string, string, string]> = [
      ['opendocs-cli-linux-x64', 'linux', 'x64', 'opendocs'],
      ['opendocs-cli-linux-arm64', 'linux', 'arm64', 'opendocs'],
      ['opendocs-cli-darwin-arm64', 'darwin', 'arm64', 'opendocs'],
      ['opendocs-cli-darwin-x64', 'darwin', 'x64', 'opendocs'],
      ['opendocs-cli-windows-x64', 'win32', 'x64', 'opendocs.exe'],
    ];

    for (const [name, platform, cpu, binName] of cases) {
      const pkg = await readJson(path.join(outDir, name, 'package.json'));
      expect(pkg.os).toEqual([platform]);
      expect(pkg.cpu).toEqual([cpu]);
      expect(pkg.files).toEqual(['bin']);

      const binPath = path.join(outDir, name, 'bin', binName);
      const stat = await Bun.file(binPath).exists();
      expect(stat).toBe(true);
    }
  });

  test('launcher lists all platforms as optionalDependencies', async () => {
    await pack(distDir, outDir, VERSION);

    const pkg = await readJson(path.join(outDir, 'opendocs-cli', 'package.json'));

    expect(pkg.bin).toEqual({ opendocs: 'bin/opendocs.js' });
    expect(pkg.type).toBe('module');
    expect(pkg.engines).toEqual({ node: '>=18' });
    expect(pkg.files).toEqual(['bin', 'README.md']);
    expect(pkg.optionalDependencies).toEqual({
      'opendocs-cli-darwin-arm64': VERSION,
      'opendocs-cli-darwin-x64': VERSION,
      'opendocs-cli-linux-x64': VERSION,
      'opendocs-cli-linux-arm64': VERSION,
      'opendocs-cli-windows-x64': VERSION,
    });

    const launcherJs = path.join(outDir, 'opendocs-cli', 'bin', 'opendocs.js');
    expect(await Bun.file(launcherJs).exists()).toBe(true);

    const readme = path.join(outDir, 'opendocs-cli', 'README.md');
    expect(await Bun.file(readme).exists()).toBe(true);
  });

  test('missing binary throws naming the file', async () => {
    await rm(path.join(distDir, 'opendocs-bun-linux-x64'));

    await expect(pack(distDir, outDir, VERSION)).rejects.toThrow(/opendocs-bun-linux-x64/);
  });
});
