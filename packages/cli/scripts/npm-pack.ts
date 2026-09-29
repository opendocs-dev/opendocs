#!/usr/bin/env bun
/**
 * Build the npm packages for the opendocs CLI: one platform binary package
 * per target, plus a thin launcher package with optionalDependencies on all of them.
 */
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Target = {
  /** The value passed to `bun build --compile --target=`. */
  binTarget: string;
  os: string;
  cpu: string;
  ext: string;
};

const TARGETS: Target[] = [
  { binTarget: 'bun-linux-x64', os: 'linux', cpu: 'x64', ext: '' },
  { binTarget: 'bun-linux-arm64', os: 'linux', cpu: 'arm64', ext: '' },
  { binTarget: 'bun-darwin-arm64', os: 'darwin', cpu: 'arm64', ext: '' },
  { binTarget: 'bun-darwin-x64', os: 'darwin', cpu: 'x64', ext: '' },
  { binTarget: 'bun-windows-x64', os: 'win32', cpu: 'x64', ext: '.exe' },
];

const REPOSITORY = {
  type: 'git',
  url: 'git+https://github.com/opendocs-dev/opendocs.git',
  directory: 'packages/cli',
};

/** This script's own directory, used to locate the launcher source and README relative to it. */
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

/** Write the 5 platform packages and the launcher package into `outDir`. */
export async function pack(distDir: string, outDir: string, version: string): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const optionalDependencies: Record<string, string> = {};

  for (const t of TARGETS) {
    const pkgName = `opendocs-cli-${t.os}-${t.cpu}`;
    optionalDependencies[pkgName] = version;

    const srcBin = path.join(distDir, `opendocs-${t.binTarget}${t.ext}`);
    if (!existsSync(srcBin)) {
      throw new Error(`missing binary: ${srcBin}`);
    }

    const pkgDir = path.join(outDir, pkgName);
    const binDir = path.join(pkgDir, 'bin');
    await mkdir(binDir, { recursive: true });

    const binName = `opendocs${t.ext}`;
    const destBin = path.join(binDir, binName);
    await copyFile(srcBin, destBin);
    await chmod(destBin, 0o755);

    const packageJson = {
      name: pkgName,
      version,
      description: 'Platform binary for the opendocs CLI',
      license: 'MIT',
      repository: REPOSITORY,
      os: [t.os],
      cpu: [t.cpu],
      files: ['bin'],
    };
    await writeFile(
      path.join(pkgDir, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`
    );
  }

  const launcherDir = path.join(outDir, 'opendocs-cli');
  const launcherBinDir = path.join(launcherDir, 'bin');
  await mkdir(launcherBinDir, { recursive: true });

  const launcherDest = path.join(launcherBinDir, 'opendocs.js');
  await copyFile(path.join(SCRIPT_DIR, '..', 'npm', 'opendocs.js'), launcherDest);
  await chmod(launcherDest, 0o755);

  await copyFile(
    path.join(SCRIPT_DIR, '..', '..', '..', 'README.md'),
    path.join(launcherDir, 'README.md')
  );

  const launcherPackageJson = {
    name: 'opendocs-cli',
    version,
    description: 'OpenDocs CLI: capture and compile App Flows',
    license: 'MIT',
    repository: REPOSITORY,
    bin: { opendocs: 'bin/opendocs.js' },
    type: 'module',
    engines: { node: '>=18' },
    files: ['bin', 'README.md'],
    optionalDependencies,
  };
  await writeFile(
    path.join(launcherDir, 'package.json'),
    `${JSON.stringify(launcherPackageJson, null, 2)}\n`
  );
}

async function main(): Promise<void> {
  const [distDir, outDir] = process.argv.slice(2);
  if (!distDir || !outDir) {
    process.stderr.write('usage: bun packages/cli/scripts/npm-pack.ts <distDir> <outDir>\n');
    process.exit(1);
  }

  const pkgJson = JSON.parse(
    await readFile(path.join(SCRIPT_DIR, '..', 'package.json'), 'utf8')
  ) as { version: string };
  await pack(distDir, outDir, pkgJson.version);
}

if (import.meta.main) {
  await main();
}
