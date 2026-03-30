import { RefObject } from "react";

type VoiceLoginRequiredModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  sheetRef: RefObject<HTMLElement>;
};

export function VoiceLoginRequiredModal({
  isOpen,
  onClose,
  onLogin,
  sheetRef,
}: VoiceLoginRequiredModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="voiceLoginModalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-login-modal-title"
      onClick={onClose}
    >
      <section
        className="voiceLoginModalSheet"
        onClick={(event) => event.stopPropagation()}
        ref={sheetRef}
      >
        <header className="voiceLoginModalHeader">
          <strong id="voice-login-modal-title">Login erforderlich</strong>
          <button
            type="button"
            className="voiceLoginModalCloseButton"
            aria-label="Hinweis schließen"
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              className="topHeaderIcon"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <p className="voiceLoginModalText">
          Für die KI-Aufnahme ist ein Login erforderlich.
        </p>
        <div className="voiceLoginModalActions">
          <button
            type="button"
            className="primaryButton voiceLoginModalPrimaryButton"
            onClick={onLogin}
          >
            Login / Registrieren
          </button>
          <button
            type="button"
            className="ghostButton voiceLoginModalCancelButton"
            onClick={onClose}
          >
            Abbrechen
          </button>
        </div>
      </section>
    </div>
  );
}
