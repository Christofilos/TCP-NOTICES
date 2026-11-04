# Setup: cloud storage and email reminders

Do these once. Everything happens in your Vercel and Resend dashboards. **Never paste a key or password into a chat, an email or a file in this project.** Type it only into the Vercel or Resend page.

## 1. Add the Redis database (Upstash) in Vercel

1. Open your project in the Vercel dashboard.
2. Click **Storage**, then **Create Database** (or **Marketplace**).
3. Choose **Upstash Redis** (the Redis option). Accept the free plan and pick the region closest to you.
4. When asked, **connect it to this project** and tick all environments (Production, Preview, Development).
5. Vercel adds the variables `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. You do not copy anything.

## 2. Add three settings in Vercel

Project, **Settings**, **Environment Variables**. Add each one for all environments:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | The API key from your Resend account (starts with `re_`) |
| `APP_PASSWORD` | A password you choose and share with your team. Make it long. |
| `CRON_SECRET` | A long random text (30 or more letters and numbers). Nobody needs to remember it. |

Optional, once you have a verified domain (step 4): `RESEND_FROM`, for example `TCP Notices <notices@yourcompany.com>`.

## 3. Redeploy

Settings only apply to new deployments. In Vercel, open **Deployments**, click the three dots on the latest one and choose **Redeploy**.

## 4. Verify a domain in Resend (needed to email other people)

Until you do this, Resend only delivers to the email address you registered with. Test emails to yourself work, reminders to colleagues do not.

1. In Resend, open **Domains** and **Add Domain** (use a domain or subdomain your company owns).
2. Resend shows DNS records. Add them where the domain is managed (your IT team can do this), then click **Verify**.
3. Set `RESEND_FROM` in Vercel (step 2) to an address on that domain, and redeploy.

## 5. Check it works

1. Open your site. At the bottom, open **Cloud storage and email reminders**.
2. Type the `APP_PASSWORD` and press **Connect**. Your data is saved online.
3. Type your own address and press **Send test email**. It should arrive within a minute.
4. Press **Preview today's reminders** to see what would be emailed today. **Send due reminders now** sends them for real.
5. The next morning (around 08:00 UK time) the daily job runs by itself. Press **Show sent emails** to see the result.

If something fails, the panel shows the reason (for example "Resend refused the email: domain not verified").

## What was tested and what was not

Tested automatically with stand-ins: reminder rules, the password and lock-out, data checking, saving and conflicts between devices, the page's panel, and retrying failed sends.

Not tested, because it cannot be reached from the build environment: real Upstash, real Resend delivery, and Vercel's real daily trigger. Steps 5.2 and 5.3 above are the real checks.
