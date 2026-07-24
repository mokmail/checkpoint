import { useEffect, useRef, useState } from 'react';
import { MessageView } from './MessageView';
import type { StoredMessage } from './api';

const INITIAL_WINDOW = 60;
const LOAD_MORE = 40;

interface Props {
  messages: StoredMessage[];
  onRegenerate: () => void;
  onEdit: (messageId: string, newContent: string) => void;
}

/**
 * Lightweight virtualization: only renders the most recent N messages,
 * with a "load older" button when the conversation is long.
 * Avoids rendering hundreds of heavy markdown blocks at once.
 */
export function VirtualizedMessages({ messages, onRegenerate, onEdit }: Props) {
  const [window, setWindow] = useState(INITIAL_WINDOW);
  const prevCountRef = useRef(messages.length);

  // When new messages arrive (count increases), reset to showing the tail.
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      setWindow(INITIAL_WINDOW);
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const total = messages.length;
  const visibleCount = Math.min(window, total);
  const startIdx = total - visibleCount;
  const visible = messages.slice(startIdx);

  const loadOlder = () => setWindow((w) => Math.min(w + LOAD_MORE, total));

  return (
    <div className="msg-rail">
      {startIdx > 0 && (
        <button className="load-older" onClick={loadOlder}>
          Show {Math.min(LOAD_MORE, startIdx)} older messages ({startIdx} hidden)
        </button>
      )}
      {visible.map((m) => (
        <MessageView
          key={m.id}
          msg={m}
          onRegenerate={m.role === 'assistant' ? onRegenerate : undefined}
          onEdit={m.role === 'user' ? onEdit : undefined}
        />
      ))}
    </div>
  );
}