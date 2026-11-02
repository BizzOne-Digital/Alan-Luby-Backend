# Alan Luby Photography — Backend API & CMS

Node.js + Express 5 + MongoDB Atlas (Mongoose) API for the Alan Luby Photography website. It stores all editable
site content, the contact-form inquiries and uploaded images (in MongoDB, not on disk), and authenticates the
site owner for the admin dashboard at `/admin` on the website.

The website itself is the existing React + Vite app in `../Alan-Luby-Photography`. It is deployed separately.

---

## 1. Architecture

```text
Browser ── https://yoursite.com ──► Vercel (React + Vite build)
   │                                   │  /api/*  (rewrite, recommended)
   └────── /api/* ─────────────────────┴──────────► This API (separate Vercel project, or any Node host)
                                                        │
                                                        ▼
                                                   MongoDB Atlas
```

```text
backend/
├── api/index.js               Vercel Function entry point (wraps the Express app)
├── vercel.json                Routes every request to that function
├── src/
│   ├── app.js                 Express app: security middleware, sessions, routes, errors
│   ├── server.js              Connects to MongoDB, listens, graceful shutdown
│   ├── config/                env.js (validated env), db.js (cached connection), session.js
│   ├── controllers/           auth, crud (shared list/get/create/update/delete), resources,
│   │                          content (settings, pages, site bundle, contact), uploads, dashboard
│   ├── middleware/            auth.js (session admin, CSRF), security.js (rate limits, operator
│   │                          key filter), error.js (central error handler)
│   ├── models/                Admin, Setting, Page, Photo, Service, Testimonial, Inquiry,
│   │                          StoredUpload, ActivityLog
│   ├── routes/index.js        All REST routes
│   ├── services/              uploads (signature checks, safe deletion), references, activity log
│   ├── validators/schemas.js  Zod request schemas (also strip unknown fields: no mass assignment)
│   └── utils/http.js          Errors, pagination helpers
├── scripts/
│   ├── seed.js                Creates the first admin and the starting content (idempotent)
│   └── seed-content.json      The site's original content (exported from the frontend's built-in data)
├── tests/                     Vitest + Supertest + MongoDB Memory Server
├── .env.example
└── package.json
```

### What the CMS manages (based on the actual website)

| Module | What the owner can edit | Where it appears |
|---|---|---|
| **Photos** | Upload/replace image, title, alt text, category, focus point, gallery order, homepage "Selected work" position, homepage photo-strip position, show/hide in Work | Work page, homepage, services, About |
| **Services** | Title, labels, summary, who it's for, bullet list, main + supporting photos, linked quote, order, visibility. Each service is also a Work-page category and a contact-form option | Homepage, Services page, Work filters, contact form, footer |
| **Testimonials** | Quote, verbatim excerpt (enforced), name/role, organization, location, Testimonials-page visibility & order, homepage position | Testimonials page, homepage, services |
| **Pages** (6 fixed pages) | Every heading and text block, hero photo, CTA texts/links, About portrait, SEO title & description, publish/unpublish (not the homepage), homepage section order & visibility | Each page |
| **Settings** | Business name, email, two phones, social links, footer text, closing-band text, default SEO | Header, footer, contact page, every page |
| **Inquiries** | Read, mark read/unread, search, filter, delete, reply by email | Stored from the contact form |
| **Activity log** | Read-only list of sign-ins (incl. failed) and every change | Admin |

Not built because the site has no such content: products, prices, team members, business hours, blog.

---

## 2. Local development

Requirements: Node.js 22.9+ (uses `--env-file-if-exists` and `--watch`, no dotenv/nodemon needed).

```bash
cd backend
npm install
cp .env.example .env        # then fill in MONGODB_URI, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed                # first admin + starting content
npm run dev                 # http://localhost:5000  (restarts on file changes)
```

Frontend (separate terminal):

