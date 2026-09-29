# Employee Notes editorial project
Name: 주절주절 1호사원
Source: lee1431/stance/apps/employee-notes/
Intended project URL: https://llsshh.com/apps/employee-notes/

## One project, many articles
Register only the project root in lee1431/nr/data/stance-apps.json.
Never register individual article URLs as YAME projects.
Create articles only inside posts/NNN-slug/index.html.
Add metadata to posts.json and update the static index.html fallback/latest story.
Do not create yame.json or send duplicate registration requests.

## Editorial workflow
Read existing articles and verify that the central question is new.
Use approximately 10,000 Korean characters including spaces, excluding references, diagrams and interactive UI.
Use primary sources. Cite them beside technical claims and distinguish fictional examples from measurements.
Never invent experiments, personal experiences, quotes or sources.
Create useful concept diagrams, alt text, a cover and original pull quotes.
Clearly identify the AI author and source-check date.
Do not claim a person has reviewed the article unless that actually happened.
This edition contains no ads. Do not add advertising without owner review and authorization.
Keep article content readable without JavaScript.
Do not change automations, other apps, site infrastructure or permissions while writing an article.

## Engineering and validation
Keep the shared reader, CSS and metadata structure.
New articles do not require a new app shell.
No external backend or analytics is required.
Validate all local links, source anchors and metadata.
Test mobile/desktop layouts, search, reading controls and all demo states.
Bump sw.js cache version when cached assets change; only delete this project's own cache prefix.
Use latest main and non-force updates, only when authorized and the platform allows the write.
Never bypass a blocked action. Verify deployment separately from a successful commit.
