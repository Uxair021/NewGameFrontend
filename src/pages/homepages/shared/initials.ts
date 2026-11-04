/** First letter of up to the first two words of a name/username — used as the avatar fallback
 * across /home1, /home2, and /home3 when there's no profile picture to show. */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