```bash
cd ../Alan-Luby-Photography
echo VITE_API_URL=/api > .env.local     # dev server proxies /api to http://localhost:5000
npm run dev                             # http://localhost:3000, admin at http://localhost:3000/admin
```

`VITE_API_URL=http://localhost:5000/api` also works (cross-origin with CORS); `/api` mirrors production more closely.

### npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start with auto-restart, reading `.env` |
| `npm start` | Start for production |
| `npm test` | Run all tests (in-memory MongoDB, never touches `MONGODB_URI`) |
| `npm run seed` | Create the admin and starting content (safe to repeat) |
| `npm run seed -- --reset-admin-password` | Set the admin password to the current `ADMIN_PASSWORD` (account recovery) |

---

## 3. Environment variables

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `production` on the server (turns on secure cookies, hides error details) |
| `PORT` | no | Default `5000`. Most hosts set it for you |
| `MONGODB_URI` | yes | Atlas connection string including the database name |
| `SESSION_SECRET` | yes | ≥ 32 random characters. Signs session cookies. Changing it signs everyone out |
| `FRONTEND_URL` | yes | Website origin(s) allowed to call the API with cookies, comma-separated, no trailing slash |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seed only | First admin account. Password ≥ 12 characters. Can be removed after seeding |
| `COOKIE_SAMESITE` | no | `lax` (default, use with the `/api` rewrite) or `none` (API on another domain; requires HTTPS) |
| `TRUST_PROXY` | no | Proxies in front of the app, default `1` (needed for correct IPs, rate limits and secure cookies) |

Frontend (`Alan-Luby-Photography`): only `VITE_API_URL`. No secret is ever sent to or built into the frontend.

---

## 4. MongoDB Atlas setup

1. Create an account at <https://cloud.mongodb.com> → **Create** a cluster (the free M0 tier is enough to start).
2. **Database Access** → *Add New Database User* → password authentication, a long generated password, role
   **Read and write to any database** (or, stricter, a custom role with `readWrite` on just your database).
3. **Network Access** → *Add IP Address*: add your host's outbound IPs. Render, Railway and similar hosts often
   don't have fixed IPs on cheaper plans; in that case use `0.0.0.0/0` and rely on the strong database password
   (and upgrade to fixed egress IPs or Atlas private networking when available).
4. **Connect** → *Drivers* → copy the `mongodb+srv://` string, insert the user/password, and add the database name
   before the `?`, e.g. `.../alan-luby?retryWrites=true&w=majority`. That is your `MONGODB_URI`.

Collections created: `admins`, `sessions`, `settings`, `pages`, `photos`, `services`, `testimonials`,
`inquiries`, `storeduploads`, `activitylogs`. Indexes are built automatically on startup.

---

## 5. Deployment

Deploying the frontend to Vercel does **not** deploy this backend. Deploy it as its own service.

### 5.1 Deploy the API on Vercel (as its own project)

The repo includes `api/index.js` (the Vercel Function that wraps the Express app) and `vercel.json` (sends every
path to it). The MongoDB connection and app are created on the first request and reused while the instance is warm.

1. **Atlas network access:** Vercel Functions have no fixed outbound IPs, so allow `0.0.0.0/0` in Atlas → Network
   Access and rely on a strong database password (or use Vercel Secure Compute on Enterprise plans).
