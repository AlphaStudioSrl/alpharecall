interface ChatStrings {
  greeting: string;
  welcomeSubtitle: string;
  inputPlaceholder: string;
  latestMessages: string;
  sendMessage: string;
  stopGenerating: string;
  clearConversation: string;
  closeChat: string;
  muteSounds: string;
  unmuteSounds: string;
  copyMessage: string;
  retryMessage: string;
  messageInput: string;
  errorPrefix: string;
  thinking: string;
  securityCheck: string;
  securityCheckFailed: string;
  thinkingLabel: string;
  doneThinking: string;
  thoughtForSeconds: string;
  thoughtForMinutes: string;
  thoughtForHours: string;
  thoughtForSecondsOne: string;
  thoughtForMinutesOne: string;
  thoughtForHoursOne: string;
  toolStatuses: Record<string, string>;
  preChatTitle: string;
  preChatSubtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  notifyOptIn: string;
  marketingOptIn: string;
  startChat: string;
  // GDPR Phase 1 consent strings
  privacyConsentText: string;
  privacyNoticeLinkLabel: string;
  privacyNoticeFooter: string;
  chatConsentLabel: string;
  nameRequired: string;
  emailRequired: string;
  emailInvalid: string;
  consentRequired: string;
  registrationError: string;
  savingConsent: string;
  consentDismissLabel: string;
  consentCardTitle: string;
  consentCardBody: string;
  consentCardSummaryTitle: string;
  consentCardPrivacy: string;
  consentCardAccept: string;
  consentCardDecline: string;
  consentCardAccepted: string;
  consentCardDeclined: string;
  consentCardExpired: string;
  consentCardError: string;
  consentCardRetry: string;
  consentAcceptedMessage: string;
  consentDeclinedMessage: string;
  consentFieldName: string;
  consentFieldEmail: string;
  consentFieldPhone: string;
  // Tool-UI labels
  from: string;
  to: string;
  sortBy: string;
  noDataAvailable: string;
  next: string;
  complete: string;
  step: string;
  // Tab labels + FAQ help center
  chatTab: string;
  faqTab: string;
  faqSearchPlaceholder: string;
  faqClearSearch: string;
  faqEmptyTitle: string;
  faqEmptyDesc: string;
  faqNoResults: string;
  faqAskAbout: string;
  faqGeneralCategory: string;
  faqHomeTitle: string;
  faqTopQuestions: string;
  faqBrowseTopics: string;
  faqBack: string;
  faqAnswerCount: string;
  faqAnswerCountOne: string;
  faqResultsCount: string;
  faqResultsCountOne: string;
  // Misc chrome
  humanReplyLabel: string;
  humanHandlingLabel: string;
  copiedLabel: string;
  dismissLabel: string;
  // Branded header + welcome state
  onlineStatus: string;
  personaStatus: string;
  assistantFallbackName: string;
  starterQuestions: string[];
  // Concierge shell
  moreOptions: string;
  welcomeIntro: string;
  welcomeHelp: string;
  aiDisclosure: string;
  aiDisclosureHuman: string;
  privacyShort: string;
  faqAskAssistant: string;
  faqViewLabel: string;
  connectionError: string;
  replyError: string;
  /** The turn ended with no answer at all; {name} is the assistant's name. */
  noReplyError: string;
  rateLimitError: string;
  sourcesLabel: string;
  workingLabel: string;
  rateChat: string;
}

