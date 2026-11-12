# Project state: Folio → viewitpretty

Updated 2026-11-12. This document tracks the public identity and next work; [README verification](../README.md#verification) and the dated technical reports retain their own acceptance evidence.

## Current state

- **Website:** [viewitpretty.com](https://viewitpretty.com).
- **Source:** [cgcormier/pdf-reader](https://github.com/cgcormier/pdf-reader), default branch `main`.
- **Product implementation:** Folio, a local PDF reading room with a Vite browser build and optional Electron desktop app. The website returned HTTP 200 and its HTML still displayed Folio in the title and wordmark when checked on 2026-11-12. This HTTP/content check does not certify every interactive feature or identify the deployed commit.
- **Repository snapshot reviewed:** `9ba3bbe` (merge of PR #28). The HTML title, web app manifest, launcher instructions and desktop names still use Folio. Source deployment configuration keeps production routes in the Cloudflare dashboard; a domain cannot be inferred from that configuration alone.
- **GitHub presentation:** the repository currently has no About description, homepage URL or topic tags. The README now supplies the website and a quick path for developers and reviewers; the external settings have not been changed.
- **License:** PolyForm Noncommercial 1.0.0. This is source-available software, not open source. Preserve that distinction in the website, repository and portfolio descriptions.

## Priority next step

**Transition the product identity from Folio to viewitpretty.** Make the website, repository presentation and application identity tell one coherent story, without breaking existing reading data or overstating what has shipped.

### Decision evidence still required: the three explored options

Carter has already explored three transition options in another discussion. That discussion has not been recovered from the available history. **Recover those exact options, then record each option's benefits, costs, compatibility risks and source reference before selecting an approach.** No substitute options or speculative pros/cons are recorded here.

A link or excerpt from the original discussion will unblock this comparison. Website linking, application branding, repository renaming and saved-data migration are separate implementation concerns; none is asserted to be one of Carter's three options.

### Transition acceptance checklist

- [ ] Recover and compare the three original options, preserving their intended scope and rationale.
- [ ] Update public-facing product copy, HTML title, accessible labels, manifest name, icons and social-preview metadata consistently once the approach is selected.
- [ ] Decide separately whether to rename the GitHub repository. If renamed, update remotes and links, preserve redirects, and check deployment integrations. Do not assume a repository rename configures the website.
- [ ] Preserve or explicitly migrate saved data. Keep current Folio launchers, executable names, desktop profile path, protocol and storage identifiers working until replacement behavior is implemented and verified.
- [ ] Verify the complete production asset build, first-load and offline behavior, PDF import, bookmarks and reading-position restoration after the transition. Record the exact deployed commit and distinguish source checks from live-site checks.

Browser storage is separated by origin. Moving between localhost, another hostname and viewitpretty.com does not automatically transfer an IndexedDB shelf or localStorage preferences. A redirect alone is not a data migration; keep original PDFs separately as a backup.

## Website ↔ GitHub and reviewer presentation

These are follow-up tasks, not settings changes made by this documentation update.

- [x] Place a direct website link near the README opening, alongside the source and project-state links.
- [x] Give reviewers an immediate route to the sample, core capabilities, local setup, checks, architecture and accurate license terms.
- [ ] Set the GitHub About website to `https://viewitpretty.com`, add a concise factual description, and choose accurate topics such as `pdf-reader`, `pdfjs`, `javascript`, `vite`, and `electron`.
- [ ] Add a discreet, visible **Source on GitHub** link on the website pointing to `https://github.com/cgcormier/pdf-reader`. Keep it current if the repository is renamed. This is navigation, not an integration or an invitation to grant repository access.
- [ ] Add a current screenshot or short demonstration showing the actual reader. Keep setup and test commands reproducible; label historical results with their dates rather than presenting them as fresh checks.
- [ ] Consider pinning the repository on Carter's GitHub profile so hiring reviewers can find it quickly.

Keep the README introduction short and link deeper engineering detail with relative repository links. Do not advertise unavailable features, claim unmeasured performance or accessibility results, or describe the license as open source.

## Documentation-update verification, 2026-11-12

- `npm test`: 270 tests passed, zero failed or skipped.
- `npm run build`: production build passed.
- `git diff --check`: passed; all 17 relative file links in the three edited documents resolved locally.
- Live website: HTTP 200 and Folio HTML title/wordmark checked. Browser interaction, desktop packaging and deployment were not retested for this documentation-only update.

Only README.md, docs/PLAN.md and this project-state document are changed. Application code, settings and deployment remain untouched.

## Primary references

- [GitHub: Using your GitHub profile to enhance your resume](https://docs.github.com/en/account-and-profile/tutorials/using-your-github-profile-to-enhance-your-resume): project selection, concise README features/setup/demo/testing, About description/website/topics, and pinned projects.
- [GitHub: About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes): explain purpose and getting started, use relative links, and move longer detail into other documentation.
- [GitHub: Renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository): repository redirects, remote updates, project-site exceptions and the risk of reusing the old name.
- [MDN: Cross-origin data storage access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#cross-origin_data_storage_access): IndexedDB and Web Storage are origin-separated.
- Repository evidence: [product/build plan](PLAN.md), [deployment configuration](../wrangler.jsonc), [web app manifest](../public/manifest.webmanifest), [application HTML](../index.html), and [license](../LICENSE).

The bidirectional source link and transition checklist are project recommendations based on these references, not requirements imposed by GitHub. Repository renaming, publication, deployment and stored-data migration remain separate tasks. Existing license terms remain unchanged.
