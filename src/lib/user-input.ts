export const MAX_VOICE_TRANSCRIPT_LENGTH = 10_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function isValidEmailAddress(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.length > 320) {
    return false;
  }

  return EMAIL_PATTERN.test(normalized);
}
