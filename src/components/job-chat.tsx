import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { SocketMessage } from '@/hooks/use-socket';
import { useTheme } from '@/hooks/use-theme';

/** Same limits as the worker's lib/chat.ts. */
export const CHAT_MAX_EACH = 10;
export const CHAT_MAX_LENGTH = 100;

type Role = 'customer' | 'driver';
export type ChatMessage = { from: Role; text: string; at: number };

/**
 * The job room's chat state. Call `onMessage` first in the room's socket handler: it takes the chat messages and
 * returns true for them, so the screen can skip them.
 */
export function useJobChat() {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onMessage = useCallback((msg: SocketMessage) => {
    if (msg.t === 'chat') {
      setMessages(msg.messages);
      setError(null);
      return true;
    }
    if (msg.t === 'chat_error') {
      setError(msg.error);
      return true;
    }
    return false;
  }, []);
  return { messages, error, onMessage };
}

/**
 * Short chat between the customer and the driver until pickup: up to CHAT_MAX_EACH messages each, CHAT_MAX_LENGTH
 * characters long.
 */
export function JobChat({
  chat,
  me,
  otherName,
  send,
  connected,
}: {
  chat: ReturnType<typeof useJobChat>;
  me: Role;
  /** The other side's name; their role while it isn't known. */
  otherName: string | null | undefined;
  send: (msg: SocketMessage) => void;
  connected: boolean;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  // Nothing until the room sends the chat, so a reconnect never shows an empty one.
  if (!chat.messages) return null;
  const left = CHAT_MAX_EACH - chat.messages.filter((m) => m.from === me).length;
  const other = otherName?.trim() || (me === 'customer' ? 'Driver' : 'Customer');
  const submit = () => {
    send({ t: 'chat', text: text.trim() });
    setText('');
  };

  return (
    <Card>
      <ThemedText type="smallBold">Chat with {other}</ThemedText>
      {chat.messages.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No messages yet.
        </ThemedText>
      )}
      {chat.messages.map((m) => {
        const mine = m.from === me;
        return (
          <View
            key={`${m.from}-${m.at}`}
            testID={mine ? 'chat-mine' : 'chat-theirs'}
            style={[styles.bubble, mine ? styles.mine : styles.theirs, { backgroundColor: mine ? theme.primary : theme.primarySoft }]}>
            {!mine && (
              <ThemedText type="small" themeColor="textSecondary">
                {other}
              </ThemedText>
            )}
            <ThemedText type="small" style={{ color: mine ? theme.onPrimary : theme.text }}>
              {m.text}
            </ThemedText>
          </View>
        );
      })}
      {chat.error && <ErrorText error={new Error(chat.error)} />}
      {left > 0 ? (
        <>
          <TextField
            label={`Message · ${text.length}/${CHAT_MAX_LENGTH}`}
            value={text}
            onChangeText={setText}
            maxLength={CHAT_MAX_LENGTH}
            returnKeyType="send"
            onSubmitEditing={() => text.trim() && connected && submit()}
          />
          <View style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
              {left} of {CHAT_MAX_EACH} messages left
            </ThemedText>
            <Button title="Send" fieldCorners onPress={submit} disabled={!connected || text.trim() === ''} />
          </View>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          You have sent all {CHAT_MAX_EACH} messages for this job.
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
