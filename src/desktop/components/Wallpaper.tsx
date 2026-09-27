

/**
 * Wallpaper source lives in one place. To ship a real image later, drop it in
 * public/assets/wallpaper.jpg (or .png/.webp) and change WALLPAPER_URL below —
 * nothing else in the desktop shell needs to change.
 */
const WALLPAPER_URL: string | null = null; // null = use the built-in gradient

export function Wallpaper() {
  if (WALLPAPER_URL) {
    return (
      <div
        className="wallpaper"
        style={{
          backgroundImage: `url(${WALLPAPER_URL})`,
        }}
      />
    );
  }
  // Temporary built-in wallpaper: a generated gradient, not an emoji/text glyph.
  return <div className="wallpaper wallpaper-default" />;
}
