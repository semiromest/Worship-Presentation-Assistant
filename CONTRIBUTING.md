# Contributing to Worship Presentation Assistant

Contributions that help worship teams prepare and present reliably are welcome: bug reports, accessibility improvements, translations, documentation, tests and focused code changes.

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md). For usage questions, see [Support](SUPPORT.md). Report vulnerabilities privately using the [Security Policy](SECURITY.md).

## Before you start

- Search existing [issues](https://github.com/semiromest/Worship-Presentation-Assistant/issues) and [pull requests](https://github.com/semiromest/Worship-Presentation-Assistant/pulls).
- For a substantial feature or architecture change, open a feature request first so its scope can be discussed. Small fixes and documentation corrections can go straight to a pull request.
- Keep the interface simple. Prefer extending an existing control or workflow when it solves the problem clearly.
- Describe the user problem and an example of the expected behavior. Reports in English or Turkish are welcome.

## Development setup

Use Node.js 22, npm, Git and Git LFS. Windows and macOS are the configured installer targets; identify Linux reports as source-build reports.

```sh
git clone https://github.com/semiromest/Worship-Presentation-Assistant.git
cd Worship-Presentation-Assistant
git lfs install
git lfs pull
npm ci
```

Create the git-ignored `src/main/driveCredentials.ts`. The module must exist even when Google Drive is unused; these empty values allow development without OAuth setup:

```ts
export const DRIVE_CREDENTIALS = {
  clientId: '',
  clientSecret: '',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  redirectPort: 0,
};
```

Then run `npm run dev` to start Vite and Electron. See the [developer documentation](README.md#for-developers) for packaging and platform details. Keep personal credentials and tokens out of commits.

## Making a change

- Branch from the current default branch and keep each pull request focused on one problem.
- Follow the surrounding TypeScript, React and CSS conventions. Avoid unrelated formatting, dependency upgrades and generated output.
- Keep privileged operations in Electron's main process, expose only the required preload API, and update shared API types when that contract changes.
- Preserve presentation data, media references, undo/redo and the separation between the selected slide and the live output. A change must not unexpectedly interrupt an ongoing service.
- Keep practice sessions isolated from normal user data and live output.
- Add user-facing text to all five locale files under `src/renderer/locales/`: English, Turkish, German, Spanish and Korean. Preserve interpolation variables and key structure.
- Use original or appropriately licensed sample content. Do not commit private service presentations, copyrighted lyrics or Bible datasets without permission.

## Validation

Run checks appropriate to the change and record their results in the pull request. For code changes, a useful baseline is:

```sh
npm run check:locales
npx tsc --noEmit --incremental false
```

Add or update regression tests when behavior changes, then run the relevant scripts from `package.json`, such as `npm run test:editor`, `npm run test:media` or `npm run test:sections`. `npm run test:unit` runs the discovered unit tests. There is no `npm test` script.

For interface changes, include a screenshot or short recording and describe the manual checks. For live-output changes, explain the display setup and confirm the effect on the audience output as well as the control window. State any checks you could not run and why; do not report an unrun check as passing.

Documentation-only changes normally need a review of links, commands and formatting rather than application tests. The [README test section](README.md#tests) describes the broader source and packaged checks.

## Submitting a pull request

1. Summarize the problem and resulting behavior. Link the related issue if there is one.
2. Include relevant validation, screenshots and any platform limitations.
3. Remove secrets, personal information, generated builds and unrelated changes from the diff.
4. Use the pull request template and respond to review feedback.

Maintainers may request revisions or decline a proposal that does not fit the project's scope. Contributions are reviewed as time permits; opening a pull request does not guarantee inclusion in a release.

The project uses the [MIT License](LICENSE). Submit only work you are entitled to contribute under that license, and retain required third-party notices.
