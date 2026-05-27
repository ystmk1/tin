export type ReadingStatus = "reading" | "stopped" | "finished" | "unknown";

export interface BookFrontmatter {
  author?: string;
  status?: string;
  rawStatus?: string;
  stoppedAtPage?: number;
  startDate?: string;
  endDate?: string;
  tags: string[];
  rating?: number; // 1..5, extracted from ☆/★ tags
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
  /** Content between the 서평 quote and the first page marker (verbatim). */
  preamble?: string;
  pages: PageExcerpt[];
  allBolds: BoldFragment[];
  status: ReadingStatus;
  /**
   * Marks a "조각글" — a short excerpt note synced from the Obsidian plugin's
   * fragment folder. Drives placement in the bottom non-fiction strip instead
   * of the book stack. Set per-row from `notes.is_fragment`; the frontmatter
   * `비문학` tag no longer affects classification.
   */
  isFragment?: boolean;
}

export interface BoldFragment {
  text: string;
  page: number;
  bookTitle: string;
  author?: string;
  filePath: string;
}

export type GraphLinkBasis = "author" | "tag-leaf" | "ref";

/** How the graph decides which notes connect. */
export type GraphBasis = "off" | "author" | "tag" | "both";

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
