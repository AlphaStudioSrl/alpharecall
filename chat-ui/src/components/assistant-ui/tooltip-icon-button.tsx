import * as React from "react";
import { Button, ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TooltipIconButtonProps extends ButtonProps {
  tooltip?: string;
  side?: "top" | "bottom" | "left" | "right";
}

export const TooltipIconButton = React.forwardRef<HTMLButtonElement, TooltipIconButtonProps>(
  ({ tooltip, className, variant = "ghost", size = "icon", type = "button", ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        type={type}
        className={cn("ar-chat-icon-button", className)}
        title={tooltip}
        aria-label={props["aria-label"] || tooltip}
        {...props}
      />
    );
  }
);
TooltipIconButton.displayName = "TooltipIconButton";
