interface IconProps {
  className?: string;
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.379a1 1 0 0 1 .707.293L7.914 4H13.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 1.5h5.086a1 1 0 0 1 .707.293l2.914 2.914a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M8.5 1.5V4.5a1 1 0 0 0 1 1H12.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <line x1="8" y1="0.5" x2="8" y2="2.2" />
        <line x1="8" y1="13.8" x2="8" y2="15.5" />
        <line x1="0.5" y1="8" x2="2.2" y2="8" />
        <line x1="13.8" y1="8" x2="15.5" y2="8" />
        <line x1="2.6" y1="2.6" x2="3.8" y2="3.8" />
        <line x1="12.2" y1="12.2" x2="13.4" y2="13.4" />
        <line x1="2.6" y1="13.4" x2="3.8" y2="12.2" />
        <line x1="12.2" y1="3.8" x2="13.4" y2="2.6" />
      </g>
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" fill="currentColor" />
    </svg>
  );
}
