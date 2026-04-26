# Submission Governance Journey

This scenario describes the product-level loop covered by `tests/admin-contract.test.js`.

## Actors

- Submitter: creates a first draft through `/submit` and later revises it through a token link.
- Editor: receives the submission, assigns ownership, issues a replacement status link, manages authors and edits published content.
- Technical reviewer: runs checks and returns public review feedback before approving.
- Chief editor: publishes, unpublishes, restores, rolls back content, and manages operator access.

## Journey

1. Submitter uploads `index.md` and resources, submits the draft, and receives a token status link.
2. Editor accepts the submission, assigns it, and can issue a new status link when the original link is lost.
3. Technical reviewer requests public changes; internal editor comments stay hidden from the submitter.
4. Submitter edits Markdown directly on the status page, deletes an obsolete resource, and submits revision 2.
5. Editor sends the revised draft back to technical review; reviewer approves it.
6. Chief editor runs publish checks, resolves the temporary author, and publishes the article.
7. Editor merges duplicate author records and edits the published article with resource changes.
8. Chief editor rolls the article back from a saved snapshot, then unpublishes and restores it from the private archive.
9. Chief editor disables and re-enables a reviewer account; audit log records the critical events.

## Acceptance

- Reader APIs show the article only while it is published.
- Submitter APIs expose only public review records.
- Private admin content remains unreachable through `/contents/admin/**`.
- Content contract lint passes after the full journey.
