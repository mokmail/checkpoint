import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prisma } from '../db.js';
import { hookBus } from './bus.js';
import { LoadedPlugin, PluginManifest, validateManifest, HookName, HookHandler } from './types.js';
import { builtinPlugins } from './builtins.js';

// Resolve the local plugins directory relative to the project root (monorepo).
// tsx/Node set __dirname to cwd in dev, so we check several candidate locations.
const candidates = [
  resolve(__dirname, '../../../plugins'),  // apps/api/src -> repo root (compiled)
  resolve(__dirname, '../../plugins'),     // apps/api -> repo root (tsx dev, __dirname=cwd)
  resolve(process.cwd(), '../../plugins'), // when cwd is apps/api
  resolve(process.cwd(), '../plugins'),    // when cwd is apps/
  resolve(process.cwd(), 'plugins'),       // when cwd is repo root
];
const LOCAL_PLUGINS_DIR = candidates.find((d) => existsSync(d)) ?? candidates[0];

/**
 * Load builtin plugins (always present) and local plugins from the `plugins/`
 * directory. Syncs enabled/config state from the database.
 */
export async function loadAllPlugins(): Promise<{ loaded: number; errors: string[] }> {
  const errors: string[] = [];
  hookBus.clear();

  // 1. builtins
  for (const bp of builtinPlugins) {
    try {
      await registerPlugin(bp.id, bp.manifest, bp.handlers, 'builtin');
    } catch (err) {
      errors.push(`builtin ${bp.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2. local plugins from disk
  if (existsSync(LOCAL_PLUGINS_DIR)) {
    try {
      const entries = await readdir(LOCAL_PLUGINS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = join(LOCAL_PLUGINS_DIR, entry.name);
        const manifestPath = join(dir, 'plugin.json');
        if (!existsSync(manifestPath)) continue;
        try {
          const raw = await readFile(manifestPath, 'utf-8');
          const manifest = validateManifest(JSON.parse(raw));
          const handlers = await loadHandlers(dir, manifest);
          await registerPlugin(entry.name, manifest, handlers, 'local', dir);
        } catch (err) {
          errors.push(`local ${entry.name}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      errors.push(`plugins dir: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { loaded: hookBus.all().length, errors };
}

async function loadHandlers(
  dir: string,
  manifest: PluginManifest,
): Promise<Partial<Record<HookName, HookHandler>>> {
  // For sandboxing, we load the plugin's main file and look for exported hook handlers.
  // We use dynamic import. In production this would run in a VM sandbox.
  const entry = join(dir, manifest.main);
  if (!existsSync(entry)) return {};
  const mod = await import(`file://${entry}`);
  const handlers: Partial<Record<HookName, HookHandler>> = {};
  for (const hook of manifest.hooks) {
    if (typeof mod[hook] === 'function') {
      handlers[hook as HookName] = mod[hook] as HookHandler;
    }
  }
  return handlers;
}

async function registerPlugin(
  id: string,
  manifest: PluginManifest,
  handlers: Partial<Record<HookName, HookHandler>>,
  source: 'builtin' | 'local',
  filePath?: string,
): Promise<void> {
  // upsert DB record
  const existing = await prisma.plugin.findUnique({ where: { name: id } });
  let enabled = true;
  let config: Record<string, unknown> = manifest.config ?? {};
  if (existing) {
    enabled = existing.enabled;
    config = { ...config, ...(existing.config as Record<string, unknown> ?? {}) };
  } else {
      await prisma.plugin.create({
        data: {
          name: id,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          type: manifest.type,
          enabled: true,
          config: manifest.config as Record<string, unknown> as import('@prisma/client').Prisma.InputJsonValue,
          hooks: manifest.hooks,
          permissions: manifest.permissions,
          source,
          filePath: filePath ?? null,
        },
      });
  }

  const loaded: LoadedPlugin = {
    id,
    manifest,
    enabled,
    config,
    handlers,
  };
  hookBus.register(loaded);
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const plugin = hookBus.get(id);
  if (plugin) plugin.enabled = enabled;
  await prisma.plugin.updateMany({ where: { name: id }, data: { enabled } });
}

export async function setPluginConfig(id: string, config: Record<string, unknown>): Promise<void> {
  const plugin = hookBus.get(id);
  if (plugin) plugin.config = config;
  await prisma.plugin.updateMany({ where: { name: id }, data: { config: config as import('@prisma/client').Prisma.InputJsonValue } });
}

export function listLoadedPlugins(): LoadedPlugin[] {
  return hookBus.all();
}

export { hookBus } from './bus.js';