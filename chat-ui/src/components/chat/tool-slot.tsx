import * as React from "react";
import { widgetCopy } from "@/lib/widget-copy";

const reported = new Set<string>();

type ToolSlotBoundaryProps = { tool: string; children: React.ReactNode };

/**
 * A tool card that throws while rendering must not take the whole widget down
 * with it: the answer text around it stays, the card becomes one quiet line.
 */
export class ToolSlotBoundary extends React.Component<ToolSlotBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Once per tool: a thread replays the same card on every render and reload.
    if (reported.has(this.props.tool)) return;
    reported.add(this.props.tool);
    console.error(`AlphaRecall: the "${this.props.tool}" card failed to render`, error);
  }

  render() {
    if (this.state.failed) {
      return <p className="ar-tool-fallback" role="note">{widgetCopy().cardUnavailable}</p>;
    }
    return this.props.children;
  }
}
