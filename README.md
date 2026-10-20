# AI-Powered Object Recolor Demo

AI Recolor is a Vite and vanilla JavaScript web app that lets users upload a photo and recolor specific detected objects in it, using the Cloudinary Upload Widget, an unsigned `upload_preset`, AI Content Analysis object detection, Amazon Rekognition AI Moderation (`aws_rek`), and the `gen_recolor` generative AI transformation delivered with `f_auto` and `q_auto`.

## Cloudinary features used

- `gen_recolor`: recolors a specific detected object (for example, a shirt) without affecting the rest of the image. The app builds `e_gen_recolor:prompt_(sofa;lamp);to-color_2563EB;multiple_true` from the color picker and object selection.
  - `prompt_(…)`: the objects to recolor, separated by `;`
  - `to-color_<hex>`: the target color as a 6-digit hex value, without `#`
  - `multiple_true`: recolors every matching instance instead of only the most prominent one
- `f_auto`: automatically serves WebP or AVIF based on the visitor's browser
- `q_auto`: picks the lowest file size that keeps visual quality, so the recolored image loads quickly
- Upload Widget (`cloudinary.createUploadWidget`): a hosted upload UI for local files, URLs, and the camera, with client-side format and size checks
- `upload_preset` (unsigned): lets the browser upload without exposing your API secret, and applies detection and moderation to every upload
- `detection` (Cloudinary AI Content Analysis add-on): runs object detection at upload time and returns tags such as `sofa` or `lamp`, which become the selectable objects
- `moderation: aws_rek` (Amazon Rekognition AI Moderation add-on): rejects inappropriate images before any generative transformation runs
- `X-Cld-Error` response header: shows Cloudinary's own error message in the UI when a transformation fails

## Use cases

- **E-commerce color variants:** show a product such as a sneaker, chair, or jacket in every available colorway from a single photo shoot.
- **Interior design previews:** let shoppers or clients see a sofa, wall, or cabinet in a new color before they buy or paint.
- **User-generated content tools:** give users a quick creative editing feature without building or hosting your own AI image pipeline.

## Tech stack

