// Sample excerpts for the curation prototype. No backend yet — these stand in
// for what will eventually arrive from a registered book (title, author,
// excerpt, page, and a colour sampled from the cover).

export type Mood = "punk" | "neutral" | "literary";

export interface Book {
  id: string;
  title: string;
  author: string;
  publisher?: string;
  /** The excerpt. Blank lines separate paragraphs. */
  excerpt: string;
  page: number;
  /** Mood hint — biases template selection, never forces it. */
  mood: Mood;
  /** Raw dominant colour as if sampled from the cover (toned down later). */
  cover: string;
  /** A single word for the oversized Swiss-punk display, when chosen. */
  keyword: string;
}

export const BOOKS: Book[] = [
  {
    id: "kafka-metamorphosis",
    title: "변신",
    author: "프란츠 카프카",
    publisher: "문학동네",
    excerpt: "어느 날 아침 그레고르 잠자가 불안한 꿈에서 깨어났을 때, 그는 침대 속에서 한 마리의 흉측한 갑충으로 변해 있는 자신을 발견했다.",
    page: 9,
    mood: "literary",
    cover: "#C9A227",
    keyword: "변신",
  },
  {
    id: "camus-stranger",
    title: "이방인",
    author: "알베르 카뮈",
    publisher: "민음사",
    excerpt: "오늘 엄마가 죽었다. 아니 어쩌면 어제.",
    page: 13,
    mood: "punk",
    cover: "#2E5A8C",
    keyword: "이방인",
  },
  {
    id: "berger-ways",
    title: "다른 방식으로 보기",
    author: "존 버거",
    publisher: "열화당",
    excerpt:
      "본다는 것은 말보다 먼저 온다. 아이는 말을 배우기 전에 보고 알아본다.\n\n그러나 본다는 것이 말보다 먼저 온다는 것에는 또 다른 의미가 있다. 우리가 보는 것과 우리가 아는 것 사이의 관계는 결코 한번에 정리되지 않는다. 매일 저녁 우리는 해가 지는 것을 본다. 우리는 지구가 태양으로부터 등을 돌리고 있다는 사실을 안다. 그러나 그 앎은, 그 광경은, 결코 우리가 보는 것과 들어맞지 않는다.",
    page: 7,
    mood: "neutral",
    cover: "#7A7A74",
    keyword: "응시",
  },
  {
    id: "bachelard-space",
    title: "공간의 시학",
    author: "가스통 바슐라르",
    publisher: "동문선",
    excerpt:
      "집은 우리의 최초의 세계다. 그것은 진정 하나의 우주다.\n\n우리가 몽상 속에서 살았던 집들, 우리의 기억이 깃든 모든 피난처의 공간들을 한데 모아본다면, 거기에는 우리 내면의 가장 깊은 곳을 측량하는 어떤 도면이 그려질 것이다. 다락방의 고독과 지하실의 어둠, 그 사이에서 우리는 자랐다.\n\n그러므로 집을 묘사하는 일은 곧 영혼의 지형을 그리는 일이 된다.",
    page: 78,
    mood: "literary",
    cover: "#8C5A3C",
    keyword: "거주",
  },
  {
    id: "calvino-cities",
    title: "보이지 않는 도시들",
    author: "이탈로 칼비노",
    publisher: "민음사",
    excerpt: "도시는 그것을 바라보는 사람의 눈 속에서만 존재한다.",
    page: 51,
    mood: "punk",
    cover: "#B0463C",
    keyword: "도시",
  },
  {
    id: "sontag-photography",
    title: "사진에 관하여",
    author: "수전 손택",
    publisher: "이후",
    excerpt:
      "사진을 찍는다는 것은 곧 사진에 찍히는 대상을 전유하는 것이다. 그것은 세계와 자신을 어떤 관계, 지식처럼 느껴지지만 사실은 권력에 가까운 관계 속에 놓는 일이다.\n\n결국 사진을 모은다는 것은 세계를 모으는 일이다.",
    page: 24,
    mood: "neutral",
    cover: "#3F4A3A",
    keyword: "응고",
  },
];
