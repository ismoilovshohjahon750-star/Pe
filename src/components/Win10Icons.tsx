import type { AppId } from '../desktop/types.ts';

export function Win10Logo({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M2 4.6L10.2 3.4V11.3H2V4.6ZM11.3 3.2L22 1.7V11.3H11.3V3.2ZM2 12.4H10.2V20.4L2 19.2V12.4ZM11.3 12.4H22V22L11.3 20.5V12.4Z" />
    </svg>
  );
}

export function AppGlyph({ appId, size = 20 }: { appId: AppId; size?: number }) {
  const s = size;
  switch (appId) {
    case 'explorer':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#FBBF24" />
          <rect x="6" y="12" width="12" height="5" rx="0.5" fill="#0078D4" />
        </svg>
      );
    case 'powershell':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="20" height="18" rx="2" fill="#012456" stroke="#60A5FA" strokeWidth="1.4" />
          <path d="M6.5 8.5L11.5 12L6.5 15.5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 15.5H17.5" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'edge':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#0078D4" />
          <path d="M5.5 14C7 9.5 11.5 7 16.5 8.5C14 10.5 12.5 12.5 13 15C13.5 17 16 18 18.5 17C16.5 19.5 12.5 21 8.5 19.5C6.2 18.5 4.8 16.3 5.5 14Z" fill="#38BDF8" />
        </svg>
      );
    case 'notepad':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="1.5" fill="#F8FAFC" stroke="#64748B" strokeWidth="1.4" />
          <rect x="4" y="3" width="16" height="4" rx="1" fill="#38BDF8" />
          <path d="M7.5 10.5H16.5M7.5 13.5H16.5M7.5 16.5H13.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'paint':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3C7 3 3 6.8 3 11.5C3 14.5 5 16 7.5 16H9.5C10.3 16 11 16.7 11 17.5C11 19.4 12.6 21 14.5 21C18.5 21 21 17 21 12C21 7 17 3 12 3Z" fill="#FDE68A" stroke="#D97706" strokeWidth="1.3" />
          <circle cx="8" cy="10" r="1.5" fill="#EF4444" />
          <circle cx="12" cy="7.5" r="1.5" fill="#3B82F6" />
          <circle cx="16" cy="10" r="1.5" fill="#10B981" />
        </svg>
      );
    case 'taskmgr':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="1.5" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.4" />
          <path d="M5.5 14H8.5L10.5 8L13.5 16.5L15.5 12H18.5" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'settings':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="#475569" />
          <circle cx="12" cy="12" r="3.2" fill="#E2E8F0" />
          <path d="M12 2V5M12 19V22M2 12H5M19 12H22M4.9 4.9L7 7M17 17L19.1 19.1M19.1 4.9L17 7M7 17L4.9 19.1" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'calculator':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="2.5" width="16" height="19" rx="2" fill="#1E293B" stroke="#64748B" strokeWidth="1.4" />
          <rect x="6.5" y="5" width="11" height="4" fill="#38BDF8" />
          <circle cx="8" cy="12.5" r="1" fill="#E2E8F0" />
          <circle cx="12" cy="12.5" r="1" fill="#E2E8F0" />
          <circle cx="16" cy="12.5" r="1" fill="#E2E8F0" />
          <circle cx="8" cy="16.5" r="1" fill="#E2E8F0" />
          <circle cx="12" cy="16.5" r="1" fill="#E2E8F0" />
          <circle cx="16" cy="16.5" r="1" fill="#F59E0B" />
        </svg>
      );
  }
}
