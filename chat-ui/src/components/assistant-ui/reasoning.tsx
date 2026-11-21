import * as React from "react";
import { cn } from "@/lib/utils";

type ReasoningProps = {
  text: string;
  className?: string;
};

export function Reasoning({ text, className }: ReasoningProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground", className)}>
      {text}
    </div>
  );
}

export function ReasoningGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
