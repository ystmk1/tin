// Korean Decimal Classification (한국십진분류법, KDC) — turn the first three
// digits of a 청구기호 (call number) into reader-friendly tags. We emit up to
// two tags, matching how the user files things by hand:
//   - a "대분류/중분류" path, e.g. 813 → "문학/한국문학"
//   - a "소분류" leaf,         e.g. 813 → "소설"
// Literature (8xx) and language (7xx) get the language + genre breakdown; other
// main classes fall back to just the class name. These tags are an overlay —
// they're never written into the note's .md.

const MAIN: Record<string, string> = {
  "0": "총류",
  "1": "철학",
  "2": "종교",
  "3": "사회과학",
  "4": "자연과학",
  "5": "기술과학",
  "6": "예술",
  "7": "언어",
  "8": "문학",
  "9": "역사",
};

// Second digit of a 7xx/8xx code → language / region.
const LANG: Record<string, string> = {
  "1": "한국",
  "2": "중국",
  "3": "일본",
  "4": "영미",
  "5": "독일",
  "6": "프랑스",
  "7": "스페인",
  "8": "이탈리아",
  "9": "기타",
};

// Third digit of an 8xx (literature) code → genre (소분류).
const LIT_GENRE: Record<string, string> = {
  "1": "시",
  "2": "희곡",
  "3": "소설",
  "4": "수필",
  "5": "연설·웅변",
  "6": "일기·서간·기행",
  "7": "풍자·유머",
  "8": "르포·기타",
};

/** Tags derived from a call number's leading KDC code. Empty when none apply. */
export function kdcTagsFromCallNo(callNo?: string): string[] {
  const code = kdcCode(callNo);
  if (!code) return [];
  const [d1, d2, d3] = code;
  const main = MAIN[d1];
  if (!main) return [];

  if (d1 === "8") {
    const lang = LANG[d2];
    const path = lang ? `문학/${lang}문학` : "문학";
    const genre = LIT_GENRE[d3];
    return genre ? [path, genre] : [path];
  }
  if (d1 === "7") {
    const lang = LANG[d2];
    return [lang ? `언어/${lang}어` : "언어"];
  }
  return [main];
}

/**
 * The leading 3-digit KDC class in a call number like "813.6 ㄱ123ㅅ" or
 * "한813.6". Returns "813" etc., or null when there's no 3-digit run.
 */
function kdcCode(callNo?: string): string | null {
  if (!callNo) return null;
  const m = callNo.match(/\d{3}/);
  return m ? m[0] : null;
}
