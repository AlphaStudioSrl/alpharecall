import { useState } from "react";

interface ClarifyPromptProps {
  component: {
    question?: string;
    options?: string[];
    message?: string;
  };
  onSendMessage?: (text: string) => void;
}

/** Short answers to a clarifying question, one tap each. */
export function ClarifyPrompt({ component, onSendMessage }: ClarifyPromptProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const options = (component.options || []).slice(0, 4);

  if (!options.length) return null;

  const handleClick = (option: string) => {
    if (selected) return; // prevent double-click
    setSelected(option);
    onSendMessage?.(option);
  };

  return (
    <div className="ar-choice-chips" role="group" aria-label={component.question || undefined}>
      {options.map((option) => (
        <button key={option} type="button" className="ar-choice-chip" disabled={selected !== null}
          data-picked={selected === option ? "true" : undefined} onClick={() => handleClick(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}
