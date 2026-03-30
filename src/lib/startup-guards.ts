import { assertEmailOAuthSecretConfigured } from "@/lib/email-oauth";

let hasCheckedStartupGuards = false;

export function runStartupGuards(): void {
  if (hasCheckedStartupGuards) {
    return;
  }

  assertEmailOAuthSecretConfigured();
  hasCheckedStartupGuards = true;
}
