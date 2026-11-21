// Keep pricing-only copy local: the trial allowance is lifetime, paid is monthly.
// Same numbers as app/plans.py and the public pricing page (alpharecall.com/pricing).
export const pricingQuotaCopy = {
  it: {
    free: { messages: "200 messaggi", pages: "50 pagine", pdf: "Spazio PDF: 40 MB totali" },
    pro: { messages: "1.500 messaggi al mese", pages: "500 pagine", pdf: "Spazio PDF: 100 MB totali" },
    business: { messages: "8.000 messaggi al mese", pages: "2.000 pagine", pdf: "Spazio PDF: 200 MB totali" },
    enterprise: { messages: "50.000 messaggi al mese", pages: "Pagine illimitate", pdf: "Spazio PDF: 300 MB totali" },
  },
  en: {
    free: { messages: "200 messages", pages: "50 pages", pdf: "PDF storage: 40 MB total" },
    pro: { messages: "1,500 messages per month", pages: "500 pages", pdf: "PDF storage: 100 MB total" },
    business: { messages: "8,000 messages per month", pages: "2,000 pages", pdf: "PDF storage: 200 MB total" },
    enterprise: { messages: "50,000 messages per month", pages: "Unlimited pages", pdf: "PDF storage: 300 MB total" },
  },
};
