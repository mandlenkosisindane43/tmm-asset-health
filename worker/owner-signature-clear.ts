import { OWNER_SIGNATURE_SVG } from "./owner-signature-data";

export function ownerSignatureClearDataUri() {
  const fixed = OWNER_SIGNATURE_SVG.replace('<g fill="#173a79">', '<g fill="#173a79" fill-rule="evenodd">');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixed)}`;
}
