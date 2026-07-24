export function pre_chat(ctx) {
  const messages = (ctx.messages ?? []).map((m) => ({
    ...m,
    content: m.content.replace(
      /(^|\s)(https?:\/\/[^\s]+)/g,
      (_, pre, url) => `${pre}[${url}](${url})`,
    ),
  }));
  return { messages };
}