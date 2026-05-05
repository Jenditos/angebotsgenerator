import { NextResponse } from "next/server";
import {
  ONBOARDING_TOTAL_STEPS,
  getMissingOnboardingRequiredFields,
} from "@/lib/onboarding";
import {
  buildBypassAccessRecord,
  buildBypassUser,
  isAuthBypassEnabled,
} from "@/lib/access/auth-bypass";
import {
  isUserAccessSetupError,
  classifyUserAccessError,
  logUserAccessError,
} from "@/lib/access/access-errors";
import {
  buildAccessState,
  buildTransientTrialAccessRecord,
  ensureUserAccessRecord,
} from "@/lib/access/user-access";
import { requireAuthenticatedUser } from "@/lib/access/guards";
import {
  readOnboardingStatus,
  readSettings,
  writeOnboardingStatus,
} from "@/lib/settings-store";

export async function GET() {
  if (isAuthBypassEnabled()) {
    const user = buildBypassUser();
    const accessRecord = buildBypassAccessRecord();
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email ?? "",
      },
      access: accessRecord,
      state: buildAccessState(accessRecord),
      onboarding: {
        onboardingCompleted: true,
        onboardingCompletedAt: null,
        onboardingStep: 5,
      },
      missingFields: [],
    });
  }

  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const [accessRecord, rawOnboarding] = await Promise.all([
      ensureUserAccessRecord(
        authResult.supabase,
        authResult.user,
      ),
      readOnboardingStatus({
        supabase: authResult.supabase,
        userId: authResult.user.id,
      }),
    ]);
    let onboarding = rawOnboarding;
    let missingFields: string[] = [];

    try {
      const settings = await readSettings({
        supabase: authResult.supabase,
        userId: authResult.user.id,
      });
      missingFields = getMissingOnboardingRequiredFields(settings);

      if (
        missingFields.length === 0 &&
        rawOnboarding.onboardingCompleted !== true
      ) {
        onboarding = await writeOnboardingStatus(
          {
            onboardingCompleted: true,
            onboardingCompletedAt:
              rawOnboarding.onboardingCompletedAt ?? new Date().toISOString(),
            onboardingStep: ONBOARDING_TOTAL_STEPS,
          },
          {
            supabase: authResult.supabase,
            userId: authResult.user.id,
          },
        );
      }
    } catch {
      // If settings cannot be loaded here, keep auth status available and fall back
      // to the persisted onboarding record.
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: authResult.user.id,
        email: authResult.user.email ?? "",
      },
      access: accessRecord,
      state: buildAccessState(accessRecord),
      onboarding,
      missingFields,
    });
  } catch (error) {
    if (isUserAccessSetupError(error)) {
      logUserAccessError("GET /api/access/status transient setup fallback", error, {
        userId: authResult.user.id,
      });
      const fallbackAccessRecord = buildTransientTrialAccessRecord(authResult.user);
      let onboarding = {
        onboardingCompleted: false,
        onboardingCompletedAt: null as string | null,
        onboardingStep: 1,
      };
      try {
        onboarding = await readOnboardingStatus({
          supabase: authResult.supabase,
          userId: authResult.user.id,
        });
      } catch {
        // Keep defaults when onboarding status cannot be loaded.
      }
      return NextResponse.json({
        authenticated: true,
        user: {
          id: authResult.user.id,
          email: authResult.user.email ?? "",
        },
        access: fallbackAccessRecord,
        state: buildAccessState(fallbackAccessRecord),
        onboarding,
        missingFields: [],
        setupWarning: true,
      });
    }

    logUserAccessError("GET /api/access/status", error, {
      userId: authResult.user.id,
    });
    const classifiedError = classifyUserAccessError(
      error,
      "Zugriffsstatus konnte nicht geladen werden.",
    );
    return NextResponse.json(
      { error: classifiedError.publicMessage },
      { status: classifiedError.status },
    );
  }
}
