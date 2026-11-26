# Regression pass — a NEW FRIEND (Dana), after the fixes

Common rules: `qa-common.md` (read it first; the catalogue may or may not be reachable today).
You are a brand-new person: `http://dana.localhost:8769/?emu=dana` (open once with `?emu=`; empty shelf).
The owner is Alice. Her links (already with your hostname):
- General: http://dana.localhost:8769/#u=XFlZePhQCJ1rT69RU3Ksq18APCi0
- «Аніме»: http://dana.localhost:8769/#u=XFlZePhQCJ1rT69RU3Ksq18APCi0&l=%D0%90%D0%BD%D1%96%D0%BC%D0%B5
- «Нове»: http://dana.localhost:8769/#u=XFlZePhQCJ1rT69RU3Ksq18APCi0&l=%D0%9D%D0%BE%D0%B2%D0%B5
(Another tester, playing Alice, is working at the same time and may rename/edit her other collection and
briefly toggle the "friends see each other's ratings" switch — note what you see if the page changes.)

For EACH check answer: FIXED / NOT FIXED / PARTLY, with what you saw. Be strict.

1. Signed out, first visit: the page language follows the browser; the header has an account button (sign-in, language); one «Моя полиця» button. Is it said what signing in gives and who will see your scores?
2. Click «Увійти, щоб оцінити» → after sign-in the 1–10 scale appears BY ITSELF on all cards (no second click). Try it twice (sign out via the account menu and repeat).
3. First rating without a signature: the name dialog explains that ALICE will see this name. Press «Скасувати» → the chosen score must NOT vanish: it stays marked as not sent with a way to finish. Then give the name «Дана» → the score is sent.
4. Every rating shows a state: sending → saved. Rate a title and reload/leave within one second, several times with different titles → after returning, is the score there? Does the browser warn when leaving with an unsent rating?
5. Comment: multi-line field, explicit save, saved state, Enter saves; long comment (300+ chars) readable afterwards.
6. Remove a score with the visible «×»/«прибрати». Then press «Надіслати мої оцінки» (if offered): a preview lists what will be sent; the score you removed is NOT in it.
7. Privacy line under the hero says who sees your scores (currently only Alice). If Alice opens ratings while you are there, a noticeable notice appears (may not happen during your run — then say "not observed").
8. Rate a title you do not have → the card offers to add it with that score; «Собі у список» of a rated title adds it as «Переглянуто» with the score (check in your library). Rate a title that IS on your shelf with a different score → your shelf score follows and the page says so.
9. Taste-match block: no percentage with fewer than 3 commonly rated titles; badges «збіг / близько / розійшлись» match the actual difference.
10. «Запам'ятати»: gives a toast with a way to «Друзі», turns into «Запам'ятано ✓»; in your «Друзі» → «Керувати друзями» you see what is remembered (general / «Аніме») as links back to Alice's lists, and can forget one.
11. Broken links: empty id (`#u=`), wrong id, real id with an unknown collection (`&l=Нема`) → friendly distinct messages, no technical text, tab title not stale.
12. Phone (375 px): score buttons comfortably tappable; author's score next to the title; comment field usable; friends' ratings block (if visible) readable.
13. Rating does not make the whole list flash or jump; closing a title preview keeps the scroll position.
14. Leave the list page with an unsent/unsigned rating state and go to the library — no dialog pops up there later.
15. Your own «Друзі» page as a signed-in user with one remembered friend: readable, comments visible, «Сер.» column absent for a single friend.

Final message: the table of 15 checks (FIXED / NOT FIXED / PARTLY + one line each), the list of scores and
comments you left on Alice's lists, then NEW problems (numbered, with steps), then anything you could not check.
