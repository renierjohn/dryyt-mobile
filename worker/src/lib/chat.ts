/** Customer ↔ driver chat inside a job's room (pickup order room or drop off trip), wiped when the job ends. */
export const CHAT_MAX_EACH = 10;
export const CHAT_MAX_LENGTH = 100;

export type ChatRole = 'customer' | 'driver';
export type ChatMessage = { from: ChatRole; text: string; at: number };

const KEY = 'chat';

export const chatMessages = async (storage: DurableObjectStorage) => (await storage.get<ChatMessage[]>(KEY)) ?? [];

/** Saves one message from `from`; the full list on success, or why it was refused. */
export async function addChat(storage: DurableObjectStorage, from: ChatRole, raw: unknown): Promise<ChatMessage[] | { error: string }> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { error: 'Type a message first' };
  if (text.length > CHAT_MAX_LENGTH) return { error: `Messages can be up to ${CHAT_MAX_LENGTH} characters` };
  const messages = await chatMessages(storage);
  if (messages.filter((m) => m.from === from).length >= CHAT_MAX_EACH) return { error: `You can send up to ${CHAT_MAX_EACH} messages` };
  const next = [...messages, { from, text, at: Date.now() }];
  await storage.put(KEY, next);
  return next;
}

export const clearChat = (storage: DurableObjectStorage) => storage.delete(KEY);
