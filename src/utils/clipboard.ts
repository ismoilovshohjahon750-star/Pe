/**
 * Copies text to clipboard with fallback for non-HTTPS LAN URLs and older browsers.
 */
export async function copyTextCrossBrowser(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy execCommand fallback (e.g. insecure context or iOS Safari quirk)
    }
  }

  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '-9999px';
  ta.style.fontSize = '16px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);

  let ok = false;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
  }
  return ok;
}
