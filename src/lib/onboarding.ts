import { CompanySettings } from "@/types/offer";

export const ONBOARDING_MIN_STEP = 1;
export const ONBOARDING_MAX_STEP = 4;
export const ONBOARDING_TOTAL_STEPS = 4;
export const ONBOARDING_SNOOZE_COOKIE_NAME = "onboarding_snoozed";

export function hasOnboardingSnoozeCookie(cookieString: string): boolean {
  return cookieString
    .split(";")
    .some((cookie) => cookie.trim() === `${ONBOARDING_SNOOZE_COOKIE_NAME}=1`);
}

export type OnboardingState = {
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  onboardingStep: number;
};

function hasFirstAndLastName(ownerName: string): boolean {
  return ownerName.trim().split(/\s+/).filter(Boolean).length >= 2;
}

export function getMissingOnboardingRequiredFields(
  settings: CompanySettings,
): string[] {
  const missing: string[] = [];

  if (!settings.companyName.trim()) {
    missing.push("companyName");
  }

  if (!hasFirstAndLastName(settings.ownerName)) {
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

  if (
    !Array.isArray(settings.customServiceTypes) ||
    settings.customServiceTypes.length === 0
  ) {
    missing.push("customServiceTypes");
  }

  if (!settings.taxNumber.trim()) {
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
