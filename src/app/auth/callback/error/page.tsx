import Link from "next/link";

type AuthCallbackErrorPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function readMessage(
  value: string | string[] | undefined,
  fallback: string,
): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => entry.trim());
    if (first) {
      return first.trim();
    }
  }
  return fallback;
}

export default function AuthCallbackErrorPage({
  searchParams,
}: AuthCallbackErrorPageProps) {
  const message = readMessage(
    searchParams?.message,
    "Bestaetigungslink konnte nicht verarbeitet werden.",
  );

  return (
    <main className="authViewport authGithubViewport">
      <div className="authGithubCenter">
        <section className="authGithubCard" aria-live="polite">
          <p className="authGithubModeIntro">
            Authentifizierung
            <span>Bestaetigung fehlgeschlagen</span>
          </p>

          <p className="authGithubMessage authGithubMessageError">{message}</p>
          <p className="authGithubSignupHint">
            Zurueck zum{" "}
            <Link href="/auth" className="authGithubInlineLink authGithubInlineLinkStrong">
              Login
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
