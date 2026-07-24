import { LoadedPlugin, HookName, HookContext, HookResult } from './types.js';

/**
 * Event-driven hook bus. Plugins register handlers for named hooks;
 * the core calls `runHook` at integration points. Handlers run in priority
 * (registration) order; for filter-type hooks each handler sees the output
 * of the previous (pipeline semantics).
 */
class HookBus {
  private plugins = new Map<string, LoadedPlugin>();

  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  unregister(id: string): void {
    this.plugins.delete(id);
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  all(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  /** Run all enabled handlers for a hook, piping ctx through each. */
  async runHook(
    hook: HookName,
    ctx: HookContext | string,
    extra?: unknown,
  ): Promise<HookResult> {
    const current: HookResult = typeof ctx === 'string' ? { content: ctx } : { ...ctx } as HookResult;

    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled) continue;
      const handler = plugin.handlers[hook];
      if (!handler) continue;
      try {
        const input = typeof ctx === 'string' ? current.content ?? ctx : { ...(current as HookContext), config: plugin.config };
        const result = await handler(input, extra);
        if (result.skip) return { ...current, ...result };
        // merge: for message filters, propagate modified messages
        if (result.messages) current.messages = result.messages;
        if (result.content !== undefined) current.content = result.content;
        Object.assign(current, result);
      } catch (err) {
        // a failing plugin must not break the core flow
        console.error(`[plugins] handler ${plugin.id}.${hook} threw:`, err);
      }
    }
    return current;
  }

  /** Collect results from all handlers (for tool/skill invocation). */
  async runHookCollect(
    hook: HookName,
    ctx: HookContext | string,
    extra?: unknown,
  ): Promise<{ pluginId: string; result: HookResult }[]> {
    const out: { pluginId: string; result: HookResult }[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled) continue;
      const handler = plugin.handlers[hook];
      if (!handler) continue;
      try {
        const input = typeof ctx === 'string' ? ctx : { ...(ctx as HookContext), config: plugin.config };
        const result = await handler(input, extra);
        out.push({ pluginId: plugin.id, result });
      } catch (err) {
        console.error(`[plugins] handler ${plugin.id}.${hook} threw:`, err);
      }
    }
    return out;
  }

  clear(): void {
    this.plugins.clear();
  }
}

export const hookBus = new HookBus();