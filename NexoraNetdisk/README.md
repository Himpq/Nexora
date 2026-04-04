# WNetdisk (Flask v1)

This is the first migration version of WNetdisk backend from the old PyWebServer runtime to Flask.

## Features in v1

- Session auth (`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`)
- Federated auth exchange (`/api/auth/federated/exchange`)
- Core file APIs:
  - `GET /api/files/list`
  - `POST /api/files/upload`
  - `GET /api/files/download`
  - `POST /api/files/mkdir`
  - `POST|DELETE /api/files/delete`
  - `POST /api/files/rename`
  - `POST /api/files/move`
- Admin user APIs:
  - `GET /api/admin/users`
  - `POST /api/admin/users`
  - `PATCH /api/admin/users/<username>/password`
  - `PATCH /api/admin/users/<username>/role`
  - `DELETE /api/admin/users/<username>`
- Legacy compatibility routes:
  - `/api/getlistdir.py`
  - `/api/createDir.py`
  - `/api/deleteFile.py`
  - `/api/rename.py`
  - `/api/moveFile.py`
  - `/api/updatefile.py`
  - `/api/download.py`
  - `/api/manageuser.py`
  - `/api/getdetail.py`
  - `/api/getfilequickview.py`
  - `/api/getmusiccover.py`
  - `/api/createdir.py`
- Nexora integration APIs (API key protected):
  - `GET /api/integration/health`
  - `POST /api/integration/files/list`
  - `POST /api/integration/files/mkdir`
  - `POST /api/integration/files/delete`
  - `POST /api/integration/files/rename`
  - `POST /api/integration/files/move`
  - `POST /api/integration/files/upload_text`
- Legacy frontend hosting:
  - `GET /ui/` (old frontend)
  - `GET /ui/*` (static files)
  - `ANY /ui/api/*` (proxy to `/api/*`)

## Start

```bash
cd WNetdisk
pip install -r requirements.txt
python app.py
```

Default service URL: `http://127.0.0.1:8099`
Legacy frontend URL: `http://127.0.0.1:8099/ui/`

## Default admin

Configured by `config.json`:

- username: `admin`
- password: `admin123`

Change it before production.

## Storage layout

Configured in `config.json`:

- user files: `paths.storage_root/<username>/`
- user meta: `paths.users_root/<username>.json`
- trash: `paths.trash_root/<username>/`

## Notes

- This version keeps plaintext password storage for migration compatibility with old WNetdisk behavior.
- Next version should migrate to hashed passwords and support federated auth tokens for Nexora SSO.

## Federation signature

`POST /api/auth/federated/exchange` expects:

```json
{
  "username": "alice",
  "role": "normal",
  "external_token": "opaque-token",
  "timestamp": 1739940000,
  "signature": "hex-hmac-sha256"
}
```

Signature text:

`username|role|timestamp|external_token`

HMAC key:

`config.json -> federated_auth.shared_secret`
