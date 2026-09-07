## What this changes

<!-- In the terms a user would use. "Half-siblings drawn under the wrong connector" beats
     "fix TreeLayoutEngine offset". -->

## Why

<!-- What was wrong, or what could not be done before. Link the issue if there is one. -->

Closes #

## How it was tested

<!-- Which of these you ran, and what you exercised by hand. -->

- [ ] `./gradlew testDebugUnitTest`
- [ ] `./gradlew lintDebug`
- [ ] `./gradlew connectedDebugAndroidTest` (needed if you touched `data/`, `transfer/`, or a screen)
- [ ] Exercised by hand on a device

<!-- Screenshots for anything visual, before and after. -->

## Checklist

- [ ] It does one thing.
- [ ] Logic that could be wrong lives in `graph/` or `transfer/` and has a JVM test.
- [ ] The notation is unchanged, or the change is applied everywhere: brass means *not known*,
      a doubled rule means marriage, a dashed edge means an unrecorded name — in both charts,
      the compact view and the web viewer.
- [ ] No new dependency, or it was agreed in an issue first.
- [ ] The `.ftree` format and the database schema are unchanged, or a migration is included and the
      format's compatibility rules still hold.
- [ ] Style matches the surrounding file.

<!-- Thanks for contributing. -->
