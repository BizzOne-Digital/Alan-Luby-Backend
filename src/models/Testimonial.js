import mongoose from 'mongoose';

const testimonialSchema = new mongoose.Schema(
  {
    quote: { type: String, required: true, trim: true, maxlength: 3000 },
    /** Verbatim shortening of the quote; omitted passages are marked with " … ". */
    excerpt: { type: String, trim: true, maxlength: 1000, default: '' },
    clientRole: { type: String, required: true, trim: true, maxlength: 200 },
    organization: { type: String, trim: true, maxlength: 200, default: '' },
    location: { type: String, trim: true, maxlength: 200, default: '' },
    showOnPage: { type: Boolean, default: false },
    order: { type: Number, default: 0, index: true },
    /** Position on the homepage "From clients" row; 0 = not shown. */
    featuredOnHome: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const Testimonial = mongoose.model('Testimonial', testimonialSchema);
