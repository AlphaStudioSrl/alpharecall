import { useSupportChat } from "@/admin/hooks/use-support-chat";
import { SupportPanel } from "./support-panel";

export function SupportPage() {
  const chat = useSupportChat();
  return <div className="ar-support-page"><SupportPanel chat={chat} /></div>;
}
