// Normalize Korean book author/contributor strings as they come from
// Aladin / NL Korea into a display-friendly form.
//
// Examples
//   "무라카미 하루키 (지은이), 김춘미 (옮긴이)" → "무라카미 하루키, 김춘미 옮김"
//   "박경리 (지은이)"                          → "박경리"
//   "프랑수아즈 사강 (지은이), 김남주 (옮긴이)" → "프랑수아즈 사강, 김남주 옮김"
//
// Rules
//   - "(지은이)" / "(글)"          → drop the role label entirely
//   - "(옮긴이)"                    → "이름 옮김"
//   - "(엮은이)"                    → "이름 엮음"
//   - other known roles             → "이름 <role>" with the kanji-style suffix
//   - unknown role                  → "이름 <role>" verbatim (still strips the
//                                      parens so it doesn't read like raw data)

const ROLE_SUFFIX: Record<string, string> = {
  "지은이": "",
  "글": "",
  "원작": "",
  "옮긴이": "옮김",
  "엮은이": "엮음",
  "엮음": "엮음",
  "감수": "감수",
  "그림": "그림",
  "사진": "사진",
  "해설": "해설",
  "주해": "주해",
  "편역": "편역",
  "역주": "역주",
  "기획": "기획",
};

export function formatAuthor(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw).trim();
  if (!cleaned) return undefined;
  // No role-paren pattern → leave as-is (NL Korea often returns clean strings).
  if (!cleaned.includes("(")) return cleaned;

  const parts = cleaned
    .split(/\s*,\s*/)
    .map(formatOne)
    .filter(Boolean);
  return parts.length ? parts.join(", ") : cleaned;
}

function formatOne(entry: string): string {
  const m = entry.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return entry.trim();
  const name = m[1].trim();
  const role = m[2].trim();
  if (role in ROLE_SUFFIX) {
    const suffix = ROLE_SUFFIX[role];
    return suffix ? `${name} ${suffix}` : name;
  }
  // Unknown role — drop the parens, keep the label
  return `${name} ${role}`;
}
