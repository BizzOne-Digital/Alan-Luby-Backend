import mongoose from 'mongoose';

const photoSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    alt: { type: String, required: true, trim: true, maxlength: 300 },
    /** Slug of the service this photo belongs to; doubles as the Work page category. */
    category: { type: String, required: true, trim: true, maxlength: 40, index: true },
    width: { type: Number, required: true, min: 1, max: 20000 },
    height: { type: Number, required: true, min: 1, max: 20000 },
    src: { type: String, required: true, trim: true, maxlength: 500, index: true },
    srcSet: { type: String, trim: true, maxlength: 2000, default: '' },
    focus: { type: String, trim: true, maxlength: 20, default: '50% 50%' },
    order: { type: Number, default: 0, index: true },
    showInWork: { type: Boolean, default: true },
    /** Position in the homepage "Selected work" set; 0 = not shown. */
    featured: { type: Number, default: 0, min: 0 },
    /** Position in the homepage photo strip; 0 = not shown. */
    marquee: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const Photo = mongoose.model('Photo', photoSchema);