2. **Create the project.** Either:
   - Dashboard: push `backend` to Git → Vercel → **Add New → Project** → import it → *Root Directory* `backend`
     (if it's a subfolder) → Framework Preset **Other** → no build command needed; or
   - CLI, from the `backend` folder: `vercel login`, then `vercel link` (create a new project, e.g. `alan-luby-api`).
3. **Environment variables** (Project → Settings → Environment Variables, *Production*; or `vercel env add NAME production`):
   `NODE_ENV=production`, `MONGODB_URI`, `SESSION_SECRET` (generate with
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), `FRONTEND_URL=https://your-site.com`
   (comma-separate extra origins such as `https://www.your-site.com`).
4. **Deploy:** push to the production branch, or `vercel deploy --prod`.
5. **Check:** `https://alan-luby-api.vercel.app/api/health` → `{"success":true,"status":"ok","database":"connected"}`.

**Upload size on Vercel.** Vercel rejects request bodies over 4.5 MB. The admin therefore resizes images in the
browser before uploading (max 2560px on the long side, re-encoded until under 4 MB; GIFs are never converted, so an
animated GIF must be under 4 MB). The API itself still enforces the 8 MB limit and every file check.

**Rate limits on Vercel.** The per-IP limits (sign-in, contact form, global) are counted in memory per function
instance, so on Vercel they are best-effort. The per-account sign-in lockout is stored in MongoDB and applies fully.

Any other Node host (Render, Railway, Fly) also works: build `npm ci`, start `npm start`, health check `/api/health`,
same environment variables.

### 5.2 Run the seed once, securely

From your own computer, pointing at production (nothing is stored in the repo):

```bash
cd backend
MONGODB_URI="mongodb+srv://..." ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a long unique password" npm run seed
```

(On Windows PowerShell set them with `$env:MONGODB_URI="..."` first.) Or use the host's one-off shell. The seed never
overwrites content that already exists, so re-running it is harmless.

### 5.3 Connect the website (recommended: same-origin rewrite)

In `Alan-Luby-Photography/vercel.json`, add the API rewrite **before** the existing catch-all:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://alan-luby-api.vercel.app/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Then in Vercel → Project → Settings → Environment Variables set `VITE_API_URL=/api` and redeploy (Vite bakes it
in at build time). With the rewrite the browser only ever talks to your own domain, so the session cookie is
first-party (`SameSite=Lax`) and Safari/Chrome third-party cookie blocking cannot break the admin login.
Keep `FRONTEND_URL` set to the site's origin. After deploying, sign in once and open the Activity log: the IP shown
should be your own. If it is a Vercel address instead, set `TRUST_PROXY=2` on the API project and redeploy.

**Alternative (direct cross-domain):** `VITE_API_URL=https://alan-luby-api.vercel.app/api` on the frontend and
`COOKIE_SAMESITE=none` on the backend. This works, but browsers that block third-party cookies (Safari by default)
will not keep the admin signed in. Two `*.vercel.app` addresses count as different sites, so this mode always needs third-party cookies. Prefer the rewrite, or a custom subdomain (`api.your-site.com`), which keeps cookies same-site.

### 5.4 Verify after deployment

1. Visit `https://your-site.com` → content loads (Network tab shows `/api/site` 200).
2. Visit `/admin` → sign in with the seeded account → dashboard shows real counts.
3. Photos → Add photo → upload a JPEG → save → it appears on `/work`; open the image URL
   (`/api/uploads/gallery/...`) directly → it loads with `Cache-Control: public, max-age=31536000, immutable`.
4. Send the contact form on `/contact` → it appears under Inquiries.
5. Sign out → `/admin/dashboard` redirects to the sign-in page.

---

## 6. API reference

