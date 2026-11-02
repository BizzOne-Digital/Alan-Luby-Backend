import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema(
  {
    /** Also the photo category key and the #anchor on the Services page. */
    slug: { type: String, required: true, unique: true, trim: true, maxlength: 40, immutable: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    shortTitle: { type: String, required: true, trim: true, maxlength: 60 },
    categoryLabel: { type: String, required: true, trim: true, maxlength: 60 },
    /** Option shown in the contact form. */
    inquiryValue: { type: String, required: true, trim: true, maxlength: 100 },
    summary: { type: String, required: true, trim: true, maxlength: 1000 },
    whoFor: { type: String, trim: true, maxlength: 1000, default: '' },
    photographs: { type: [{ type: String, trim: true, maxlength: 200 }], default: [] },
    /** Photo slugs */
    image: { type: String, required: true, trim: true, maxlength: 80 },
    supporting: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
    testimonial: { type: mongoose.Schema.Types.ObjectId, ref: 'Testimonial', default: null },
    order: { type: Number, default: 0, index: true },
    visible: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Service = mongoose.model('Service', serviceSchema);
