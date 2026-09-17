import { useEffect, useRef, useState } from "react";
import { StatusBadge, statusBorderColor } from "@/components/ontology/StatusBadge";
import { ConfidenceChip } from "@/components/ontology/ConfidenceChip";
import type { ReviewStatus } from "@/lib/mock-data";
import type { MorphRect } from "@/lib/app-state";
import type { AnchorMorphRects } from "@/components/detail/DetailView";
import { ChevronDown } from "lucide-react";

const DURATION_MS = 280;
// A plain decelerate curve, no overshoot — deliberately NOT the "back"/spring-flavored easings
// (anything whose control points exceed 1) since this transition needs to read as quick and
// understated, never bouncy.
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * The Overview→Editing "morph" transition: a single, non-interactive overlay that travels the
 * clicked Entity Type's own status circle and name label from their exact Overview position to
 * their exact position inside the Editing card's header, while the small shell around them grows
 * directly from a 40px circle into the card's own FULL final rounded rectangle (header + body,
 * already at its true resting size — see `AnchorMorphRects`' own doc comment) — one continuous
 * ~220ms animation, not a cut between two different-looking components and not a visible
 * intermediate "compact card" stop along the way. See the doc comment on `isAnchorMorphing` in
 * DetailView.tsx for how the real card underneath hands off from this once it arrives, and on
 * `bodyVisible` there for how its body content fades in overlapping the tail of this same motion
 * rather than as its own separate, sequential stage.
 *
 * Deliberately NOT built from the real `OntologyNode`/entity-card JSX — this only ever renders
 * for ~220ms, is never interactive (`pointer-events-none` throughout), and only needs to LOOK
 * like both endpoints, not behave like either one. Confidence/chevron don't exist at the Overview
 * end at all, so they never travel — they simply fade in as the shell reaches its final layout,
 * matching "Confidence and the chevron appear on the right side" rather than arriving from
 * somewhere.
 */
export function EntityMorphOverlay({
  circleOrigin,
  labelOrigin,
  target,
  status,
  confidence,
  name,
  warningReason,
  errorReason,
  onDone,
}: {
  circleOrigin: MorphRect;
  labelOrigin: MorphRect;
  target: AnchorMorphRects | null;
  status: ReviewStatus;
  confidence: number;
  name: string;
  warningReason?: string | undefined;
  errorReason?: string | undefined;
  onDone: () => void;
}) {
  const [arrived, setArrived] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // FLIP: paint at the origin position first (this render), THEN — only once we actually have a
  // target to travel to — flip to the target styles on the next frame, so the browser registers
  // the "before" state and genuinely transitions rather than skipping straight to "after".
  useEffect(() => {
    if (!target || arrived) return;
    const raf = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(raf);
  }, [target, arrived]);

  // Hands off to the real card once the travel animation has actually finished — plus a fallback
  // in case `target` never arrives (should not happen, but this overlay must never get stuck
  // on screen forever) or a `transitionend` gets lost (several properties transition at once).
  useEffect(() => {
    const max = window.setTimeout(() => doneRef.current(), DURATION_MS + 250);
    return () => window.clearTimeout(max);
  }, []);
  useEffect(() => {
    if (!arrived) return;
    const t = window.setTimeout(() => doneRef.current(), DURATION_MS);
    return () => window.clearTimeout(t);
  }, [arrived]);

  const borderColor = statusBorderColor(status);
  const shellStart: React.CSSProperties = {
    left: circleOrigin.x,
    top: circleOrigin.y,
    width: circleOrigin.width,
    height: circleOrigin.height,
    borderRadius: 9999,
    borderColor,
    borderWidth: 1.5,
    backgroundColor: "#fff",
    boxShadow: "0 2px 2px 0 rgba(0,0,0,0.1)",
  };
  const shellEnd: React.CSSProperties = target
    ? {
        left: target.cardRect.x,
        top: target.cardRect.y,
        width: target.cardRect.width,
        height: target.cardRect.height,
        borderRadius: 16,
        borderColor: "rgba(28,28,24,0.08)",
        borderWidth: 1.5,
        backgroundColor: "#fff",
        boxShadow: "0 2px 2px 0 rgba(0,0,0,0.1)",
      }
    : shellStart;

  const iconStart: React.CSSProperties = {
    left: circleOrigin.x + circleOrigin.width * 0.2,
    top: circleOrigin.y + circleOrigin.height * 0.2,
    width: circleOrigin.width * 0.6,
    height: circleOrigin.height * 0.6,
  };
  const iconEnd: React.CSSProperties = target
    ? {
        left: target.iconRect.x,
        top: target.iconRect.y,
        width: target.iconRect.width,
        height: target.iconRect.height,
      }
    : iconStart;

  const labelStart: React.CSSProperties = {
    left: labelOrigin.x,
    top: labelOrigin.y,
    width: labelOrigin.width,
    height: labelOrigin.height,
    fontSize: 12,
    fontWeight: 500,
    color: "#171B22",
    justifyContent: "center",
  };
  const labelEnd: React.CSSProperties = target
    ? {
        left: target.nameRect.x,
        top: target.nameRect.y,
        width: target.nameRect.width,
        height: target.nameRect.height,
        fontSize: 14,
        fontWeight: 600,
        color: "#3C3C3C",
        justifyContent: "flex-start",
      }
    : labelStart;

  const transitionAll = `all ${DURATION_MS}ms ${EASING}`;
  const fadeInStyle = (rect: MorphRect | undefined): React.CSSProperties =>
    rect
      ? {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          opacity: arrived ? 1 : 0,
          // Reveals only as the shell reaches its final layout (the last ~35% of the morph),
          // never earlier — see step 4 of the transition spec this implements.
          transition: `opacity ${DURATION_MS * 0.35}ms ease-out ${DURATION_MS * 0.6}ms`,
        }
      : { opacity: 0 };

  return (
    <div className="pointer-events-none fixed inset-0 z-[200]" aria-hidden="true">
      <div
        style={{
          position: "fixed",
          transition: transitionAll,
          ...(arrived ? shellEnd : shellStart),
        }}
      />
      <div
        style={{
          position: "fixed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: transitionAll,
          ...(arrived ? iconEnd : iconStart),
        }}
      >
        <StatusBadge
          status={status}
          size={20}
          confidence={confidence}
          warningReason={warningReason}
          errorReason={errorReason}
        />
      </div>
      <div
        style={{
          position: "fixed",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          letterSpacing: "-0.076px",
          transition: transitionAll,
          ...(arrived ? labelEnd : labelStart),
        }}
      >
        {name}
      </div>
      <div style={{ position: "fixed", ...fadeInStyle(target?.confidenceRect) }}>
        <ConfidenceChip confidence={confidence} />
      </div>
      <div
        style={{
          position: "fixed",
          alignItems: "center",
          justifyContent: "center",
          color: "#70757C",
          ...fadeInStyle(target?.chevronRect),
        }}
        className="flex"
      >
        <ChevronDown className="size-3.5" />
      </div>
    </div>
  );
}
