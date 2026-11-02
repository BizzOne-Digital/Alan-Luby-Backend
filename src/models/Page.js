import mongoose from 'mongoose';

export const PAGE_KEYS = ['home', 'about', 'services', 'work', 'testimonials', 'contact'];
export const HOME_SECTIONS = ['selectedWork', 'services', 'about', 'story', 'moments', 'clients'];

/**
 * One document per page of the site. The layout of each page is fixed in the frontend; `content` holds the
 * editable text and image/photo references for it as a flat map of strings.
 */
const pageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, enum: PAGE_KEYS, immutable: true },
    published: { type: Boolean, default: true },
    seoTitle: { type: String, trim: true, maxlength: 120, default: '' },
    seoDescription: { type: String, trim: true, maxlength: 300, default: '' },
    content: { type: Map, of: String, default: {} },
    sections: {
      type: [{ _id: false, key: { type: String, enum: HOME_SECTIONS, required: true }, visible: { type: Boolean, default: true } }],
      default: undefined,
    },
  },
  { timestamps: true },
);

export const Page = mongoose.model('Page', pageSchema);
