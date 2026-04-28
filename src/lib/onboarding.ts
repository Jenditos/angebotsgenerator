import { CompanySettings } from "@/types/offer";

export const ONBOARDING_MIN_STEP = 1;
export const ONBOARDING_MAX_STEP = 5;
export const ONBOARDING_TOTAL_STEPS = 5;
export const ONBOARDING_SNOOZE_COOKIE_NAME = "onboarding_snoozed";

export type OnboardingState = {
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  onboardingStep: number;
};

export function hasTaxIdentifier(settings: CompanySettings): boolean {
  return Boolean(settings.taxNumber.trim() || settings.vatId.trim());
}

export function getMissingOnboardingRequiredFields(
  settings: CompanySettings,
): string[] {
  const missing: string[] = [];

  if (!settings.companyName.trim()) {
    missing.push("companyName");
  }

  if (!settings.ownerName.trim()) {
    missing.push("ownerName");
  }

  if (!settings.companyEmail.trim()) {
    missing.push("companyEmail");
  }

  if (!settings.companyStreet.trim()) {
    missing.push("companyStreet");
  }

  if (!settings.companyPostalCode.trim()) {
    missing.push("companyPostalCode");
  }

  if (!settings.companyCity.trim()) {
    missing.push("companyCity");
  }

  if (!settings.companyIban.trim()) {
    missing.push("companyIban");
  }

  if (!hasTaxIdentifier(settings)) {
    missing.push("taxIdentifier");
  }

  return missing;
}

export function hasCompletedOnboardingRequiredFields(
  settings: CompanySettings,
): boolean {
  return getMissingOnboardingRequiredFields(settings).length === 0;
}

export function isOnboardingCompleted(
  state: Partial<OnboardingState> | null | undefined,
): boolean {
  return state?.onboardingCompleted === true;
}

export function clampOnboardingStep(step: number): number {
  if (!Number.isFinite(step)) {
    return ONBOARDING_MIN_STEP;
  }

  return Math.min(
    ONBOARDING_MAX_STEP,
    Math.max(ONBOARDING_MIN_STEP, Math.floor(step)),
  );
}
