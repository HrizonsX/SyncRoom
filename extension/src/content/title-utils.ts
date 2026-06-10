export function isMembershipEditionLabel(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.length <= 16 && /会员/.test(normalized);
}

export function isMovieEditionLabel(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length > 18) {
    return false;
  }
  return (
    isMembershipEditionLabel(normalized) ||
    /^(正片|完整版|全集|中文版|中文配音|国语|普通话|粤语|英语|日语|韩语|原声|原声版|配音版|字幕版)$/.test(
      normalized,
    ) ||
    /(中文配音|国语配音|粤语配音|普通话配音|原声版|字幕版)/.test(normalized)
  );
}
