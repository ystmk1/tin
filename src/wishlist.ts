// "읽고 싶은 도서" — a lightweight want-to-read list. These are NOT notes:
// no body, no graph, no excerpts — just a title/author bookmark you can search
// for and stash. Stored in localStorage for now (device-local); cloud sync can
// be layered on later the way note-metadata does it.

export interface WishItem {
  id: string;
  title: string;
  author?: string;
}

const KEY = "dokki:wishlist:v1";

export function getWishlist(): WishItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as WishItem[]) : [];
  } catch {
    return [];
  }
}

function save(items: WishItem[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota or disabled — ignore */
  }
}

/** Add to the front; ignores duplicates (by id). Returns the new list. */
export function addWishlist(item: WishItem): WishItem[] {
  const items = getWishlist().filter((w) => w.id !== item.id);
  items.unshift(item);
  save(items);
  return items;
}

export function removeWishlist(id: string): WishItem[] {
  const items = getWishlist().filter((w) => w.id !== id);
  save(items);
  return items;
}
