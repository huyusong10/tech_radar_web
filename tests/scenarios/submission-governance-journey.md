# Submission To Issue Publication Journey

This scenario describes the product-level loop covered by `tests/admin-contract.test.js`.

## Actors

- Submitter: creates a submission through `/submit` and later revises it through a token link.
- Editor: reviews submissions, normalizes authors, creates manuscripts, builds issue drafts, and edits published content.
- Technical reviewer: reviews single manuscripts and full issue drafts.
- Chief editor: publishes approved issue drafts and manages operator access.

## Journey

1. Submitter uploads `index.md` and resources, previews the work, submits it without choosing a target volume or folder, and receives a token status link.
2. Editor requests changes during submission review; submitter edits files locally and uploads a complete replacement package as revision 2.
3. Editor accepts the submission, creates or binds the official author, and turns the submission into a manuscript.
4. Technical reviewer approves the manuscript, making it available for issue planning.
5. Editor creates an issue draft, adds the available manuscript, verifies that the same manuscript cannot be scheduled into a second issue draft, and opens the issue preview.
6. Editor submits the issue draft for review; technical reviewer approves the full issue.
7. Chief editor publishes the approved issue draft, which writes the article into `contents/published`.
8. Editor edits the published article, then unpublishes and restores it through the private archive.
9. Chief editor disables a reviewer account; audit log records the critical events.

## Acceptance

- Reader APIs show the article only while it is published.
- Submitter APIs expose only public submission-review records.
- Manuscripts cannot bypass issue drafts for publication.
- A scheduled manuscript cannot be added to another active issue draft.
- Private admin content remains unreachable through `/contents/admin/**`.
- Content contract lint passes after the full journey.
