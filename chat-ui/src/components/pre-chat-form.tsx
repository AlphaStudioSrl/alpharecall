import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ShieldCheck, XIcon } from "lucide-react";
import type { ChatStrings } from "@/strings";

interface ConsentPayload {
  chatProcessing: boolean;
}

interface PreChatFormProps {
  strings: ChatStrings;
  onSubmit: (
    name: string,
    email: string,
    notifyOptIn: boolean,
    consent?: ConsentPayload,
    policyVersion?: string
  ) => Promise<void> | void;
  onDismiss?: () => void;
  isSubmitting: boolean;
  privacyNoticeUrl?: string;
  policyVersion?: string;
  initialName?: string;
  initialEmail?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PreChatForm({
  strings,
  onSubmit,
  onDismiss,
  isSubmitting,
  privacyNoticeUrl,
  policyVersion,
  initialName = "",
  initialEmail = "",
}: PreChatFormProps) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [chatConsent, setChatConsent] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const nameId = useId();
  const emailId = useId();
  const consentId = useId();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const validate = () => {
    if (!name.trim()) return strings.nameRequired || "Inserisci il tuo nome.";
    if (!email.trim()) return strings.emailRequired || "Inserisci la tua email.";
    if (!EMAIL_PATTERN.test(email.trim())) return strings.emailInvalid || "Inserisci un indirizzo email valido.";
    if (!chatConsent) return strings.consentRequired || "Ci serve il tuo consenso per inviare il messaggio.";
    return "";
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting || submittingRef.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    submittingRef.current = true;
    try {
      await onSubmit(
        name.trim(),
        email.trim().toLowerCase(),
        false,
        {
          chatProcessing: true,
        },
        policyVersion || "widget-v3"
      );
    } catch {
      setError(strings.registrationError || "Non siamo riusciti a salvare i tuoi dati. Riprova.");
    } finally {
      submittingRef.current = false;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !isSubmitting && onDismiss) {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ar-sheet-layer ar-prechat-layer">
      <div className="ar-sheet-scrim" aria-hidden="true" onClick={!isSubmitting ? onDismiss : undefined} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
        onKeyDown={handleKeyDown}
        className="ar-sheet ar-prechat"
      >
        <span className="ar-sheet-handle" aria-hidden="true" />
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            disabled={isSubmitting}
            aria-label={strings.consentDismissLabel || strings.dismissLabel}
            className="ar-sheet-close"
          >
            <XIcon aria-hidden="true" />
          </button>
        ) : null}

        <ShieldCheck aria-hidden="true" className="ar-sheet-icon" />
        <div className="ar-sheet-head">
          <h3 id={titleId} className="ar-sheet-title">
            {strings.preChatTitle || "Un ultimo passaggio"}
          </h3>
          <p id={descriptionId} className="ar-sheet-text">
            {strings.preChatSubtitle || "Lascia i tuoi dati per inviare il messaggio."}
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="ar-sheet-form">
          <label htmlFor={nameId} className="ar-field">
            <span className="ar-field-label">{strings.nameLabel || "Nome"}</span>
            <input
              ref={nameRef}
              type="text"
              id={nameId}
              autoComplete="name"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError("");
              }}
              placeholder={strings.namePlaceholder || "Come ti chiami?"}
            />
          </label>

          <label htmlFor={emailId} className="ar-field">
            <span className="ar-field-label">{strings.emailLabel || "Email"}</span>
            <input
              type="email"
              id={emailId}
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError("");
              }}
              placeholder={strings.emailPlaceholder || "nome@azienda.it"}
            />
          </label>

          <label htmlFor={consentId} className="ar-check">
            <input
              type="checkbox"
              id={consentId}
              required
              checked={chatConsent}
              onChange={(event) => {
                setChatConsent(event.target.checked);
                if (error) setError("");
              }}
            />
            <span>
              {privacyNoticeUrl ? (
                <>
                  {strings.privacyConsentText || "Ho letto e accetto l'"}
                  <a
                    href={privacyNoticeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {strings.privacyNoticeLinkLabel || "informativa sulla privacy"}
                  </a>
                </>
              ) : (
                strings.chatConsentLabel || "Acconsento al trattamento dei dati necessari per usare questa chat."
              )}
            </span>
          </label>

          {error ? (
            <p id={errorId} role="alert" className="ar-form-error">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={isSubmitting} className="ar-btn ar-btn--primary ar-btn--lg">
            {isSubmitting ? (strings.savingConsent || "Un attimo...") : (strings.startChat || "Invia il messaggio")}
          </button>
        </form>
      </div>
    </div>
  );
}
