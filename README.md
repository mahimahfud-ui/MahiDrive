# MahiDrive

**MahiDrive** is a private, single-owner cloud file manager designed to present up to five separately authenticated Google Drive accounts through one interface.

## Project goals

- One owner account; no public registration, guest access, teams, or public sharing.
- Up to five independent Google Drive connections.
- One searchable file index across connected accounts, while every file remains stored in its original Google account.
- Live quota reporting from Google Drive, not a hard-coded 75 GB pool.
- Safe uploads, downloads, previews, account health checks, and recoverable operations.
- Server-side OAuth and encrypted refresh-token storage.

## Current repository status

- `MahiDrive.html` is the existing UI prototype and is intentionally preserved.
- The prototype itself states that it uses demo data and has no backend, sync, or OAuth. Its simulated uploads and account cards must not be treated as real cloud operations.
- The foundation configuration and architecture are being documented before connecting real services.

## Architecture direction

- Web application: Next.js + TypeScript (server-side routes for privileged operations).
- Identity and metadata: a **dedicated MahiDrive Supabase project**, separate from Mahi-Repair and MahiCloud databases.
- File bytes: the five independently connected Google Drive accounts.
- OAuth refresh tokens: encrypted server-side; never exposed to browser JavaScript.
- Database: owner-scoped records with Row Level Security (RLS).

## Important storage model

Five Google accounts do not become one native Google Drive quota. MahiDrive will aggregate their available capacity in its own interface and keep a permanent account reference for each file. The app must retrieve quota values from each account and calculate the total dynamically. A 5 × 15 GB figure is only an estimate, not a guaranteed quota.

## Security

**Do not commit credentials, OAuth tokens, service keys, encryption keys, or real account details.** Copy `.env.example` to a local environment file and configure deployment secrets through the hosting provider.

The repository is currently public. Change it to **Private** in GitHub repository Settings before adding any private implementation details or operational configuration.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration checklist](docs/CONFIGURATION.md)
- [Security baseline](docs/SECURITY.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [Five-account template](config/storage-accounts.example.json)

## Not production-ready yet

No Google account is connected, no Supabase database has been provisioned for MahiDrive, and no real upload, download, sync, or owner-auth flow has been verified. Do not store important files in the current prototype.
