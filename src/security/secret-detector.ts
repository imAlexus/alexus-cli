const secretPath =
  /(^|[\\/])(\.env(?:\.[^\\/]+)?|\.ssh|credentials?|wallet|browser[ _-]?profiles?|.*\.(?:pem|key|p12))($|[\\/])/i;
const secretValue =
  /\b(?:sk-or-v1-|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})[A-Za-z0-9_-]*\b/g;
export const isSensitivePath = (file: string): boolean => {
  const normalized = file.replaceAll("\\", "/");
  if (/(^|\/)\.env\.(?:example|sample|template)$/i.test(normalized)) return false;
  return secretPath.test(normalized);
};
export const redactSecrets = (text: string): string => text.replace(secretValue, "[REDACTED]");
