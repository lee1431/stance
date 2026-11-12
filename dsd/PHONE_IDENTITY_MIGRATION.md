# DSD authentication identity migration: phone number

## Desired behavior
- A normalized mobile phone number is the unique account identity.
- The same NAVER Cloud Client ID can be associated with multiple distinct phone numbers.
- The same phone number cannot silently create a second DSD account by providing another Client ID.
- All login attempts include phone number, password, and Client ID. Treat Client ID as a changeable map credential/configuration, NEVER as authentication.
- Changing Client ID for an existing phone should require successful authentication first; do not automatically overwrite credentials for an arbitrary existing account.
- Preserve current user IDs, delivery rounds, imported files, and sessions as far as possible.
- Do not expose the server-side NAVER Client Secret to browsers. Note that sharing a Client ID can also share API usage/quota.

## Required backend changes (not available in this repository)
1. Back up the DSD SQLite database, inspect actual users schema and live duplicates.
2. Normalize phone values to digits-only; detect and manually reconcile duplicate numbers before adding uniqueness. Verify number ownership separately for real-world deployment (SMS OTP or equivalent).
3. Replace UNIQUE(client_id) (if present) with UNIQUE(phone_normalized). SQLite commonly needs a table rebuild; do not guess the current migration schema.
4. Change POST /dsd/api/auth/enter: look up by normalized phone. For an existing phone, verify password then handle Client ID as an authenticated setting. For a new phone, create a new user even when the Client ID is already used by another account.
5. Change auth/me and all row-level authorization to rely on immutable user_id, NOT Client ID or phone string.
6. Test same Client ID/different phone, same phone/different Client ID, wrong password, formatting variants, old users/data, token refresh, and multi-device access.

## Frontend changes in this branch
- Phone required during both registration and sign-in.
- Phone normalized to digits before submission.
- UI explicitly explains that Client ID is not unique and can be shared.
- Frontend still posts {client_id, phone, password} to the existing endpoint, so a compatible server-side migration is mandatory before merging/deploying.

## Current limitation
The active Flask backend is hosted separately at localflow.ddns.net; its source and SQLite schema were not found in lee1431/stance. No live database or production API has been modified. Do not merge this branch until backend compatibility is verified.
