import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';

import { JobChat, useJobChat, type ChatMessage } from '@/components/job-chat';

jest.mock('@/components/icon', () => ({ Icon: () => null }));

const msg = (from: ChatMessage['from'], text: string, at: number): ChatMessage => ({ from, text, at });

async function setup(messages: ChatMessage[] | null, me: 'customer' | 'driver' = 'customer', connected = true, otherName: string | null = 'Dan Cruz') {
  const { result } = await renderHook(() => useJobChat());
  if (messages) await act(() => result.current.onMessage({ t: 'chat', messages }));
  const send = jest.fn();
  await render(<JobChat chat={result.current} me={me} otherName={otherName} send={send} connected={connected} />);
  return { send, result };
}

it('shows nothing until the room sends the chat', async () => {
  await setup(null);
  expect(screen.queryByText(/Chat with/)).toBeNull();
});

it('takes only chat messages from the socket', async () => {
  const { result } = await renderHook(() => useJobChat());
  expect(result.current.onMessage({ t: 'order' })).toBe(false);
  await act(() => {
    expect(result.current.onMessage({ t: 'chat_error', error: 'You can send up to 10 messages' })).toBe(true);
  });
  expect(result.current.error).toBe('You can send up to 10 messages');
});

it('shows mine and theirs, and sends a trimmed message', async () => {
  const { send } = await setup([msg('driver', 'Outside now', 1), msg('customer', 'Coming', 2)]);
  expect(screen.getByText('Chat with Dan Cruz')).toBeTruthy();
  expect(screen.getByTestId('chat-theirs')).toHaveTextContent('Dan CruzOutside now');
  expect(screen.getByTestId('chat-mine')).toHaveTextContent('Coming');
  expect(screen.getByText('9 of 10 messages left')).toBeTruthy();

  const send_ = () => screen.getByRole('button', { name: 'Send' });
  expect(send_()).toBeDisabled();
  await fireEvent.changeText(screen.getByDisplayValue(''), '  Blue gate  ');
  expect(screen.getByText('Message · 13/100')).toBeTruthy();
  await fireEvent.press(send_());
  expect(send).toHaveBeenCalledWith({ t: 'chat', text: 'Blue gate' });
});

it('caps typing at 100 characters and stops after 10 messages of my own', async () => {
  await setup(Array.from({ length: 10 }, (_, i) => msg('driver', `m${i}`, i)), 'driver');
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  expect(screen.getByText('You have sent all 10 messages for this job.')).toBeTruthy();

  await setup([msg('driver', 'hi', 1)], 'customer');
  expect(screen.getByDisplayValue('').props.maxLength).toBe(100);
});

it("can't send while the room is disconnected", async () => {
  await setup([], 'customer', false);
  await fireEvent.changeText(screen.getByDisplayValue(''), 'hello');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it("falls back to the other side's role while their name is unknown", async () => {
  await setup([msg('customer', 'Hi', 1)], 'driver', true, null);
  expect(screen.getByText('Chat with Customer')).toBeTruthy();
  expect(screen.getByTestId('chat-theirs')).toHaveTextContent('CustomerHi');
});
