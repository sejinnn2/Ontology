"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * The one shared tooltip look for the whole prototype (Confidence chip, review-status icons, and
 * anywhere else a rich hover/focus explanation is needed): black background, white primary text,
 * light-grey secondary text — see the child `<p>`/`<span>` conventions each caller already uses.
 * Defaults to the right side, auto-flipping to the left when the right side doesn't fit
 * (`avoidCollisions`, on by default, does the flip; `collisionPadding` keeps it off the viewport
 * edge) — callers needing a different side can still override `side`. Rendered in a Portal, so it
 * is never clipped by an ancestor's `overflow-hidden`/`overflow-y-auto` (e.g. the Detail side
 * panels or the scrolling contextual panel) and always paints above them.
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, style, side = "right", sideOffset = 8, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      side={side}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      // Radix flips left/right to avoid the viewport edge, but a narrow viewport can still leave
      // too little room on *either* side for a fixed 16rem box — capping width against the
      // available-space variable Radix computes (rather than a bare max-w-64) means the tooltip
      // shrinks and wraps instead of running off-screen when that happens.
      style={{
        maxWidth: "min(16rem, var(--radix-tooltip-content-available-width, 16rem))",
        ...style,
      }}
      className={cn(
        "z-50 whitespace-normal break-words rounded-lg bg-[#171B22] px-3 py-2 text-left text-[12px] leading-[1.4] text-white shadow-lg animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-tooltip-content-transform-origin)",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
