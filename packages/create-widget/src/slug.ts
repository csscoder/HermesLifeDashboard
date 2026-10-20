export const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,49}$/

const CYRILLIC = new Map<string, string>([
  ['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'g'], ['д', 'd'], ['е', 'e'], ['ё', 'yo'],
  ['ж', 'zh'], ['з', 'z'], ['и', 'i'], ['й', 'y'], ['к', 'k'], ['л', 'l'], ['м', 'm'],
  ['н', 'n'], ['о', 'o'], ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'],
  ['ф', 'f'], ['х', 'kh'], ['ц', 'ts'], ['ч', 'ch'], ['ш', 'sh'], ['щ', 'shch'], ['ъ', ''],
  ['ы', 'y'], ['ь', ''], ['э', 'e'], ['ю', 'yu'], ['я', 'ya'], ['і', 'i'], ['ї', 'yi'],
  ['є', 'ye'], ['ґ', 'g'], ['ў', 'u'],
])

/** Latin slug for a title, or null when the title has no Latin letters or digits to keep. */
export function slugFromTitle(title: string): string | null {
  // Transliterate before NFKD: NFKD would split й and ё into base letter plus combining mark.
  let slug = title.toLowerCase().replace(/./gu, (char) => CYRILLIC.get(char) ?? char)
  slug = slug.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length > 50) {
    slug = slug.slice(0, 50)
    const dash = slug.lastIndexOf('-')
    if (dash > 0) slug = slug.slice(0, dash)
    slug = slug.replace(/-+$/, '')
  }
  return SLUG_PATTERN.test(slug) ? slug : null
}
