# Deployment on Railway (after account connection and school approval)

Status: **deployment preparation only**. No Railway service or public URL has been created.

## Service settings

1. Connect repository `khalidoman12/saud-bin-azzan-school`, branch `feature/talent-identification-system`.
2. Set **Root Directory** to `/talent-system`. The Dockerfile and `railway.json` are in that directory. The main school's GitHub Pages website must remain unchanged.
3. Set service variable `TALENT_COOKIE_SECURE=true`, `TALENT_DB_PATH=/data/talent.sqlite3`, and `PORT=8088`.
4. Attach a **persistent Railway Volume** mounted at `/data`. Without this, all saved nominations and accounts may disappear after a deployment.
5. Railway's documentation says attached volumes are mounted as root. This Docker image runs as unprivileged UID 10001 by default, so Railway may require setting `RAILWAY_RUN_UID=0` to access its volume. This makes the app run as root **inside its isolated container**. Obtain a security review before using pupil data. A school-approved VPS with Docker Compose can retain the non-root configuration and is preferable if the institution requires this control.
6. Generate a Railway-provided HTTPS domain in the service Networking settings (do not manually point student data to a public GitHub Pages route).
7. After deployment, use an authenticated remote shell/CLI in the service to initialize the PINs and accounts. Do not pass secrets as command-line flags or in GitHub files:

```bash
python setup_pins.py
python manage_users.py add --username teacher01 --name "اسم المعلم" --scopes math
python manage_users.py add --username counselor01 --name "اسم الأخصائي" --scopes counseling --registry --reviewer
python manage_users.py add --username registry01 --name "اسم مسؤول السجل" --scopes resources --registry
```

8. Confirm authentication, session logout, teacher identity, privacy, review permissions, mobile layout, data permanence across redeployment, and backup/restore using **synthetic student data only**.
9. Keep rollout disabled for real student information until security, retention, consent/legal-basis and school governance approvals are complete.

## Production caveats

- Railway does not deploy Docker Compose files directly; use the application's Dockerfile. `compose.yaml` is for a school-managed VPS.
- SQLite requires one replica/process writing to the volume; do not scale horizontally while using this storage design.
- The deployment domain and hosting account must be created by the authenticated service owner, not invented.
- Backups require separate offsite encrypted storage and a recovery test, not just a copy inside `/data`.
- The 12 four-digit section PINs do not replace unique teacher accounts with strong passwords.
- The previously shared PINs should be rotated before production.
- Uploaded work samples are not included in this build; only private textual descriptions are supported.

Railway documentation:
- https://docs.railway.com/volumes
- https://docs.railway.com/guides/docker-compose
- https://docs.railway.com/services
