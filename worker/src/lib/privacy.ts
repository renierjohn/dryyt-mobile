/** "Juan Dela Cruz" → "Juan". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** "09171234567" → "0917•••4567": enough to recognise, not to call. Short numbers are fully hidden. */
export function maskPhone(phone: string) {
  const digits = phone.trim();
  if (digits.length < 8) return digits ? '•••' : '';
  return `${digits.slice(0, 4)}•••${digits.slice(-4)}`;
}
