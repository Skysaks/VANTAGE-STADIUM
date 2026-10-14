// Inter (SIL Open Font License 1.1, © The Inter Project Authors) embarquée dans le fichier HTML :
// aucune requête réseau, rendu identique hors ligne.
import w400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import w500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import w600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import w700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';

export function loadFonts() {
  const faces = ([[w400, '400'], [w500, '500'], [w600, '600'], [w700, '700']] as const).map(([u, w]) => new FontFace('Inter', `url(${u}) format('woff2')`, { weight: w, display: 'swap' }));
  for (const f of faces) { document.fonts.add(f); void f.load().catch(() => {}); }
  return Promise.allSettled(faces.map((f) => f.loaded));
}
