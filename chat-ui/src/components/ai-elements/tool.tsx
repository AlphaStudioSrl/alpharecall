import * as React from "react";
import { cn } from "@/lib/utils";

type ToolState = "idle" | "loading" | "complete" | "error";

export function Tool({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("ar-ai-tool", className)}>{children}</div>;
}

export function ToolHeader({
  type,
  state = "complete",
  title,
}: {
  type?: string | null;
  state?: ToolState;
  title?: string | null;
}) {
  const cleanType = String(type || "")
    .replace(/^tool-/, "")
    .replace(/_/g, " ")
    .trim();
  const label = cleanType || "tool";
  const stateLabel = state === "error" ? "Error" : state === "loading" ? "Running" : "Done";
  return (
    <div className="ar-ai-tool-header">
      <div className="flex items-center gap-2">
        <span className="ar-ai-tool-pill">{label}</span>
        <span className={cn("ar-ai-tool-state", `ar-ai-tool-state-${state}`)}>{stateLabel}</span>
      </div>
      {title ? <div className="ar-ai-tool-title">{title}</div> : null}
    </div>
  );
}

export function ToolContent({ children }: { children: React.ReactNode }) {
  return <div className="ar-ai-tool-content">{children}</div>;
}

export function ToolInput({ input }: { input?: any }) {
  if (!input) return null;
  return (
    <div className="ar-ai-tool-input">
      <div className="ar-ai-tool-label">Input</div>
      <pre>{JSON.stringify(input, null, 2)}</pre>
    </div>
  );
}

export function ToolOutput({
  output,
  errorText,
}: {
  output?: React.ReactNode;
  errorText?: string | null;
}) {
  if (!output && !errorText) return null;
  return (
    <div className="ar-ai-tool-output">
      {errorText ? (
        <div className="ar-ai-tool-error">{errorText}</div>
      ) : (
        <div className="ar-ai-tool-output-body">{output}</div>
      )}
    </div>
  );
}
