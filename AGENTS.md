# STANCE Agent Instructions

## Purpose

This repository is the source for the functional web apps served from https://llsshh.com/.

- Repository: lee1431/stance
- Default branch: main
- Production domain: https://llsshh.com/
- Deployment: GitHub Pages via .github/workflows/static.yml on pushes to main
- YAME.STORE catalog repository: lee1431/nr
- YAME.STORE domain: https://yame.store/

## Working rules

1. Inspect the relevant existing files before editing.
2. Preserve existing behavior and visual conventions unless the request explicitly changes them.
3. Prefer small, single-purpose static web apps.
4. Prefer vanilla HTML, CSS, and JavaScript unless the existing app already uses something else.
5. Avoid adding a backend unless it is actually required.
6. Do not invent file paths, API endpoints, credentials, publisher IDs, or deployment behavior. Verify them from the repository first.
7. Avoid unrelated refactors while completing a focused request.
8. Before creating a new app, inspect existing apps/pages to avoid duplicates.
9. Use relative asset paths that work on GitHub Pages and the custom domain.
10. Never commit passwords, API keys, tokens, SSH private keys, or other secrets.

## New app convention

New standalone apps should normally live under:

apps/<slug>/

Keep each app self-contained where practical. A typical app may include:

- index.html
- thumbnail image
- yame.json when the app should be registered to YAME.STORE

Do not move older root-level pages only for consistency.

## AdSense

llsshh.com is the AdSense-serving domain for this repository.

When a page should include AdSense:
- inspect an existing production page in this repository;
- reuse the existing AdSense client/script exactly;
- do not invent or replace the publisher ID.

## YAME.STORE registration

YAME.STORE is a separate project:
- lee1431/stance = apps and llsshh.com
- lee1431/nr = YAME.STORE and yame.store

This repository already contains .github/workflows/yame-register.yml.
Changes to apps/**/yame.json can trigger the YAME.STORE registration workflow.

Before creating or editing yame.json:
- inspect the existing workflow and existing yame.json examples;
- use the final llsshh.com URL;
- use a valid thumbnail URL;
- do not guess the registration API.

If the user's request explicitly requires a corresponding change in lee1431/nr, inspect that repository and make the smallest required update there as a separate repository change.

## Git and deployment

The default production flow is:

1. inspect;
2. edit;
3. review changed content;
4. commit to main when the user requested deployment;
5. verify the GitHub Actions Pages run;
6. verify the production URL when possible.

A push to main triggers .github/workflows/static.yml and deploys the repository to GitHub Pages.

Do not claim deployment succeeded only because a commit succeeded. Check the workflow run or production URL when the available tools allow it.

## External services

For any call to an external API or private server:
- read the current repository code/configuration first;
- use only confirmed endpoints and methods;
- do not guess alternate paths after an error unless asked to investigate;
- never expose credentials in source or chat output.