All responses are JSON: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "message", "details"? } }`.
List endpoints accept `page`, `limit` (≤ 100), `q` (search), `sort` (`field` or `-field`) and return `pagination`.
🔒 = signed-in admin + `X-CSRF-Token` header on writes.

| Method & path | Access | Notes |
|---|---|---|
| `GET /api/health` | public | Liveness + database status |
| `GET /api/auth/csrf` | public | Returns `{ csrfToken }` for the sign-in form |
| `POST /api/auth/login` | public + CSRF | `{ email, password }` → `{ admin, csrfToken }`, sets `alp.sid` cookie |
| `POST /api/auth/logout` | CSRF | Destroys the session |
| `GET /api/auth/me` | 🔒 | Current admin + fresh CSRF token |
| `GET /api/site` | public | Everything the public site renders, in one request (published/visible only) |
| `GET /api/settings` · `PUT /api/settings` | public · 🔒 | Site settings |
| `GET /api/pages` · `GET /api/pages/:key` · `PUT /api/pages/:key` | public (published only) · 🔒 | `key` ∈ home, about, services, work, testimonials, contact |
| `GET /api/photos` · `GET /api/photos/:id` | public | Filters: `category`, `showInWork`, `placement=featured\|marquee` |
| `POST /api/photos` · `PATCH /api/photos/:id` · `DELETE /api/photos/:id` | 🔒 | Delete blocked (409) while a service/page uses the photo; removes its upload |
| `GET /api/services[/:id]` | public (visible only) | Admin sees hidden ones too |
| `POST/PATCH/DELETE /api/services[/:id]` | 🔒 | `slug` is set on create only; delete blocked while photos use the category |
| `GET /api/testimonials[/:id]` | public (displayed only) | Filter: `showOnPage` |
| `POST/PATCH/DELETE /api/testimonials[/:id]` | 🔒 | Excerpt must be verbatim; delete blocked while referenced |
| `POST /api/contact` | public, rate limited | Contact form. Honeypot field `website` |
| `GET /api/contact[/:id]` · `PATCH /api/contact/:id` · `DELETE /api/contact/:id` | 🔒 | Filters: `read`, `service`; PATCH accepts only `{ read }` |
| `POST /api/upload` | 🔒 | multipart: `file`, `folder` ∈ gallery, pages, misc → `{ success, url, filename, size, folder }` |
| `GET /api/uploads/:folder/:filename` | public | Image bytes from MongoDB, immutable caching |
| `DELETE /api/uploads/:folder/:filename` | 🔒 | Only if no content uses it (409 otherwise) |
| `GET /api/dashboard/stats` | 🔒 | Real counts, recent activity, recent inquiries |
| `GET /api/activity` | 🔒 | Activity log, filter `entity`, search `q` |

---

## 7. Image uploads (stored in MongoDB)

- Upload: `multer` memory storage only (no disk), max **8 MB** (well under MongoDB's 16 MB document limit; on Vercel
  the admin first resizes images to fit Vercel's 4.5 MB request limit),
  one file per request.
- Checks, in order: admin session → CSRF → folder whitelist (`gallery`, `pages`, `misc`) → declared MIME type
  (PNG/JPEG/WebP/GIF; SVG is refused because it can carry script) → extension matches the type → **real file
  signature** (magic bytes) matches the declared type.
- Stored as `StoredUpload { folder, filename, mimeType, size, data: Buffer }` with a unique `(folder, filename)`
  index. Filenames are generated: `${Date.now()}-${16 hex}.${ext}`; requests for anything else are rejected,
  so path traversal is impossible.
- Served with `Content-Type`, `Content-Length`, `Cache-Control: public, max-age=31536000, immutable`,
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'`.
- Content documents store only the URL string. When a photo's image is replaced or the photo is deleted, or an
  image is removed from a page, the old upload is deleted **unless other content still uses it**. Uploads made in
  a form but never saved are deleted when the form is left. URLs outside `/api/uploads/` (the site's original
  `/images/...` files, external URLs) are never touched.
- The frontend resolves `/api/uploads/...` against the API origin when it is on another domain; legacy
  `/uploads/...` URLs render a neutral placeholder.

Storage note: images live in your Atlas database, so they count toward its storage quota (512 MB on the free tier,
roughly 200–500 web-sized photos). Upload web-sized exports (≈ 2000 px, 300–800 KB), not camera originals.

---

## 8. Security measures

- **Authentication:** bcrypt (cost 12) password hashes; no public registration (accounts only via the seed script);
  constant-time-ish response for unknown emails (dummy hash comparison); generic error messages.
- **Brute force:** per-IP limit of 10 failed sign-ins / 15 min; per-account lockout after 5 consecutive failures
  (15 min, doubling with each further failure, max 24 h); failed attempts are recorded in the activity log.
