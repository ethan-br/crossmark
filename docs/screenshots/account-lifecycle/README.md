# Account lifecycle screenshots

Captured from the packaged Chromium extension using `node scripts/account-lifecycle-screenshots.mjs` after `npm run build:chromium`. The script uses an isolated temporary profile, fixture account state and mocked runtime responses. It sends no email, makes no backend requests and never submits account deletion. These images show UI states; backend behavior is covered separately by the auth route tests.

- [Sign in](sign-in.png): added Forgot password action.
- [Request reset](request-reset.png): enter the account email.
- [Reset password](reset-password.png): email response, reset code and new password.
- [Settings](account-settings.png): password and deletion action alongside existing recovery controls. Viewport expanded vertically to show all settings.
- [Deletion confirmation](delete-confirmation.png): permanent deletion warning and cancel action, at the 340px popup width.
