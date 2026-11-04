# Setup

Do these once. Everything happens in your Vercel and Resend dashboards. **Never paste a key or password into a chat, an email or a file in this project.** Type it only into the Vercel or Resend page.

If you already set up the old version (Redis, `APP_PASSWORD`, `CRON_SECRET`, `RESEND_API_KEY`), steps 1 and 2 are already done: the new version uses the same settings and the same saved data.

## 1. Add the Redis database (Upstash) in Vercel

1. Open your project in the Vercel dashboard.
2. Click **Storage**, then **Create Database** (or **Marketplace**).
3. Choose **Upstash Redis**. Accept the free plan and pick the region closest to you.
4. When asked, **connect it to this project** and tick all environments (Production, Preview, Development).
5. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. You do not copy anything.

## 2. Add the settings in Vercel

Project, **Settings**, **Environment Variables**. Add each one for all environments:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | The API key from your Resend account (starts with `re_`) |
| `APP_PASSWORD` | A password you choose and share with your team. Make it long. |
| `CRON_SECRET` | A long random text (30 or more letters and numbers). Nobody needs to remember it. |

Optional, once you have a verified domain (step 5): `RESEND_FROM`, for example `TCP Notices <notices@yourcompany.com>`.

## 3. Tell Vercel this is now a Next.js app

The old version was plain files. The new one is built by Vercel.

1. Project, **Settings**, **Build and Deployment** (or **General**).
2. Set **Framework Preset** to **Next.js**. Leave the build command, output directory and install command on their defaults (switch off any overrides you set for the old version).
3. Set **Node.js Version** to 20 or later.

`vercel.json` also says `"framework": "nextjs"`, so new deployments use Next.js even if you miss this step, but it is clearer to set it.

## 4. Try it on a preview before it goes live

The rewrite is on the branch `nextjs-rewrite`. Vercel builds every branch you push as a **preview** with its own address, using the Preview settings from step 2.

1. In Vercel, open **Deployments** and find the one for `nextjs-rewrite`. If its build failed, open it and copy the error into a chat with your developer or Claude.
2. Open its address, type the team password, and check your contracts and notices are there.
3. On a computer where you used the old version, the page offers to **import** what that browser still holds. Press **Import into team data** if anything is missing.
4. When you are happy, merge `nextjs-rewrite` into `main` on GitHub. Pushing to `main` deploys it to your real address.

Previews share the same database as the live site, so changes you make on the preview are real.

## 5. Verify a domain in Resend (needed to email other people)

Until you do this, Resend only delivers to the email address you registered with. Test emails to yourself work, reminders to colleagues do not.

1. In Resend, open **Domains** and **Add Domain** (use a domain or subdomain your company owns).
2. Resend shows DNS records. Add them where the domain is managed (your IT team can do this), then click **Verify**.
3. Set `RESEND_FROM` in Vercel (step 2) to an address on that domain, and redeploy.

## 6. Check it works

1. Open your site and sign in with the `APP_PASSWORD`.
2. Add a contract. The line under the title should say *All changes saved*. Open the site on another device or browser: the contract is there.
3. At the bottom, open **Email reminders**, type your own address and press **Send test email**. It should arrive within a minute.
4. Press **Preview today's reminders** to see what would be emailed today. **Send due reminders now** sends them for real.
5. The next morning (around 08:00 UK time) the daily job runs by itself. Press **Show sent emails** to see the result.

If something fails, the page shows the reason (for example "Resend refused the email: domain not verified").

The daily job only runs on the live (production) deployment, not on previews.

## What was tested and what was not

Tested automatically, with stand-ins for the database and Resend: reminder rules, the password and lock-out, data checking, saving, conflicts between devices, failed saves, importing old browser data, the email panel, retrying failed sends, and phone width.

Not tested, because they could not be reached from the environment where the rewrite was built: the Next.js build itself (`next build`), real Upstash, real Resend delivery, and Vercel's real daily trigger. Steps 4 and 6 above are the real checks.
