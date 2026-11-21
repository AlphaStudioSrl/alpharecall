// Copy for the Messenger cards in the thread (booking, request draft, guided
// questions, price list, hand-off, feedback, ratings). Same language pick as
// widgetCopy: Italian unless the tenant is configured for another language.
const IT = {
  // Booking
  bookingTitle: "Prenota un appuntamento",
  bookingFreeSlots: (n: number) => (n === 1 ? "1 orario libero" : `${n} orari liberi`),
  bookingMinutes: (min: number) => `${min} min`,
  bookingFrom: (day: string) => `dal ${day}`,
  bookingOpen: "Scegli giorno e ora",
  bookingDayFree: (day: string, n: number) => `${day} · ${n === 1 ? "1 orario libero" : `${n} orari liberi`}`,
  bookingPickTime: "Scegli un orario",
  bookingConfirm: (day: string, time: string) => `Conferma ${day} alle ${time}`,
  bookingRequested: (day: string, time: string) => `Hai scelto ${day} alle ${time}`,
  bookingRequestedSub: "Completiamo la prenotazione qui in chat",
  bookingTimezone: (zone: string) => `Orari nel fuso ${zone}`,
  bookingDays: "Giorni",
  bookingTimes: "Orari",
  bookingPrevDays: "Giorni precedenti",
  bookingNextDays: "Giorni successivi",
  bookingMessage: (day: string, time: string) => `Vorrei prenotare ${day} alle ${time}`,
  bookingIntro: "Scegli un orario libero:",
  bookingReasons: {
    busy: "Quell'orario è già occupato. Ecco i primi orari liberi:",
    outside_hours: "Quell'orario è fuori dagli orari di apertura. Ecco i primi orari liberi:",
    too_soon: "Quell'orario è troppo vicino per prenotare. Ecco i primi orari liberi:",
    needs_exact_time: "Scegli uno di questi orari liberi:",
  } as Record<string, string>,

  // Request draft (MessageDraft)
  draftLabel: "Richiesta da inviare",
  draftName: "Nome",
  draftEmail: "Email",
  draftPhone: "Telefono",
  draftSubject: "Oggetto",
  draftBody: "Richiesta",
  draftFrom: "Da",
  draftTo: "A",
  draftEdit: (label: string) => `Modifica ${label.toLowerCase()}`,
  draftDone: "Fatto",
  draftSend: (to: string) => (to ? `Invia a ${to}` : "Invia richiesta"),
  draftConsent: "Inviando ci autorizzi a ricontattarti per questa richiesta",
  draftCancel: "Annulla",
  draftSendingIn: (s: number) => `Invio tra ${s}s`,
  draftUndo: "Annulla invio",
  draftSent: "Richiesta inviata",
  draftAlreadySent: "Richiesta già inviata",
  draftSentAt: (time: string) => `Inviata alle ${time}`,
  draftCancelled: "Richiesta non inviata",
  draftReadAll: "Leggi tutto",
  draftShowLess: "Mostra meno",
  draftCorrection: (lines: string) => `Ho corretto i dati della richiesta, inviatela così:\n${lines}`,
  draftSubmitting: "Invio in corso…",
  draftRetry: "Riprova",
  draftSendError: "Non sono riuscito a inviare la richiesta. Controlla la connessione e riprova.",
  draftInvalid: "Qualche dato non è valido: controlla email e telefono e riprova.",
  draftSessionExpired: "La sessione della chat è scaduta: ricarica la pagina e riprova.",
  draftReplaced: "Questa richiesta non è più valida: ne è stata preparata una più recente.",
  draftMissing: "Non trovo più questa richiesta: chiedi all'assistente di prepararla di nuovo.",

  // Guided questions (QuestionFlow)
  flowTitle: "Capiamo cosa ti serve",
  flowQuestionOf: (step: number, total: number) => `Domanda ${step} di ${total}`,
  flowOneQuestion: "Una domanda veloce",
  flowQuestions: (n: number) => `${n} domande veloci`,
  flowStart: "Rispondi",
  flowNext: "Avanti",
  flowDone: "Invia risposta",
  flowBack: "Domanda precedente",
  flowSkip: (name: string) => `Salta e scrivi a ${name}`,
  flowSkipGeneric: "Salta e scrivi in chat",
  flowOther: "Scrivilo qui",
  flowAnswered: "Hai risposto",
  flowMulti: "Puoi sceglierne più di una",

  // Price list and services
  pricesLabel: "Listino",
  pricesShowAll: (n: number) => `Vedi tutto (${n})`,
  pricesShowLess: "Mostra meno",
  pricesAsk: "Chiedi",
  pricesAskAbout: (name: string) => `Mi interessa: ${name}`,
  pricesAskLabel: (name: string) => `Chiedi informazioni su ${name}`,
  carouselPage: (n: number, total: number) => `Pagina ${n} di ${total}`,
  carouselLabel: "Elenco scorrevole",
  open: "Vedi",

  // Hand-off to a person
  handoffTitle: "Ti rispondiamo qui",
  handoffWaiting: "Una persona del team continua questa chat",
  handoffEmail: "Il team ti risponde anche via email",
  handoffJoined: "Il team è in chat",
  handoffJoinedSub: "Scrivi pure qui, ti risponde una persona",
  handoffNoWait: "Non vuoi aspettare?",
  handoffCallback: "Ricontattatemi",
  handoffEmailLabel: "La tua email",
  handoffEmailHelp: "Ti rispondiamo via email. Dopo l'invio puoi chiudere la chat.",
  handoffEmailInvalid: "Controlla l'indirizzo email",
  handoffDetailsLabel: "Info aggiuntive (facoltativo)",
  handoffSend: "Invia",
  handoffError: "Invio non riuscito. Riprova.",
  handoffSentTitle: "Richiesta inviata",
  handoffSentSub: "Ora puoi chiudere la chat e iniziarne una nuova.",
  handoffNewChat: "Nuova chat",
  handoffEmailNote: "Se chiudi la chat, ti rispondiamo via email",

  // Feedback
  feedbackTitle: "Com'è andata?",
  feedbackSub: "Ci aiuti a rispondere meglio",
  feedbackStars: "Valutazione",
  feedbackStar: (n: number) => (n === 1 ? "1 stella" : `${n} stelle`),
  feedbackComment: "Raccontaci in una frase",
  feedbackPlaceholder: "Cosa ti è piaciuto? Cosa miglioreresti?",
  feedbackNeedComment: "Scrivi un commento per inviare",
  feedbackSend: "Invia feedback",
  feedbackMessage: (rating: number, comment: string) =>
    rating > 0
      ? `Vorrei lasciare un feedback sulla chat: voto ${rating} su 5. ${comment}`
      : `Vorrei lasciare un feedback sulla chat: ${comment}`,
  feedbackThanks: "Grazie per il feedback",
  feedbackSaved: "L'abbiamo girato al team",
  feedbackError: "Feedback non inviato, riprova",
  feedbackRated: (n: number) => `Valutazione ${n} su 5`,

  // Answer ratings (thumbs)
  rateUp: "Risposta utile",
  rateDown: "Risposta non utile",
  rateThanks: "Grazie, ne terremo conto",
  rateError: "Valutazione non salvata, riprova",

  // Business info
  infoCall: "Chiama",
  infoDirections: "Indicazioni",
  infoEmail: "Scrivi",
  infoHours: "Orari",
  infoPlace: "La nostra sede",

  // Events
  eventRegister: "Iscriviti",
  eventSeats: (taken: number, max: number) => `${taken} di ${max} posti presi`,

  // Coupon
  couponValid: "Codice valido",
  couponInvalid: "Codice non valido",

  // Generic
  toolError: "Non sono riuscito a mostrare questo contenuto.",
  close: "Chiudi",
};

