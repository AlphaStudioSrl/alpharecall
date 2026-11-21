import { BookOpenIcon, MessageCircleIcon } from "@/components/icons";
import { activeTabStyle } from "@/lib/active-tab-color";

/** Chat | Domande: a quiet segmented control, the FAQ is the chat's second tab. */
export function ChatTabNav({ activeTab, onChange, chatLabel, faqLabel }: {
  activeTab: "chat" | "faq";
  onChange: (tab: "chat" | "faq") => void;
  chatLabel: string;
  faqLabel: string;
}) {
  return (
    <div className="ar-chat-tabs" role="group">
      {(["chat", "faq"] as const).map((tab) => {
        const selected = activeTab === tab;
        const Icon = tab === "chat" ? MessageCircleIcon : BookOpenIcon;
        return (
          <button key={tab} type="button" aria-pressed={selected} onClick={() => onChange(tab)}
            className="ar-chat-tab" style={selected ? activeTabStyle : undefined}>
            <Icon aria-hidden="true" className="ar-chat-tab-icon" />
            {tab === "chat" ? chatLabel : faqLabel}
          </button>
        );
      })}
    </div>
  );
}
