import mongoose from 'mongoose';

export const SOCIAL_ICONS = ['instagram', 'youtube', 'linkedin', 'facebook', 'blog', 'x', 'tiktok', 'website'];

const socialSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 40 },
    url: { type: String, required: true, trim: true, maxlength: 500 },
    icon: { type: String, required: true, enum: SOCIAL_ICONS },
  },
  { _id: false },
);

/** Single document (key: 'site') holding site-wide details shown in the header, footer and contact page. */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'site', immutable: true },
    siteName: { type: String, trim: true, maxlength: 100, default: '' },
    email: { type: String, trim: true, maxlength: 254, default: '' },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    phone2: { type: String, trim: true, maxlength: 40, default: '' },
    socials: { type: [socialSchema], default: [] },
    footerText: { type: String, trim: true, maxlength: 500, default: '' },
    inquiryTitle: { type: String, trim: true, maxlength: 200, default: '' },
    inquiryText: { type: String, trim: true, maxlength: 500, default: '' },
    seoTitle: { type: String, trim: true, maxlength: 120, default: '' },
    seoDescription: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true },
);

export const Setting = mongoose.model('Setting', settingSchema);
