// Filename helpers. "Rocket Dodge.html" -> title "Rocket Dodge", slug "rocket-dodge".

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function toSlug(base: string): string {
  return base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
