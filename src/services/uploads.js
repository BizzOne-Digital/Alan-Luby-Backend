import { randomBytes } from 'node:crypto';
import { StoredUpload } from '../models/StoredUpload.js';
import { isUrlReferenced } from './references.js';

export const UPLOAD_FOLDERS = ['gallery', 'pages', 'misc'];
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Allowed types: accepted file extensions and the magic bytes the content must start with. */
const TYPES = {
  'image/png': { ext: 'png', exts: ['png'], match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', exts: ['jpg', 'jpeg'], match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', exts: ['gif'], match: (b) => ['GIF87a', 'GIF89a'].includes(b.toString('latin1', 0, 6)) },
  'image/webp': { ext: 'webp', exts: ['webp'], match: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
};

export const ALLOWED_MIME_TYPES = Object.keys(TYPES);

/** Generated names only: `${Date.now()}-${16 hex}.${ext}`. Anything else (slashes, "..") can never match. */
const FILENAME = /^\d{13}-[a-f0-9]{16}\.(png|jpg|gif|webp)$/;
const MANAGED_URL = new RegExp(`^/api/uploads/(${UPLOAD_FOLDERS.join('|')})/(\\d{13}-[a-f0-9]{16}\\.(?:png|jpg|gif|webp))$`);

export const detectImageType = (buffer) =>
  buffer?.length >= 12 ? (Object.keys(TYPES).find((mime) => TYPES[mime].match(buffer)) ?? null) : null;

export const isValidFolder = (folder) => UPLOAD_FOLDERS.includes(folder);
export const isValidFilename = (name) => typeof name === 'string' && FILENAME.test(name);

/** Checks the declared type, the extension and the real file signature agree. Returns an error message or null. */
export function checkImage({ mimetype, originalname, buffer, size }) {
  if (!TYPES[mimetype]) return 'Only PNG, JPEG, WebP and GIF images are allowed';
  const ext = String(originalname || '').split('.').pop().toLowerCase();
  if (!TYPES[mimetype].exts.includes(ext)) return 'The file extension does not match the image type';
  if (detectImageType(buffer) !== mimetype) return 'The file content is not a valid image of the stated type';
  if (size > MAX_UPLOAD_BYTES) return 'File is too large. The maximum size is 8MB.';
  return null;
}

export async function storeUpload(folder, file) {
  const filename = `${Date.now()}-${randomBytes(8).toString('hex')}.${TYPES[file.mimetype].ext}`;
  await StoredUpload.create({ folder, filename, mimeType: file.mimetype, size: file.size, data: file.buffer });
  return { url: `/api/uploads/${folder}/${filename}`, filename, size: file.size, folder };
}

/** Splits a managed URL into folder and filename; null for anything outside /api/uploads (static files, external URLs). */
export function parseManagedUrl(url) {
  const m = typeof url === 'string' ? MANAGED_URL.exec(url) : null;
  return m ? { folder: m[1], filename: m[2] } : null;
}

/**
 * Deletes a stored upload when it is no longer used by any content. Static site images and external URLs are
 * never touched. Returns true when a file was deleted.
 */
export async function deleteManagedUpload(url, options = {}) {
  const parsed = parseManagedUrl(url);
  if (!parsed) return false;
  if (await isUrlReferenced(url, options)) return false;
  const { deletedCount } = await StoredUpload.deleteOne(parsed);
  return deletedCount > 0;
}
