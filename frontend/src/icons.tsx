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

export function JsIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6.4 5.5v4.6a1.1 1.1 0 0 1-1.9.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M9 9.6c.2.6.7 1 1.4 1 .8 0 1.3-.4 1.3-.9 0-1.4-2.6-.8-2.6-2.3 0-.6.5-1.1 1.3-1.1.6 0 1.1.3 1.3.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function TsIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.8 5.7h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M6.3 5.7v4.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M9.3 9.6c.2.6.7 1 1.4 1 .8 0 1.3-.4 1.3-.9 0-1.4-2.6-.8-2.6-2.3 0-.6.5-1.1 1.3-1.1.6 0 1.1.3 1.3.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function JsonIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.8 2.8c-1 0-1.5.5-1.5 1.4v1.6c0 .8-.3 1.2-1 1.2v1c.7 0 1 .4 1 1.2v1.6c0 .9.5 1.4 1.5 1.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M10.2 2.8c1 0 1.5.5 1.5 1.4v1.6c0 .8.3 1.2 1 1.2v1c-.7 0-1 .4-1 1.2v1.6c0 .9-.5 1.4-1.5 1.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function CssIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5 5.5h6l-.5 5-2.5 1-2.5-1-.15-1.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 8h3.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

export function HtmlIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 5 3 8l2.5 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 5 13 8l-2.5 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.2 10.2 8.8 4.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function MarkdownIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.3 10V6l1.7 2 1.7-2v4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 6v3.2M10 9.2 8.8 8M10 9.2 11.2 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function YamlIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 4.5h5.5M3.5 8h7.5M3.5 11.5h4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="12" cy="4.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="5.5" cy="6" r="1.1" fill="currentColor" />
      <path d="M2.5 11.5 6 8l2 2 2.5-3 3 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8" cy="10" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function GitIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="3.6" r="1.3" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8" cy="12.4" r="1.3" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="12" cy="8" r="1.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M8 4.9v6.2M8.9 8.4 10.8 8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function ConfigIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M8 2.3v1.4M8 12.3v1.4M13.7 8h-1.4M3.7 8H2.3M11.9 4.1l-1 1M5.1 10.9l-1 1M11.9 11.9l-1-1M5.1 5.1l-1-1"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
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

type FileIconComponent = typeof FileIcon;

const EXTENSION_ICONS: Record<string, FileIconComponent> = {
  js: JsIcon, jsx: JsIcon, mjs: JsIcon, cjs: JsIcon,
  ts: TsIcon, tsx: TsIcon, mts: TsIcon, cts: TsIcon,
  json: JsonIcon, jsonc: JsonIcon,
  css: CssIcon, scss: CssIcon, sass: CssIcon, less: CssIcon,
  html: HtmlIcon, htm: HtmlIcon,
  md: MarkdownIcon, mdx: MarkdownIcon,
  yml: YamlIcon, yaml: YamlIcon,
  png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, svg: ImageIcon, webp: ImageIcon, ico: ImageIcon,
};

const FILENAME_ICONS: Record<string, FileIconComponent> = {
  'package-lock.json': LockIcon,
  'yarn.lock': LockIcon,
  'pnpm-lock.yaml': LockIcon,
  '.gitignore': GitIcon,
  '.gitattributes': GitIcon,
  '.gitmodules': GitIcon,
};

const CONFIG_NAME_PATTERN = /^(tsconfig|vite\.config|vitest\.config|webpack\.config|rollup\.config|jest\.config|babel\.config|\.eslintrc|\.prettierrc)/;

/** Picks the file-tree icon for an entry, matching by exact filename, then config-file naming conventions, then extension. */
export function getFileIcon(name: string, isDirectory: boolean): FileIconComponent {
  if (isDirectory) return FolderIcon;
  const lower = name.toLowerCase();
  if (FILENAME_ICONS[lower]) return FILENAME_ICONS[lower];
  if (CONFIG_NAME_PATTERN.test(lower)) return ConfigIcon;
  const dot = lower.lastIndexOf('.');
  const ext = dot > 0 ? lower.slice(dot + 1) : '';
  if (!ext && lower.startsWith('.')) return ConfigIcon;
  return EXTENSION_ICONS[ext] ?? FileIcon;
}
