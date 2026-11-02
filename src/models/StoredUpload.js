import mongoose from 'mongoose';

/** Uploaded image bytes. Content documents store only the public URL (/api/uploads/:folder/:filename). */
const storedUploadSchema = new mongoose.Schema(
  {
    folder: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

storedUploadSchema.index({ folder: 1, filename: 1 }, { unique: true });

export const StoredUpload = mongoose.model('StoredUpload', storedUploadSchema);
