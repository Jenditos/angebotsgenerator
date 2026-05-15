import OnboardingPageClient from "./OnboardingPageClient";

type OnboardingPageSearchParams = {
  embedded?: string | string[];
  restart?: string | string[];
};

type OnboardingPageProps = {
  searchParams?:
    | OnboardingPageSearchParams
    | Promise<OnboardingPageSearchParams>;
};

function resolveEmbeddedFlag(
  searchParams: OnboardingPageSearchParams | undefined,
): boolean {
  const value = searchParams?.embedded;
  if (Array.isArray(value)) {
    return value.includes("1");
  }
  return value === "1";
}

function resolveRestartFlag(
  searchParams: OnboardingPageSearchParams | undefined,
): boolean {
  const value = searchParams?.restart;
  if (Array.isArray(value)) {
    return value.includes("1");
  }
  return value === "1";
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const resolvedSearchParams = searchParams
    ? await searchParams
    : undefined;
  const embedded = resolveEmbeddedFlag(resolvedSearchParams);
  const allowCompletedRestart = resolveRestartFlag(resolvedSearchParams);

  return (
    <OnboardingPageClient
      embedded={embedded}
      allowCompletedRestart={allowCompletedRestart}
    />
  );
}
