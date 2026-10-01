import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import rejectIcon from "@/assets/icons/controller-button-x-16.svg";
import acceptIcon from "@/assets/icons/check-circle-2-16.svg";
import deleteIcon from "@/assets/icons/trash-can-16.svg";
import goIcon from "@/assets/icons/arrow-right-16.svg";

/**
 * The Overview selection bars' shared pieces (Figma 361:221554 / 361:221450 / 361:221511): a
 * borderless white bar with a soft shadow, "… selected", then shadcn sm buttons — Delete (ghost,
 * red) only once nothing selected is still a suggestion, Reject / Accept (outline) while
 * something is, and Go to Editing Mode (primary) last.
 */
export function SelectionBarShell({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="flex h-12 items-center gap-4 rounded-[4px] bg-white py-1 pl-4 pr-2 shadow-[0_1px_8px_-1px_rgba(0,0,0,0.1),0_0_2px_0_rgba(0,0,0,0.1)]"
    >
      <span className="max-w-60 truncate whitespace-nowrap text-sm leading-5 text-[#080a09]">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

const BUTTON =
  "flex h-8 min-w-16 shrink-0 items-center justify-center whitespace-nowrap rounded-[4px] px-2 py-1.5 text-sm font-medium leading-6 transition-colors";
// Figma's 1px stroke sits inside the button, so it's an inset ring rather than a border.
const VARIANT = {
  outline: "bg-white text-[#161919] shadow-[inset_0_0_0_1px_#e3e5e4] hover:bg-[#e3e5e4]",
  destructive: "text-[#dc2626] hover:bg-[#fef2f2] hover:text-[#ef4444]",
  primary: "bg-[#161919] text-[#fafafa] hover:bg-[#4e5553]",
};
const ICON = { reject: rejectIcon, accept: acceptIcon, delete: deleteIcon, go: goIcon };

function BarButton({
  variant,
  icon,
  trailing = false,
  onClick,
  disabledReason,
  children,
}: {
  variant: keyof typeof VARIANT;
  icon: keyof typeof ICON;
  trailing?: boolean;
  onClick: () => void;
  // Shown as the tooltip of a disabled button (e.g. why it can't be accepted yet).
  disabledReason?: string | undefined;
  children: string;
}) {
  const glyph = <img src={ICON[icon]} alt="" aria-hidden className="size-4 shrink-0" />;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!disabledReason}
      title={disabledReason}
      className={cn(
        BUTTON,
        VARIANT[variant],
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white",
      )}
    >
      {!trailing && glyph}
      <span className="px-1">{children}</span>
      {trailing && glyph}
    </button>
  );
}

export const DeleteButton = ({ onClick }: { onClick: () => void }) => (
  <BarButton variant="destructive" icon="delete" onClick={onClick}>
    Delete
  </BarButton>
);
export const RejectButton = ({ onClick }: { onClick: () => void }) => (
  <BarButton variant="outline" icon="reject" onClick={onClick}>
    Reject
  </BarButton>
);
export const AcceptButton = ({
  onClick,
  disabledReason,
}: {
  onClick: () => void;
  disabledReason?: string | undefined;
}) => (
  <BarButton variant="outline" icon="accept" onClick={onClick} disabledReason={disabledReason}>
    Accept
  </BarButton>
);
export const GoToEditingButton = ({ onClick }: { onClick: () => void }) => (
  <BarButton variant="primary" icon="go" trailing onClick={onClick}>
    Go to Editing Mode
  </BarButton>
);
