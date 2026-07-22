# Agent Restart Dialog Keyboard Navigation Design

## Context

Issue #910 reports that the Agent restart confirmation dialog cannot move focus between its Cancel and Confirm actions with the left and right arrow keys. Issue #862 and PR #863 established the expected behavior for the equivalent slash-command confirmation dialog.

## Scope

Apply the existing slash-command dialog keyboard interaction to both Agent restart modes:

- Restart Agent while preserving context.
- Restart Agent and clear context.

The restart request, loading state, close behavior, copy, and visual layout remain unchanged.

## Interaction Design

The restart dialog owns refs for its Cancel and Confirm actions. A keydown handler on `AlertDialogContent` implements these transitions:

- `ArrowLeft` prevents the default action and focuses Cancel.
- `ArrowRight` prevents the default action and focuses Confirm.
- `Enter` keeps the native behavior of the focused action.
- `Tab`, `Shift+Tab`, and `Escape` continue to use Radix AlertDialog behavior.

The Confirm control uses `AlertDialogAction`, matching the slash-command confirmation dialog and preserving the existing async click handler and disabled state.

## Implementation

Modify `frontend/src/pages/console/user/task/task-detail.tsx`:

1. Add refs for the restart Cancel and Confirm actions.
2. Add a restart-dialog keydown handler beside the existing restart callbacks.
3. Attach the handler to the restart `AlertDialogContent`.
4. Attach the refs to both actions.
5. Replace the restart Confirm `Button` with `AlertDialogAction`.

No shared UI primitive changes or unrelated dialog refactors are included.

## Verification

Add a focused regression test that verifies:

- The restart dialog binds its keydown handler.
- `ArrowLeft` focuses Cancel and prevents the default action.
- `ArrowRight` focuses Confirm and prevents the default action.
- Both controls expose refs and Confirm uses `AlertDialogAction`.
- The existing restart callback, submitting guard, spinner, and disabled state remain present.

Run the focused test, frontend lint for changed files, and the online frontend build. Start a preview from the issue branch for manual verification of both restart modes.
