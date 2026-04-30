# Submission To Issue Publication Journey

This scenario describes the product-level loop covered by `tests/admin-contract.test.js`.

## Actors

- Submitter: creates a submission through `/submit` and may revise unaccepted submissions through the original token link.
- Editor: reviews submissions, normalizes authors, creates manuscripts, builds issue drafts, and edits published content.
- Technical reviewer: reviews full issue drafts and can run content checks.
- Chief editor: publishes approved issue drafts and manages operator access.

## Journey

1. Submitter uploads `index.md` and resources, previews the work, submits it without choosing a target volume or folder, and receives a token status link.
2. Editor can copy the submission link or move an unaccepted submission out of the review queue; while the submission is not accepted, the submitter edits files locally and uploads a complete replacement package as revision 2.
3. Editor accepts the submission, creates or binds the official author, and turns the submission into a manuscript.
4. The accepted manuscript is immediately available for issue planning; the retired single-manuscript review endpoint returns `410`.
5. Editor can issue a manuscript edit link; the edit link can download the source package and submit a simple `index.md` edit; the editor can accept the pending edit, create an issue draft, add the available manuscript, verify that the same manuscript cannot be scheduled into a second issue draft, and open the issue preview.
6. Editor submits the issue draft for review; technical reviewer approves the full issue.
7. Chief editor publishes the approved issue draft, which writes the article into `contents/published`.
8. Editor can adopt a manuscript edit for the published article, then edit, unpublish and restore it through the private archive.
9. Chief editor disables a reviewer account; audit log records the critical events.

## Acceptance

- Reader APIs show the article only while it is published.
- Submitter APIs expose only public submission-review records.
- Manuscripts cannot bypass issue drafts for publication.
- A scheduled manuscript cannot be added to another active issue draft.
- Accepted submissions leave the initial review queue, and unaccepted submissions can be removed from the queue without deleting the submitter link.
- Manuscript deletion succeeds only for unreferenced manuscripts and is blocked for scheduled or published manuscripts.
- Private admin content remains unreachable through `/contents/admin/**`.
- Content contract lint passes after the full journey.
