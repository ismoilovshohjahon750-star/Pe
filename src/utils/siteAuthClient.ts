let currentAuthToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setSiteAuthToken(token: string | null): void {
  currentAuthToken = token;
}

export function getSiteAuthToken(): string | null {
  return currentAuthToken;
}

export function setOnUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || undefined);
  if (currentAuthToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${currentAuthToken}`);
  }
  const response = await fetch(input, {
    ...init,
    headers,
  });
  if (response.status === 401 && currentAuthToken) {
    unauthorizedHandler?.();
  }
  return response;
}
