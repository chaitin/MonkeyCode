# Verify MonkeyCode desktop UI

1. Run `cd desktop/ui && npm run build`.
2. Run `cd desktop/ui && npm test -- --run`.
3. For desktop preview changes, launch the desktop app and drive the affected preview interaction in the shell; browser mode cannot exercise native preview capture.
4. Confirm both the happy path and cancellation/repeated pointer-release edge path.
