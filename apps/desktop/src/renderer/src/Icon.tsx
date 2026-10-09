import type { SVGProps } from "react";

// Line icons on a 24px grid, drawn with currentColor. Keep shapes simple and consistent (1.75 stroke, round joins).
const paths = {
  gallery: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9.5" r="1.75" /><path d="m21 15.5-4.5-4.5L7 20" /></>,
  organize: <><path d="M4 6h10M4 12h7M4 18h10" /><path d="m15.5 13.5 4.5 4.5M20 13.5l-4.5 4.5" /><circle cx="18" cy="6" r="2" /></>,
  explore: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  create: <><path d="M12 3.5 13.8 9l5.7 1.5-5.7 1.6L12 17.5l-1.8-5.4L4.5 10.5 10.2 9z" /><path d="M18.5 16v4M16.5 18h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.75v2.5M12 18.75v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.75 12h2.5M18.75 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" /></>,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.25 1.25L7 5M3.5 12l1.25 1.25L7 11" /><circle cx="5" cy="18" r="1.25" /></>,
  command: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></>,
  filter: <path d="M4 5h16l-6.25 7.5V19l-3.5-1.75V12.5z" />,
  sort: <><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5" /><path d="M14 7h7M14 12h5M14 17h3" /></>,
  select: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="m8 12 3 3 5-6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  heart: <path d="M12 20s-7.5-4.6-7.5-10A4.25 4.25 0 0 1 12 7.4 4.25 4.25 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
  pages: <><rect x="7" y="7" width="13" height="13" rx="2" /><path d="M4 15.5V6a2 2 0 0 1 2-2h9.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  more: <><circle cx="5.5" cy="12" r="1.1" /><circle cx="12" cy="12" r="1.1" /><circle cx="18.5" cy="12" r="1.1" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  folder: <path d="M3.5 7a2 2 0 0 1 2-2H9l2 2.5h7.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  album: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 3.5v17" /><path d="M11.5 9h5" /></>,
  user: <><circle cx="12" cy="8.5" r="3.75" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  shield: <path d="M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  rename: <><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z" /><path d="m13.5 8.5 3 3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.75v.5" /></>,
  remove: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  restore: <><rect x="4.5" y="8.5" width="11" height="11" rx="1.5" /><path d="M8.5 8.5V6a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 19.5 6v8a1.5 1.5 0 0 1-1.5 1.5h-2.5" /></>,
  home: <><path d="m4 11 8-6.5 8 6.5" /><path d="M6 9.5V20h12V9.5" /></>,
  zoomIn: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4M11 8v6M8 11h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4M8 11h6" /></>,
  open: <><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, filled = false, ...props }: { name: IconName; size?: number; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
