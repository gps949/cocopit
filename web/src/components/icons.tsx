import type { SVGProps } from "react";

function icon(path: React.ReactNode) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...props}
      >
        {path}
      </svg>
    );
  };
}

export const GaugeIcon = icon(
  <>
    <path d="M12 20a8 8 0 1 1 8-8" />
    <path d="M12 12l4-4" />
    <path d="M20 16.5a8 8 0 0 1-1 1.8" />
  </>,
);

export const UserIcon = icon(
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8" />
  </>,
);

export const FolderIcon = icon(
  <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
);

export const ChatIcon = icon(
  <path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20l.9-4.5A7.5 7.5 0 1 1 20 12.5z" />,
);

export const PulseIcon = icon(<path d="M3 12h4l2.5-6 4 12 2.5-6h5" />);

export const SlidersIcon = icon(
  <>
    <path d="M5 5v6M5 15v4M12 5v2M12 11v8M19 5v10M19 19v0" />
    <circle cx="5" cy="13" r="1.8" />
    <circle cx="12" cy="9" r="1.8" />
    <circle cx="19" cy="17" r="1.8" />
  </>,
);

export const ServerIcon = icon(
  <>
    <rect x="4" y="4.5" width="16" height="6.5" rx="1.5" />
    <rect x="4" y="13" width="16" height="6.5" rx="1.5" />
    <path d="M7.5 7.75h.01M7.5 16.25h.01" />
  </>,
);

export const SunIcon = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M3 12h2M19 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </>,
);

export const MoonIcon = icon(<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z" />);

export const MonitorIcon = icon(
  <>
    <rect x="3.5" y="5" width="17" height="11.5" rx="1.5" />
    <path d="M9 20h6M12 16.5V20" />
  </>,
);

export const RefreshIcon = icon(
  <>
    <path d="M20 8.5A8 8 0 0 0 5.6 6.4L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 15.5a8 8 0 0 0 14.4 2.1L20 16" />
    <path d="M20 20v-4h-4" />
  </>,
);
