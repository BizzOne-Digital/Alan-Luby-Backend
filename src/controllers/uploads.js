import multer from 'multer';
import { StoredUpload } from '../models/StoredUpload.js';
import { logActivity } from '../services/activity.js';
import { isUrlReferenced } from '../services/references.js';
import { MAX_UPLOAD_BYTES, checkImage, isValidFilename, isValidFolder, storeUpload } from '../services/uploads.js';
import { AppError, notFound } from '../utils/http.js';

// Memory only: nothing touches the local disk, so this works on serverless and ephemeral hosts.
const parseFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 1024 },
}).single('file');

export const upload = [
  parseFile,
  async (req, res) => {
    const folder = req.body?.folder;
    if (!isValidFolder(folder)) throw new AppError(400, 'Invalid upload folder');
    if (!req.file) throw new AppError(400, 'No file was uploaded');
    const problem = checkImage(req.file);
    if (problem) throw new AppError(400, problem);

    const saved = await storeUpload(folder, req.file);
    await logActivity(req, 'upload.create', { entity: 'Upload', entityId: saved.url, summary: `Uploaded ${saved.filename} (${Math.round(saved.size / 1024)} KB) to ${folder}` });
    res.status(201).json({ success: true, ...saved });
  },
];

function assertLocation({ folder, filename }) {
  if (!isValidFolder(folder) || !isValidFilename(filename)) throw new AppError(400, 'Invalid file path');
}

export async function serve(req, res) {
  assertLocation(req.params);
  const file = await StoredUpload.findOne({ folder: req.params.folder, filename: req.params.filename });
  if (!file) throw notFound('Image');
  res.set({
    'Content-Type': file.mimeType,
    'Content-Length': String(file.data.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    // The public site may live on another origin than the API.
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.end(file.data);
}

/** Removes an upload that no content uses (e.g. an image picked in a form and then replaced before saving). */
export async function remove(req, res) {
  assertLocation(req.params);
  const { folder, filename } = req.params;
  const url = `/api/uploads/${folder}/${filename}`;
  if (await isUrlReferenced(url)) throw new AppError(409, 'This image is still used on the site');
  const { deletedCount } = await StoredUpload.deleteOne({ folder, filename });
  if (!deletedCount) throw notFound('Image');
  await logActivity(req, 'upload.delete', { entity: 'Upload', entityId: url, summary: `Deleted ${filename} from ${folder}` });
  res.json({ success: true });
}