- **Sessions:** server-side sessions in MongoDB (`connect-mongo`), cookie `alp.sid` is `HttpOnly`, `Secure` in
  production, `SameSite=Lax` (configurable); 8 h idle timeout renewed on activity, 24 h absolute maximum;
  session id regenerated at sign-in (no fixation); admin re-loaded from the database on every request (a deleted
  admin is signed out immediately). Nothing is stored in `localStorage`.
- **CSRF:** synchronizer token per session, required in `X-CSRF-Token` on every state-changing admin request and on
  sign-in/sign-out, compared in constant time.
- **Authorization:** every write route is behind `requireAdmin`; public reads only see published/visible content;
  inquiries, activity and stats are admin-only.
- **Input:** Zod validation on every write (types, lengths, formats; unknown fields stripped → no mass assignment);
  request bodies with `$`/dotted keys rejected; Express 5's simple query parser (no nested query objects); ids
  validated before use; search terms regex-escaped; links restricted to `http(s)` (no `javascript:` URLs).
- **XSS:** content is stored as plain text and rendered by React, which escapes it; no `dangerouslySetInnerHTML`.
- **Headers & transport:** Helmet (HSTS, nosniff, frame protection, etc.), CORS limited to `FRONTEND_URL` with
  credentials, `x-powered-by` off, JSON body limit 100 KB, global rate limit 300 req/min per IP, contact form 5 per
  10 min per IP plus a honeypot.
- **Errors:** central handler; no stack traces or database errors in production responses; 5xx are logged server-side.
- **Secrets:** only in environment variables; `.env` files are git-ignored; nothing secret is exposed to the frontend.
- **Activity log:** sign-ins (success and failure), sign-outs, every create/update/delete, uploads and settings
  changes, with admin email, time and IP. Passwords, cookies and session ids are never logged.

---

## 9. Tests

```bash
npm test
```

102 tests across 6 files run against a throwaway in-memory MongoDB (downloaded automatically on first run):
authentication (login, wrong/missing credentials, CSRF, session fixation, lockout, rate limit, forged cookies,
logout), CRUD for every module (pagination, search, filters, invalid ids, validation, reference protection,
mass assignment), uploads (each image type, bad MIME, bad signature, wrong extension, > 8 MB, bad folders, no auth,
no CSRF, retrieval headers, 404, path traversal, deletion rules), security (every protected route returns 401, NoSQL
injection, operator keys, malformed/oversized bodies, public/private separation, headers, CORS) and the seed script
(idempotency, never overwriting edits, password reset), plus the Vercel entry point.

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits with "Invalid environment" | Set `MONGODB_URI` and a `SESSION_SECRET` of at least 32 characters |
| `MongoServerSelectionError` / timeouts | Atlas Network Access doesn't include your host's IP; or wrong user/password in the URI |
| Admin login works, then immediately asks to sign in again | Cookie not kept: use the `/api` rewrite (5.3). Cross-domain needs `COOKIE_SAMESITE=none`, HTTPS, and a browser that allows third-party cookies |
| "Invalid or missing security token" | Page open for a long time or session ended: refresh and sign in again |
| CORS error in the browser console | `FRONTEND_URL` must exactly match the site origin (scheme, host, port; no trailing slash) |
| "Too many sign-in attempts" / account locked | Wait for the lock to expire, or run `npm run seed -- --reset-admin-password` (also clears the lock) |
| Upload fails with 413 | The chosen file is over 8 MB, or an animated GIF is over 4 MB (Vercel's 4.5 MB request limit) |
| `500` on every request right after deploying to Vercel | Missing/invalid env vars: open the deployment's Function logs; "Invalid environment" lists what to fix |
| Website shows the original content after edits | The site uses a cached copy first and refreshes in the background; reload once more. If `/api/site` fails in the Network tab, check `VITE_API_URL` and the rewrite |
| Admin page says "not connected" | The frontend was built without `VITE_API_URL`; set it in Vercel and redeploy |
| Tests hang on first run | MongoDB Memory Server is downloading its binary (~100 MB); allow network access once |
