export function isOAuthTokenEndpoint(url: string): boolean {
  return /\/oauth\/token\/?$/.test(url.split('?')[0]);
}
