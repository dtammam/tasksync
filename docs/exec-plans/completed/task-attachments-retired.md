# Task Attachments Retirement

Date: 2026-02-22
Status: Completed

## Summary

Task-level binary attachments were reviewed after implementation and validation.
The feature was retired and removed from active product behavior because real usage requirements were low relative to long-term complexity and maintenance cost.

## Decision

- Keep task `url` references as the lightweight way to associate external files/resources.
- Remove task binary-attachment UI, task attachment sync payloads, task attachment API handling, and attachment-specific tests.
- Keep historical migration history as-is; active runtime no longer exposes task attachment behavior.

## Why

- Low expected usage for binary uploads.
- Ongoing cost in payload size handling, sync complexity, and test surface.
- URL references satisfy core practical need with lower risk and lower carry cost.

## Outcome

- Task planning remains URL-first and offline-capable.
- Sync and backup payloads are simplified for task entities.
- Product scope is intentionally narrower and easier to maintain.
