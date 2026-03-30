import { RefObject } from "react";

type InfoLegalModalProps = {
  isOpen: boolean;
  isClosing: boolean;
  onClose: () => void;
  sheetRef: RefObject<HTMLElement>;
};

export function InfoLegalModal({
  isOpen,
  isClosing,
  onClose,
  sheetRef,
}: InfoLegalModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={`infoLegalBackdrop ${isClosing ? "closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-legal-title"
      onClick={onClose}
    >
      <section
        className={`infoLegalSheet ${isClosing ? "closing" : ""}`}
        onClick={(event) => event.stopPropagation()}
        ref={sheetRef}
      >
        <header className="infoLegalHeader">
          <h2 id="info-legal-title" className="infoLegalHeading">
            Info &amp; Rechtliche Hinweise
          </h2>
          <button
            type="button"
            className="infoLegalCloseButton"
            aria-label="Info-Fenster schließen"
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

        <div className="infoLegalContent">
          <h3>Offline-Betrieb &amp; Datenschutz</h3>
          <p>
            Diese Software arbeitet überwiegend lokal. Alle Kundendaten,
            Angebots- und Rechnungsinformationen sowie PDF-Dateien werden primär
            auf dem Gerät des Nutzers gespeichert.
          </p>
          <p>
            Es findet keine automatische Weitergabe dieser Daten an den Anbieter
            oder Dritte statt.
          </p>
          <p>
            Sofern KI-Funktionen genutzt werden, können zur Verarbeitung
            Inhalte temporär an externe Dienste (z. B. OpenAI) übermittelt
            werden. Dabei werden keine Daten dauerhaft gespeichert oder
            weitergegeben.
          </p>
          <p>
            Der Nutzer ist verantwortlich für die Einhaltung der geltenden
            Datenschutzbestimmungen (insbesondere DSGVO), sowie für
            Datensicherung, sichere Passwörter und Zugriffsschutz.
          </p>

          <h3>Datenschutzrechte</h3>
          <p>
            Nutzer haben im Rahmen der gesetzlichen Bestimmungen das Recht auf
            Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung
            ihrer Daten.
          </p>
          <p>
            Bei Fragen zum Datenschutz können Sie sich jederzeit an den Anbieter
            wenden.
          </p>

          <h3>Lizenzprüfung &amp; Internetverbindung</h3>
          <p>
            Zur Lizenzprüfung kann beim Start oder in regelmäßigen Abständen -
            sofern eine Internetverbindung besteht - eine anonyme Anfrage an den
            VISIORO-Server gesendet werden. Dabei werden ausschließlich
            technische Informationen wie Lizenzstatus und Zeitstempel übertragen.
          </p>
          <p>
            Es werden keine sensiblen oder personenbezogenen Daten übermittelt.
          </p>
          <p>
            Die Nutzung der Software ist auch ohne Internetverbindung möglich
            (mit Ausnahme von KI-Funktionen).
          </p>

          <h3>Verantwortlichkeit</h3>
          <p>
            Für die Richtigkeit, Vollständigkeit und rechtliche Zulässigkeit der
            erstellten Angebote und Rechnungen ist ausschließlich der Nutzer
            verantwortlich. Der Anbieter übernimmt keine Haftung für Fehler,
            unvollständige Angaben oder daraus resultierende Schäden.
          </p>

          <h3>KI-Hinweis</h3>
          <p>
            Die durch KI generierten Inhalte dienen lediglich als Unterstützung
            und müssen vom Nutzer vor Verwendung geprüft und freigegeben werden.
          </p>

          <h3>Endbenutzer-Lizenzvereinbarung (EULA)</h3>
          <p>
            Diese Software darf ausschließlich im Rahmen ihrer vorgesehenen
            Nutzung verwendet werden. Eine Weitergabe, Vervielfältigung oder
            kommerzielle Weiterverwertung der Software oder ihrer Bestandteile
            ist ohne ausdrückliche Genehmigung untersagt.
          </p>
          <p>
            Mit der Nutzung der Software akzeptiert der Nutzer diese Bedingungen.
          </p>

          <h3>Anbieter</h3>
          <p className="infoLegalProvider">
            VISIORO SH.P.K.
            <br />
            Rr. Rifat Berisha 10
            <br />
            10000 Prishtina, Kosovo
            <br />
            E-Mail: info@visioro.com
          </p>
        </div>
      </section>
    </div>
  );
}