// Defaults are Italian (tenant language). PHP injects the tenant's own strings
// over these via window.AlphaRecallChat.strings; the defaults are the fallback
// so nothing ever surfaces in English when a string is left uninjected.
const DEFAULTS: ChatStrings = {
  greeting: "Ciao!",
  welcomeSubtitle: "Come posso aiutarti oggi?",
  inputPlaceholder: "Scrivi un messaggio...",
  latestMessages: "Ultimi messaggi",
  sendMessage: "Invia messaggio",
  stopGenerating: "Interrompi",
  clearConversation: "Cancella conversazione",
  closeChat: "Chiudi chat",
  muteSounds: "Disattiva suoni",
  unmuteSounds: "Attiva suoni",
  copyMessage: "Copia",
  retryMessage: "Riprova",
  messageInput: "Scrivi il tuo messaggio",
  errorPrefix: "Errore:",
  thinking: "Sto analizzando le informazioni...",
  securityCheck: "Un attimo, controllo di sicurezza...",
  securityCheckFailed: "Il controllo di sicurezza non è andato a buon fine. Riprova tra poco.",
  thinkingLabel: "Sto analizzando le informazioni",
  doneThinking: "Analisi completata",
  thoughtForSeconds: "Analisi completata in {n} secondi",
  thoughtForMinutes: "Analisi completata in {n} minuti",
  thoughtForHours: "Analisi completata in {n} ore",
  thoughtForSecondsOne: "Analisi completata in 1 secondo",
  thoughtForMinutesOne: "Analisi completata in 1 minuto",
  thoughtForHoursOne: "Analisi completata in 1 ora",
  toolStatuses: {
    appointment: "Sto controllando l'appuntamento...",
    appointment_get: "Sto cercando l'appuntamento...",
    appointment_update: "Sto aggiornando l'appuntamento...",
    appointment_delete: "Sto annullando l'appuntamento...",
    email_lead: "Sto salvando i tuoi contatti...",
    email_lead_get: "Sto cercando i tuoi contatti...",
    email_lead_update: "Sto aggiornando i tuoi contatti...",
    email_lead_delete: "Sto rimuovendo i tuoi contatti...",
    contact_form: "Sto preparando il messaggio...",
    callback_request: "Sto chiedendo al team di richiamarti...",
    quote_request: "Sto preparando la tua richiesta di preventivo...",
    newsletter_subscribe: "Ti sto iscrivendo alla newsletter...",
    product_search: "Cerco i prodotti più adatti a te...",
    knowledge_search: "Cerco le informazioni giuste...",
    faq_search: "Cerco la risposta tra le FAQ...",
    business_info: "Controllo le informazioni sull'attività...",
    event_list: "Cerco gli eventi in programma...",
    event_register: "Sto confermando la tua iscrizione all'evento...",
    coupon_check: "Sto controllando il codice sconto...",
    feedback: "Sto salvando il tuo feedback...",
    escalate: "Sto avvisando il team...",
    clarify: "Preparo una domanda per te...",
    display: "Metto in ordine i risultati...",
    default: "Ci sto lavorando...",
  },
  preChatTitle: "Ci siamo quasi",
  preChatSubtitle: "Lasciaci i tuoi dati e inviamo il messaggio.",
  nameLabel: "Nome",
  namePlaceholder: "Come ti chiami?",
  emailLabel: "Email",
  emailPlaceholder: "nome@azienda.it",
  notifyOptIn: "Avvisami via email quando arriva una risposta",
  marketingOptIn: "Ogni tanto mandami novità e offerte via email",
  startChat: "Invia il messaggio",
  privacyConsentText: "Ho letto e accetto l'",
  privacyNoticeLinkLabel: "informativa sulla privacy",
  privacyNoticeFooter: "Usando la chat accetti l'",
  chatConsentLabel: "Acconsento al trattamento dei dati necessari per usare questa chat.",
  nameRequired: "Inserisci il tuo nome.",
  emailRequired: "Inserisci la tua email.",
  emailInvalid: "Inserisci un indirizzo email valido.",
  consentRequired: "Ci serve il tuo consenso per inviare il messaggio.",
  registrationError: "Non siamo riusciti a salvare i tuoi dati. Riprova.",
  savingConsent: "Un attimo...",
  consentDismissLabel: "Torna alla chat",
  consentCardTitle: "Ci serve il tuo consenso",
  consentCardBody: "Per continuare devo {purpose}.",
  consentCardSummaryTitle: "Cosa salveremo",
  consentCardPrivacy: "Leggi l'informativa sulla privacy",
  consentCardAccept: "Acconsento",
  consentCardDecline: "Non ora",
  consentCardAccepted: "Grazie, consenso registrato.",
  consentCardDeclined: "Va bene, non salverò i tuoi dati.",
  consentCardExpired: "Questa richiesta è scaduta. Chiedimelo di nuovo in chat.",
  consentCardError: "Non siamo riusciti a registrare la tua scelta. Riprova.",
  consentCardRetry: "Riprova",
  consentAcceptedMessage: "Va bene, procedi pure.",
  consentDeclinedMessage: "No grazie, preferisco non lasciare i miei dati.",
  consentFieldName: "Nome",
  consentFieldEmail: "Email",
  consentFieldPhone: "Telefono",
  from: "Da",
  to: "A",
  sortBy: "Ordina per",
  noDataAvailable: "Ancora nessun dato",
  next: "Avanti",
  complete: "Concludi",
  step: "Passo",
  chatTab: "Chat",
  faqTab: "Domande",
  faqSearchPlaceholder: "Cerca una risposta...",
  faqClearSearch: "Cancella ricerca",
  faqEmptyTitle: "Ancora nessuna FAQ",
  faqEmptyDesc: "Le risposte alle domande più comuni arriveranno presto.",
  faqNoResults: "Nessuna domanda corrisponde alla ricerca.",
  faqAskAbout: "Chiedi in chat",
  faqGeneralCategory: "Generale",
  faqHomeTitle: "Come possiamo aiutarti?",
  faqTopQuestions: "Le più cercate",
  faqBrowseTopics: "Sfoglia per argomento",
  faqBack: "Indietro",
  faqAnswerCount: "{n} risposte",
  faqAnswerCountOne: "1 risposta",
  faqResultsCount: "{n} risultati",
  faqResultsCountOne: "1 risultato",
  humanReplyLabel: "Risposta dal team",
  humanHandlingLabel: "Ti risponde il team · IA in pausa",
  copiedLabel: "Copiato",
  dismissLabel: "Chiudi",
  onlineStatus: "Online ora, rispondiamo subito",
  personaStatus: "{business} · risponde subito",
  assistantFallbackName: "Assistente",
  starterQuestions: [
    "Quali servizi offrite?",
    "Vorrei prenotare un appuntamento",
    "Quali sono i vostri orari?",
  ],
  moreOptions: "Altre opzioni",
  welcomeIntro: "Ciao, sono {name}.",
  welcomeHelp: "Come posso aiutarti?",
  aiDisclosure: "Stai parlando con un assistente virtuale basato su intelligenza artificiale",
  aiDisclosureHuman: "Le risposte dell'assistente virtuale sono generate con intelligenza artificiale",
  privacyShort: "Privacy",
  faqAskAssistant: "Non trovi? Chiedi a {name}",
  faqViewLabel: "Domande frequenti",
  connectionError: "Connessione persa, il messaggio non è partito.",
  replyError: "Al momento non riesco a rispondere. Riprova tra poco.",
  noReplyError: "{name} non ha risposto. Riprova.",
  rateLimitError: "Stai scrivendo un po' troppo in fretta. Aspetta qualche secondo e riprova.",
  sourcesLabel: "Fonti",
  workingLabel: "{name} sta rispondendo",
  rateChat: "Valuta la conversazione",
};

export function getChatStrings(): ChatStrings {
  const config = (window as any).AlphaRecallChat?.strings || {};
  return { ...DEFAULTS, ...config };
}

export type { ChatStrings };