type CardCopy = typeof IT;

const EN: CardCopy = {
  bookingTitle: "Book an appointment",
  bookingFreeSlots: (n) => (n === 1 ? "1 free slot" : `${n} free slots`),
  bookingMinutes: (min) => `${min} min`,
  bookingFrom: (day) => `from ${day}`,
  bookingOpen: "Pick a day and time",
  bookingDayFree: (day, n) => `${day} · ${n === 1 ? "1 free slot" : `${n} free slots`}`,
  bookingPickTime: "Pick a time",
  bookingConfirm: (day, time) => `Confirm ${day} at ${time}`,
  bookingRequested: (day, time) => `You picked ${day} at ${time}`,
  bookingRequestedSub: "We finish the booking here in the chat",
  bookingTimezone: (zone) => `Times in ${zone}`,
  bookingDays: "Days",
  bookingTimes: "Times",
  bookingPrevDays: "Earlier days",
  bookingNextDays: "Later days",
  bookingMessage: (day, time) => `I'd like to book ${day} at ${time}`,
  bookingIntro: "Pick a free time:",
  bookingReasons: {
    busy: "That time is taken. Here are the first free times:",
    outside_hours: "That time is outside opening hours. Here are the first free times:",
    too_soon: "That time is too soon to book. Here are the first free times:",
    needs_exact_time: "Pick one of these free times:",
  },

  draftLabel: "Request to send",
  draftName: "Name",
  draftEmail: "Email",
  draftPhone: "Phone",
  draftSubject: "Subject",
  draftBody: "Request",
  draftFrom: "From",
  draftTo: "To",
  draftEdit: (label) => `Edit ${label.toLowerCase()}`,
  draftDone: "Done",
  draftSend: (to) => (to ? `Send to ${to}` : "Send request"),
  draftConsent: "By sending you agree to be contacted about this request",
  draftCancel: "Cancel",
  draftSendingIn: (s) => `Sending in ${s}s`,
  draftUndo: "Undo",
  draftSent: "Request sent",
  draftAlreadySent: "Request already sent",
  draftSentAt: (time) => `Sent at ${time}`,
  draftCancelled: "Request not sent",
  draftReadAll: "Read all",
  draftShowLess: "Show less",
  draftCorrection: (lines) => `I corrected the request details, please send it like this:\n${lines}`,
  draftSubmitting: "Sending…",
  draftRetry: "Try again",
  draftSendError: "I couldn't send the request. Check your connection and try again.",
  draftInvalid: "Some details aren't valid: check the email and phone and try again.",
  draftSessionExpired: "The chat session has expired: reload the page and try again.",
  draftReplaced: "This request is no longer valid: a newer one was prepared.",
  draftMissing: "I can't find this request anymore: ask the assistant to prepare it again.",

  flowTitle: "Let's find what you need",
  flowQuestionOf: (step, total) => `Question ${step} of ${total}`,
  flowOneQuestion: "One quick question",
  flowQuestions: (n) => `${n} quick questions`,
  flowStart: "Answer",
  flowNext: "Next",
  flowDone: "Send answer",
  flowBack: "Previous question",
  flowSkip: (name) => `Skip and write to ${name}`,
  flowSkipGeneric: "Skip and write in the chat",
  flowOther: "Write it here",
  flowAnswered: "You answered",
  flowMulti: "You can pick more than one",

  pricesLabel: "Price list",
  pricesShowAll: (n) => `See all (${n})`,
  pricesShowLess: "Show less",
  pricesAsk: "Ask",
  pricesAskAbout: (name) => `I'm interested in: ${name}`,
  pricesAskLabel: (name) => `Ask about ${name}`,
  carouselPage: (n, total) => `Page ${n} of ${total}`,
  carouselLabel: "Scrollable list",
  open: "View",

  handoffTitle: "We'll reply here",
  handoffWaiting: "A person from the team continues this chat",
  handoffEmail: "The team also replies by email",
  handoffJoined: "The team is in the chat",
  handoffJoinedSub: "Write here, a person will reply",
  handoffNoWait: "Rather not wait?",
  handoffCallback: "Contact me",
  handoffEmailLabel: "Your email",
  handoffEmailHelp: "We'll reply by email. Once it's sent you can close the chat.",
  handoffEmailInvalid: "Check the email address",
  handoffDetailsLabel: "More details (optional)",
  handoffSend: "Send",
  handoffError: "Couldn't send it. Try again.",
  handoffSentTitle: "Request sent",
  handoffSentSub: "You can now close the chat and start a new one.",
  handoffNewChat: "New chat",
  handoffEmailNote: "If you close the chat, we'll reply by email",

  feedbackTitle: "How did it go?",
  feedbackSub: "Help us answer better",
  feedbackStars: "Rating",
  feedbackStar: (n) => (n === 1 ? "1 star" : `${n} stars`),
  feedbackComment: "Tell us in a sentence",
  feedbackPlaceholder: "What did you like? What would you improve?",
  feedbackNeedComment: "Write a comment to send",
  feedbackSend: "Send feedback",
  feedbackMessage: (rating, comment) =>
    rating > 0
      ? `I'd like to leave feedback on the chat: ${rating} out of 5. ${comment}`
      : `I'd like to leave feedback on the chat: ${comment}`,
  feedbackThanks: "Thanks for the feedback",
  feedbackSaved: "We passed it on to the team",
  feedbackError: "Feedback not sent, try again",
  feedbackRated: (n) => `Rated ${n} out of 5`,

  rateUp: "Helpful answer",
  rateDown: "Not helpful",
  rateThanks: "Thanks, we'll take it into account",
  rateError: "Rating not saved, try again",

  infoCall: "Call",
  infoDirections: "Directions",
  infoEmail: "Email",
  infoHours: "Opening hours",
  infoPlace: "Our location",

  eventRegister: "Register",
  eventSeats: (taken, max) => `${taken} of ${max} seats taken`,

  couponValid: "Valid code",
  couponInvalid: "Invalid code",

  toolError: "I couldn't show this content.",
  close: "Close",
};

export function cardCopy(locale?: string): CardCopy {
  const configured = typeof window !== "undefined" ? (window as any).AlphaRecallChat?.language : null;
  const italian = String(locale || configured || (typeof document !== "undefined" ? document.documentElement.lang : "it") || "it").startsWith("it");
  return italian ? IT : EN;
}

/** The assistant's name and the business name, as the widget header shows them. */
export function widgetNames(): { assistant: string; business: string } {
  const config = (typeof window !== "undefined" && (window as any).AlphaRecallChat?.config) || {};
  return {
    assistant: String(config.chatbotName || "").trim(),
    business: String(config.headerTitle || "").trim(),
  };
}

export type { CardCopy };
