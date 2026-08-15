/**
 * Vector icon set, drawn on a 24×24 grid with a 1.75 stroke to sit alongside
 * SF Symbols without pretending to be them.
 *
 * Text glyphs and emoji were the single clearest tell that this was a web page
 * rather than an app: they render differently per platform, ignore the type
 * scale, and cannot inherit weight.
 */

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'plus'
  | 'ellipsis'
  | 'menu'
  | 'camera'
  | 'photo'
  | 'share'
  | 'trash'
  | 'music'
  | 'lock'
  | 'flip'
  | 'stop'
  | 'check'
  | 'grip'
  | 'film'
  | 'metronome'
  | 'mic-off'
  | 'sparkle'
  | 'play'
  | 'sliders';

const PATHS: Record<IconName, JSX.Element> = {
  'chevron-left': <path d="M15 4.5 7.5 12l7.5 7.5" />,
  'chevron-right': <path d="M9 4.5 16.5 12 9 19.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  ellipsis: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 4h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17" />
      <path d="m14.5 15 1.8-1.8a2 2 0 0 1 2.8 0L21 15.2" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V3.5" />
      <path d="m8 7 4-3.5L16 7" />
      <path d="M5 13v5.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V13" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7.5 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7.5" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6.2a1 1 0 0 1 .8-1l8-1.6a1 1 0 0 1 1.2 1V15" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </>
  ),
  flip: (
    <>
      <path d="M3.5 9.5A8.5 8.5 0 0 1 18 6.4" />
      <path d="M20.5 14.5A8.5 8.5 0 0 1 6 17.6" />
      <path d="M18 3v3.6h-3.6M6 21v-3.6h3.6" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  grip: <path d="M9 8h6M9 12h6M9 16h6" />,
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M8 5v14M16 5v14" />
      <path d="M3 12h18" />
    </>
  ),
  metronome: (
    <>
      <path d="M10 3.5h4l4 17H6z" />
      <path d="M8.2 14h7.6" />
      <path d="M12 20V9" />
    </>
  ),
  'mic-off': (
    <>
      <path d="M9 6.5a3 3 0 0 1 6 0V11m0 3.2a3 3 0 0 1-6-2.2V9.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 9.6 5.7M18.5 11.5v.5a6.4 6.4 0 0 1-.5 2.5" />
      <path d="M12 18.5V21" />
      <path d="m4 4 16 16" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9z" />
  ),
  play: <path d="M8 5.2v13.6a1 1 0 0 0 1.5.87l11-6.8a1 1 0 0 0 0-1.74l-11-6.8A1 1 0 0 0 8 5.2z" />,
  sliders: (
    <>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2.2" />
      <circle cx="10" cy="16" r="2.2" />
    </>
  ),
};

export function Icon({
  name,
  size = 22,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
