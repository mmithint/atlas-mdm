/**
 * Generic sample images for the client demo (`npm run dev:mock` only; FINAL PLAN/11 §3 F8). No client photo
 * exists yet (Q-418), so these are simple drawings with "SAMPLE IMAGE" printed on them. Served as data URLs,
 * so nothing is fetched and nothing is written to disk.
 */
import type { PhotoType } from '@/features/field/field-types';

export interface SampleImage {
  id: string;
  label: string;
  photoType: PhotoType;
  fileName: string;
  url: string;
}

const svg = (body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" font-family="Consolas, monospace">${body}` +
      `<rect x="0" y="176" width="320" height="24" fill="#b45309"/>` +
      `<text x="160" y="193" fill="#fff" font-size="13" font-weight="700" text-anchor="middle">SAMPLE IMAGE · not a client photo</text></svg>`
  )}`;

const NAMEPLATE = svg(
  `<rect width="320" height="200" fill="#5b6570"/>` +
    `<rect x="30" y="22" width="260" height="140" rx="6" fill="#c9ced3" stroke="#2c333a" stroke-width="3"/>` +
    `<circle cx="44" cy="36" r="4" fill="#2c333a"/><circle cx="276" cy="36" r="4" fill="#2c333a"/>` +
    `<circle cx="44" cy="148" r="4" fill="#2c333a"/><circle cx="276" cy="148" r="4" fill="#2c333a"/>` +
    `<text x="160" y="52" font-size="15" font-weight="700" text-anchor="middle" fill="#1b2430">EXAMPLE HEATER CO.</text>` +
    `<text x="56" y="82" font-size="13" fill="#1b2430">MODEL  SYN-MODEL-2</text>` +
    `<text x="56" y="104" font-size="13" fill="#1b2430">S/N    SYN-SN-****-B</text>` +
    `<text x="56" y="126" font-size="13" fill="#1b2430">DUTY   2.5 MMBTU/HR</text>` +
    `<text x="56" y="146" font-size="11" fill="#3d4650">FIRED · NATURAL GAS</text>`
);

const OVERALL = svg(
  `<rect width="320" height="200" fill="#d8e3ea"/><rect y="140" width="320" height="36" fill="#a59a86"/>` +
    `<rect x="70" y="70" width="160" height="70" rx="30" fill="#8a949e" stroke="#2c333a" stroke-width="3"/>` +
    `<rect x="190" y="30" width="16" height="44" fill="#6b747d" stroke="#2c333a" stroke-width="2"/>` +
    `<rect x="90" y="140" width="12" height="18" fill="#2c333a"/><rect x="198" y="140" width="12" height="18" fill="#2c333a"/>` +
    `<line x1="230" y1="105" x2="300" y2="105" stroke="#2c333a" stroke-width="6"/>` +
    `<text x="150" y="110" font-size="12" text-anchor="middle" fill="#1b2430">HEATER TREATER</text>`
);

const TAG = svg(
  `<rect width="320" height="200" fill="#6f7a84"/>` +
    `<rect x="70" y="60" width="180" height="64" rx="4" fill="#f2c230" stroke="#2c333a" stroke-width="3"/>` +
    `<text x="160" y="100" font-size="20" font-weight="700" text-anchor="middle" fill="#1b2430">SYN-TAG-****</text>`
);

export const SAMPLE_IMAGES: readonly SampleImage[] = [
  { id: 'nameplate', label: 'Nameplate (sample)', photoType: 'NAMEPLATE', fileName: 'sample-nameplate.svg', url: NAMEPLATE },
  { id: 'overall', label: 'Whole heater (sample)', photoType: 'OVERALL', fileName: 'sample-heater.svg', url: OVERALL },
  { id: 'tag', label: 'Tag plate (sample)', photoType: 'TAG', fileName: 'sample-tag.svg', url: TAG },
];

export function sampleImage(photoType: PhotoType): SampleImage {
  return SAMPLE_IMAGES.find((s) => s.photoType === photoType) ?? SAMPLE_IMAGES[0];
}