- [Node.js](https://nodejs.org/) 22 LTS (20.19 or later also works) with npm 10 or later, used only for the dev server and build
- [Vite](https://vite.dev/) 7: dev server and static build
- [Tailwind CSS](https://tailwindcss.com/) 4, through `@tailwindcss/vite`
- Vanilla JavaScript ES modules, with no UI framework
- [Cloudinary Upload Widget](https://cloudinary.com/documentation/upload_widget), loaded from `https://upload-widget.cloudinary.com/latest/global/all.js`

## Cloudinary account setup

1. [Sign up](https://cloudinary.com/users/register_free) for a free Cloudinary account.
2. In the Console, go to **Settings → Add-ons** and register for both:
   - [Cloudinary AI Content Analysis](https://cloudinary.com/documentation/cloudinary_ai_content_analysis_addon) (object detection)
   - [Amazon Rekognition AI Moderation](https://cloudinary.com/documentation/aws_rekognition_ai_moderation_addon)
3. Go to **Settings → Upload → Upload presets** and select **Add upload preset**. Then:
   - Set **Preset name** to `docs_gen_ai_color_demo` (or any name you like).
   - Set **Signing mode** to **Unsigned**.
   - Under **Add-ons** (or **Analyze**, depending on your Console version), set **Detection** to `unidet` (or another object detection model, such as `lvis` or `openimages`).
   - Set **Moderation** to `aws_rek`.
   - Select **Save**.
4. Copy your **cloud name** from the Console dashboard (**Product Environment**).

## Environment variables

Create a `.env` file in the project root by copying the example:

```sh
cp .env.example .env
```

Then fill in the values:

```
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=docs_gen_ai_color_demo
```

- `VITE_CLOUDINARY_CLOUD_NAME`: your Cloudinary cloud name. The app uses it to configure the Upload Widget and to build `https://res.cloudinary.com/<cloud_name>/image/upload/...` delivery URLs.
- `VITE_CLOUDINARY_UPLOAD_PRESET`: the name of the unsigned upload preset from step 3 above.

> **Note:** Vite exposes only variables that start with `VITE_` to browser code, and it writes them into the bundle at build time. Both values are safe to make public. Never add `CLOUDINARY_API_SECRET` to this app.

If either variable is missing, the app shows a configuration error and disables the upload button.

## Running the app

1. **Clone the repository:**
   ```sh
   git clone https://github.com/cloudinary-devs/recolor_demo.git
   cd recolor_demo
   ```
2. **Use Node.js 22** (optional, if you use nvm):
   ```sh
   nvm use
   ```
3. **Install dependencies:**
   ```sh
   npm install
   ```
4. **Set up your `.env` file** as described above.
5. **Start the development server:**
   ```sh
   npm run dev
   ```
6. **Open your browser** at the URL shown in the terminal (usually [http://localhost:5173](http://localhost:5173)).

To build for production and preview the build:

```sh
npm run build
npm run preview
```

The production build is written to `dist/` as static files.

## How it works

1. **Upload:** the Upload Widget sends the image to Cloudinary with your unsigned preset. The preset runs object detection and moderation during the upload.
2. **Moderation:** if `info.moderation[0].status` is anything other than `approved`, the image is rejected.
3. **Object selection:** the app reads tags from `info.info.detection.object_detection.data.<model>.tags`, leaves out people-related tags (for example `person` or `human-face`), and shows up to 12 as selectable chips. You can also type your own object description, which the app cleans up first: it removes characters that `gen_recolor` uses as syntax, such as `( ) ; / , :`.
4. **Color picker:** choose a preset swatch, use the native color picker, or type a hex value. The **Transformation** box shows the exact `e_gen_recolor` parameter as you change your choices.
5. **Recolor:** the app builds the delivery URL:
   ```
   https://res.cloudinary.com/<cloud_name>/image/upload/e_gen_recolor:prompt_(sofa;coffee%20table);to-color_2563EB;multiple_true/f_auto/q_auto/v<version>/<public_id>.<format>
   ```
6. **Processing state:** Cloudinary generates the image on the first request, which can take several seconds or more. The app fetches the URL with `fetch()` and shows a spinner, an elapsed-time counter, and a **Cancel** button over the result frame. If Cloudinary responds with `423` (still generating) or a `5xx` error, the app retries up to 6 times with exponential backoff (2s, 4s, 8s, and so on). Starting a new recolor cancels the request already in progress, so a slow earlier result never replaces a newer one. If the request fails, the frame shows the `X-Cld-Error` message and a **Try again** button.
7. **Layout:** both image frames take the uploaded image's aspect ratio, and the loading overlay sits on top of the image, so the original and recolored images stay aligned and the page doesn't jump while processing.

The URL-building code is in `src/recolor.js`, and the UI and request handling are in `src/main.js`.

## Production checklist

Set these environment variables on your static host (for example Netlify, Vercel, or Cloudflare Pages) **before** you build, because Vite writes them into the bundle at build time:

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_CLOUDINARY_CLOUD_NAME` | Yes | Same as local. |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Yes | Must be an **unsigned** preset with detection and `aws_rek` moderation enabled. |

| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node.js version | `22` (from `.nvmrc`) |

Start a **new deploy** after you change any variable.

### Smoke test after deploy

1. Open the production URL and upload a JPG that contains several objects, such as a living room photo.
2. Select one object, pick a color, and select **Recolor**.
3. Confirm that the spinner appears and the recolored image loads. Expand **Transformation URL** and check that it contains `e_gen_recolor` and `f_auto`.
4. If the upload widget shows an "Upload preset not found" error, check that the preset name matches exactly and that the preset is unsigned.

### Cost note

Each new combination of image, prompt, and color creates a new generative AI derived asset, which uses more of your Cloudinary plan's transformation quota than a standard transformation. Requesting the same URL again serves the cached result. To limit abuse on a public deployment, add a **Max file size** limit and restrict **Allowed formats** in the upload preset.

