import { useId, type SVGProps } from "react";

interface KcodeMarkProps extends SVGProps<SVGSVGElement> {
  /** `gradient` paints the brand ocean→lagoon gradient; `mono` follows `currentColor`. */
  readonly variant?: "gradient" | "mono";
}

/** The K-code "K_" mark (see assets/brand/kcode-mark-transparent.svg). */
export function KcodeMark({ variant = "gradient", ...props }: KcodeMarkProps) {
  const gradientId = useId();
  const stroke = variant === "gradient" ? `url(#${gradientId})` : "currentColor";
  const cursorFill = variant === "gradient" ? "#38BDF8" : "currentColor";
  return (
    <svg {...props} viewBox="226 180 652 664" xmlns="http://www.w3.org/2000/svg">
      {variant === "gradient" ? (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="230"
            y1="200"
            x2="780"
            y2="830"
          >
            <stop offset="0" style={{ stopColor: "var(--kcode-ocean, #1677FF)" }} />
            <stop offset="1" style={{ stopColor: "var(--kcode-lagoon, #38BDF8)" }} />
          </linearGradient>
        </defs>
      ) : null}
      <g
        fill="none"
        stroke={stroke}
        strokeWidth="100"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(-40 0)"
      >
        <path d="M290 236V788" />
        <path d="M656 236L318 512" />
        <path d="M400 464L640 788" />
      </g>
      <rect x="676" y="784" width="150" height="54" rx="27" fill={cursorFill} />
    </svg>
  );
}
