// One icon family: 16px grid, 1.5px stroke, round joins, currentColor.

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: P) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
);
export const IconFrame = (p: P) => (
  <Svg {...p}>
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" />
  </Svg>
);
export const IconText = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 4h9M8 4v8.5" />
  </Svg>
);
export const IconImage = (p: P) => (
  <Svg {...p}>
    <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" />
    <path d="M3 11l3-3 2.5 2.5L10 9l3 3" />
    <circle cx="10.25" cy="5.75" r="0.9" />
  </Svg>
);
export const IconVector = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.75l5.25 5.25L8 13.25 2.75 8z" />
  </Svg>
);
export const IconControl = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="4.5" width="12" height="7" rx="3.5" />
    <circle cx="5.75" cy="8" r="1.25" />
  </Svg>
);
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M7 9a2.5 2.5 0 003.5 0l2-2A2.5 2.5 0 009 3.5l-.75.75M9 7a2.5 2.5 0 00-3.5 0l-2 2A2.5 2.5 0 007 12.5l.75-.75" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </Svg>
);
export const IconPointer = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 2.75l9 4.25-3.9 1.15-1.6 3.85z" />
  </Svg>
);
export const IconHand = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 8.5V4a1 1 0 012 0v3.5M7.5 7V3a1 1 0 012 0v4M9.5 7.25V4a1 1 0 012 0v5.5a4.5 4.5 0 01-4.5 4.5h-.4a4 4 0 01-3.1-1.5L2.2 10.8a1 1 0 011.5-1.3l1.8 1.5" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h8" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h8M8 4v8" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5l6 10.75H2z" />
    <path d="M8 6.75v2.75M8 11.4v.1" />
  </Svg>
);
export const IconRetry = (p: P) => (
  <Svg {...p}>
    <path d="M12.75 8A4.75 4.75 0 113.9 5.5" />
    <path d="M12.9 3.25V6h-2.75" />
  </Svg>
);
export const IconFlask = (p: P) => (
  <Svg {...p}>
    <path d="M6.25 2.75h3.5M6.75 2.75v4L3.4 12.1a.9.9 0 00.8 1.4h7.6a.9.9 0 00.8-1.4L9.25 6.75v-4" />
    <path d="M4.9 10h6.2" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Svg>
);

/** Row icon by element kind. */
export function TagIcon({ tag }: { tag: string }) {
  if (tag === "svg" || tag === "path" || tag === "circle" || tag === "g" || tag === "rect" || tag === "line") return <IconVector />;
  if (tag === "img" || tag === "picture" || tag === "video" || tag === "canvas") return <IconImage />;
  if (tag === "a") return <IconLink />;
  if (/^(button|input|select|textarea|label|form)$/.test(tag)) return <IconControl />;
  if (/^(p|span|h[1-6]|b|strong|em|i|small|td|th|li|code|kbd)$/.test(tag)) return <IconText />;
  return <IconFrame />;
}
