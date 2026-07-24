import { z } from 'zod';

// Spec §2.6.5 — Plugin manifest format
export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  main: z.string(), // entry file (relative to plugin dir) or module export name
  type: z.enum(['filter', 'action', 'pipe', 'tool', 'skill']).default('filter'),
  hooks: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  dependencies: z.record(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export type HookName =
  | 'pre_chat'        // (ctx) => modify messages before sending to the model
  | 'post_chat'       // (ctx) => modify/inspect the response after generation
  | 'filter_message'  // (message) => transform a single message
  | 'on_conversation_create'
  | 'on_message_sent'
  | 'on_message_received'
  | 'tool_call'       // (toolName, args) => result
  | 'skill_invoke';   // (skillName, input) => output

export interface HookContext {
  conversationId?: string;
  userId?: string;
  model?: string;
  messages: { role: string; content: string }[];
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HookResult {
  messages?: { role: string; content: string }[]; // modified messages (for pre_chat)
  content?: string; // modified content (for filter_message / post_chat)
  skip?: boolean; // skip the model call entirely
  [key: string]: unknown;
}

export type HookHandler = (ctx: HookContext | string, extra?: unknown) => HookResult | Promise<HookResult>;

export interface LoadedPlugin {
  id: string;
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, unknown>;
  handlers: Partial<Record<HookName, HookHandler>>;
}

export function validateManifest(data: unknown): PluginManifest {
  return pluginManifestSchema.parse(data);
}