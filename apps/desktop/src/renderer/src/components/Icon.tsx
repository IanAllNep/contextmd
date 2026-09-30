const PATHS: Record<string, string> = {
  file: 'M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13',
  agent: 'M4 1.5h5.5L13 5v9.5H4z M6.5 9h4 M6.5 11.5h4 M6.5 6.5h1.5',
  folder: 'M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z',
  chevronRight: 'M6 4l4 4-4 4',
  chevronDown: 'M4 6l4 4 4-4',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10z M10.5 10.5L14 14',
  files: 'M3 1.5h6l3 3v10H3z M9 1.5v3h3',
  target: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z M8 11A3 3 0 1 0 8 5a3 3 0 0 0 0 6z',
  copy: 'M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3',
  close: 'M4 4l8 8 M12 4l-8 8',
  link: 'M6.5 9.5l3-3 M7 4.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8 M5.5 8L4 9.5A2.5 2.5 0 0 0 7.5 13L9 11.5',
  warning: 'M8 2l6.5 11.5h-13z M8 6.5v3 M8 11.5v.5',
  info: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13z M8 7.5v4 M8 5v.5',
  layers: 'M8 2l6.5 3.5L8 9 1.5 5.5z M1.5 8.5L8 12l6.5-3.5 M1.5 11.5L8 15l6.5-3.5',
  external: 'M9 2.5h4.5V7 M13.5 2.5L7.5 8.5 M11.5 9.5v4h-9v-9h4',
  pin: 'M6 2h4l-.5 4 2 2H4.5l2-2z M8 8v6',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.5 M13 2v3h-3',
  split: 'M2 2.5h12v11H2z M8 2.5v11',
  terminal: 'M2 2.5h12v11H2z M4.5 6l2 2-2 2 M8 10.5h3.5',
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS['file']} />
    </svg>
  );
}
