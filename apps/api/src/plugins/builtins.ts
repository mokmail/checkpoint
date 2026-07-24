import { LoadedPlugin, HookName, HookHandler } from './types.js';

// Builtin plugins shipped with the app. Each demonstrates a plugin type from spec §2.6.2.

/** Filter plugin: masks common profanity in user messages before they reach the model. */
const profanityFilter: { id: string; manifest: LoadedPlugin['manifest']; handlers: Partial<Record<HookName, HookHandler>> } = {
  id: 'profanity-filter',
  manifest: {
    name: 'profanity-filter',
    version: '1.0.0',
    description: 'Masks profanity in outgoing messages',
    main: 'builtin',
    type: 'filter',
    hooks: ['pre_chat', 'filter_message'],
    permissions: [],
    config: { mask: '***' },
  },
  handlers: {
    pre_chat: (ctx) => {
      const c = ctx as { messages?: { role: string; content: string }[]; config?: { mask?: string } };
      const mask = c.config?.mask ?? '***';
      const banned = ['damn', 'hell', 'crap'];
      const messages = (c.messages ?? []).map((m) => ({
        ...m,
        content: banned.reduce((s, w) => s.replace(new RegExp(w, 'gi'), mask), m.content),
      }));
      return { messages };
    },
    filter_message: (ctx) => {
      const content = typeof ctx === 'string' ? ctx : '';
      const banned = ['damn', 'hell', 'crap'];
      const masked = banned.reduce((s, w) => s.replace(new RegExp(w, 'gi'), '***'), content);
      return { content: masked };
    },
  },
};

/** Tool plugin: counts tokens (rough estimate) — usable by agents via the tool_call hook. */
const tokenCounter: { id: string; manifest: LoadedPlugin['manifest']; handlers: Partial<Record<HookName, HookHandler>> } = {
  id: 'token-counter',
  manifest: {
    name: 'token-counter',
    version: '1.0.0',
    description: 'Estimates token count for text (~4 chars/token)',
    main: 'builtin',
    type: 'tool',
    hooks: ['tool_call'],
    permissions: [],
  },
  handlers: {
    tool_call: (ctx, extra) => {
      const toolName = extra as string;
      if (toolName !== 'token-counter') return {};
      const text = typeof ctx === 'string' ? ctx : '';
      return { content: String(Math.max(1, Math.round(text.length / 4))) };
    },
  },
};

/** Skill plugin: summarizes text — a pre-built AI capability. */
const summarizer: { id: string; manifest: LoadedPlugin['manifest']; handlers: Partial<Record<HookName, HookHandler>> } = {
  id: 'summarizer',
  manifest: {
    name: 'summarizer',
    version: '1.0.0',
    description: 'Summarizes long text into a concise summary',
    main: 'builtin',
    type: 'skill',
    hooks: ['skill_invoke'],
    permissions: [],
  },
  handlers: {
    skill_invoke: (ctx) => {
      const text = typeof ctx === 'string' ? ctx : '';
      // naive extractive summary: first + last sentence
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length <= 2) return { content: text };
      return { content: `${sentences[0]} ${sentences[sentences.length - 1]}` };
    },
  },
};

export const builtinPlugins = [profanityFilter, tokenCounter, summarizer];