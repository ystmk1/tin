// Rule-based reflow of raw OCR text — ported from the Text Extractor project.
// Cleans noise, splits dialogue/narration, joins lines OCR broke mid-sentence
// (Korean 조사/어미 aware), and turns detected page numbers into "##### Np."
// markers — tin's note page-marker format.

export type ReflowMode = "smart" | "concat" | "space" | "off";

// 조사/어미 list. Dependent nouns like '수'/'것' are intentionally excluded to
// avoid wrongly joining them.
const SUFFIX_LIST = [
  "은", "는", "이", "가", "을", "를", "의", "에", "에서", "에게", "로", "으로", "와", "과", "도", "만",
  "까지", "마저", "조차", "부터", "이나", "나", "라도", "다", "고", "며", "면", "니", "지", "게", "어", "아",
  "던", "었", "았", "겠", "십", "습", "운", "음", "기", "할", "한", "하는", "하", "된", "될",
  "스럽", "스러운", "로운", "롭", "리", "리를", "라", "라며", "였", "였던", "였으",
  "었던", "았단", "웠던", "겠으", "다며", "다고", "라는", "다는", "이랄", "이냐", "냐며",
  "서", "진", "온", "예요", "어지는", "어요", "각", "요", "해질", "이다",
  "단하여", "동차의", "었다", "차", "이의", "했다", "해지기", "거든", "아야",
  "랑이를", "스러웠다", "동안을", "가로를", "히는", "겠다", "구먼요", "점에", "움에",
  "이야", "실한", "이라", "었잖아", "온다", "인가", "밖", "밖을", "지요", "갈수", "될",
  "없이", "게", "다시", "등짝에", "흔적이", "셨습니다", "름도", "닥에",
  "종의", "러운", "쳐져", "구이자", "졌고", "품의", "입니다",
  "카타", "드를", "늘게", "만일", "가?", "합니까", "갤", "마리를", "서랍에서",
  "좇아", "가다가는", "되니까", "특히", "가느다란",
  "안일", "만스럽", "무런", "미를", "어오는", "아왔다", "람들은", "질밖에",
];

const PAGE_MARKER = /^(#####\s)?\d+p\.$/;

export function processBookText(
  text: string,
  mode: ReflowMode,
  targetPageNum: number | null = null,
): string {
  if (mode === "off" || !text) return text;

  const suffixPattern = SUFFIX_LIST.join("|");
  const suffixRegex = new RegExp(`^(${suffixPattern})`);

  // Noise removal.
  text = text.replace(/[·.．…‥・]{2,}/g, "...");
  text = text.replace(/[一-龥]+/g, "");

  // Page numbers → "##### Np." separators (not deleted, repurposed).
  if (targetPageNum !== null) {
    const mid = new RegExp(`([가-힣])\\s*${targetPageNum}\\s*([가-힣])`, "g");
    text = text.replace(mid, `$1\n\n##### ${targetPageNum}p.\n\n$2`);
    const edge = new RegExp(`(^|\\n)\\s*${targetPageNum}\\s*(\\n|$)`, "g");
    text = text.replace(edge, `$1\n\n##### ${targetPageNum}p.\n\n$2`);
  }

  // Force-split dialogue and narration for readability.
  text = text.replace(/([.!?]["”’'’])([가-힣])/g, "$1\n\n$2");
  text = text.replace(/([.!?])\s*(["“「『'‘])/g, "$1\n\n$2");
  text = text.replace(/(["”’'’])\s*(["“「『'‘])/g, "$1\n\n$2");

  // Fix inverted dialogue quotes left by OCR.
  text = text.replace(/([?!])\n\n(["“「『'‘])([가-힣])/g, '$1"\n\n$3');

  // Misc fixed noise.
  text = text.replace(/(?:\n|^)\d+\s*[・·]\s*/g, "\n");
  text = text.replace(/(?:\n|^)\d+\s+([가-힣A-Za-z“"「『'‘])/g, "\n$1");
  text = text.replace(/(?<=\n|^)[가-힣]\s+([“"「『'‘])/g, "$1");
  text = text.replace(/([“"「『'‘])\s+/g, "$1");
  text = text.replace(/([A-Za-z])\s+([은는이가을를의에])/g, "$1$2");
  text = text.replace(/을유행/g, "");

  // Conservative internal-space repair.
  const internalFix = new RegExp(`([가-힣])\\s+(${suffixPattern})(?=[\\s.,!?"'”’]|$)`, "g");
  text = text.replace(internalFix, "$1$2");

  const lines = text.split(/\r?\n/);
  let result = "";

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      if (!result.endsWith("\n\n")) result += "\n\n";
      continue;
    }

    const isPageMarker = PAGE_MARKER.test(trimmed);
    const isTerminator = /[.!?]['"”’'’]?$/.test(trimmed);
    const hasHyphen = /-$/.test(trimmed);

    const nextTrimmed = i < lines.length - 1 ? lines[i + 1].trim() : "";
    const isNextDialogue = /^[“"「『'‘]/.test(nextTrimmed);
    const isCurrentDialogue = /^[“"「『'‘]/.test(trimmed);
    const isNextPageMarker = PAGE_MARKER.test(nextTrimmed);

    if (hasHyphen && nextTrimmed !== "" && /^[a-zA-Z]/.test(nextTrimmed)) {
      result += trimmed.slice(0, -1);
    } else {
      result += trimmed;
    }

    if (i < lines.length - 1) {
      if (nextTrimmed === "") {
        result += "\n";
      } else if (isCurrentDialogue || isNextDialogue || isPageMarker || isNextPageMarker) {
        result += "\n\n";
      } else if (isTerminator) {
        result += " ";
      } else if (hasHyphen && /^[a-zA-Z]/.test(nextTrimmed)) {
        // English hyphen already restored above — join with no space.
      } else if (mode === "concat") {
        // join with no space
      } else if (mode === "space") {
        result += " ";
      } else if (mode === "smart") {
        if (suffixRegex.test(nextTrimmed)) {
          // next line starts with a 조사/어미 → join with no space
        } else {
          result += " ";
        }
      }
    }
  }

  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.replace(/[ ]{2,}/g, " ");
  return result.trim();
}
