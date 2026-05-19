export type ReadingStatus = "reading" | "stopped" | "finished" | "unknown";

export interface BookFrontmatter {
  author?: string;
  status?: string;
  rawStatus?: string;
  stoppedAtPage?: number;
  startDate?: string;
  endDate?: string;
  tags: string[];
  publisher?: string;
  comment?: string;
}

export interface PageExcerpt {
  page: number;
  body: string;
  boldFragments: string[];
}

export interface BookNote {
  filePath: string;
  title: string;
  frontmatter: BookFrontmatter;
  externalQuote?: string;
  pages: PageExcerpt[];
  allBolds: BoldFragment[];
  status: ReadingStatus;
}

export interface BoldFragment {
  text: string;
  page: number;
  bookTitle: string;
  author?: string;
  filePath: string;
}

export type GraphLinkBasis = "author" | "tag-leaf";

export interface GraphNode {
  id: string;
  title: string;
  author?: string;
  tagLeaf?: string;
  degree: number;
  filePath: string;
}

export interface GraphLink {
  source: string;
  target: string;
  basis: GraphLinkBasis;
}
