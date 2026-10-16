# Deploy SocialBoost Hub online

## Before you start
The project uses Node.js, Express, and SQLite. Do not upload `.env` or the `data/` database publicly. The included admin credentials are configured with environment variables.

## Easiest path: deploy on a Node.js host
Use a host that supports Node.js web services and persistent storage. Free plans and their rules change, so check the host's current pricing, sleep limits, and persistent-disk support before choosing.

1. Download and extract `socialboost_hub_fullstack.zip` on a computer.
2. Create a private Git repository and upload the project files. Do not upload `.env`, `node_modules/`, or the database.
3. On your chosen Node.js hosting provider, create a new web service connected to that repository.
4. Set build/install command to `npm install`.
5. Set start command to `npm start`.
6. Add environment variables:
   - `NODE_ENV` = `production`
   - `SESSION_SECRET` = a long, unique random value
   - `ADMIN_EMAIL` = your own admin email
   - `ADMIN_PASSWORD` = a strong unique password of at least 10 characters
   - `PORT` is usually provided automatically by the host; leave it unset unless the host instructs otherwise.
7. Configure a persistent disk/volume and mount it at the project's `data` directory, if the host requires this for SQLite persistence. If the host does not support persistent storage, use a managed persistent database and update the code before launch.
8. Deploy, then open the HTTPS URL provided by the host.
9. Register a normal member account and test task completion.
10. Sign in with the configured admin email/password and test the Admin tab.
11. Confirm the data remains after a redeploy/restart before inviting users.

## Android-only note
You can download and inspect the project on Android, but deploying a Node.js app and managing environment variables is usually much easier from a computer. You can use a browser-based Git host and cloud dashboard from your phone, but expect more steps.

## Security checklist before real users
- Change the default admin credentials and session secret.
- Use HTTPS only.
- Configure persistent session storage instead of Express's in-memory session store.
- Add rate limiting, CSRF protection, email verification, password recovery, logging, backups, and a privacy policy.
- Review the reward/withdrawal rules and local legal requirements.
- Reward requests are only queued for manual review. The app does not send cash, mobile data, or vouchers automatically.
- Never collect users' TikTok, YouTube, Facebook, or Instagram passwords.
- Points and rewards should be transparent, and social tasks must not require fake engagement.
