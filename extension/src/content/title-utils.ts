export function isMembershipEditionLabel(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.length <= 16 && /会员/.test(normalized);
}
