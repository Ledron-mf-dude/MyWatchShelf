# Regression pass — OWNER (Alice), after the fixes

Common rules: `qa-common.md` (read it first; the catalogue may or may not be reachable today).
You are Alice: `http://alice2.localhost:8769/?emu=alice2` (already signed in; if not, sign in via the account
menu). Your shelf has 14 titles, collections «Аніме», «Нове», «Для Богдана», friends Богдан and Віка with ratings.
Reload the page first (hard reload if the old version seems cached).

For EACH check answer: FIXED / NOT FIXED / PARTLY, with what you saw. Be strict: a fix that works but is
confusing is PARTLY with the reason.

## Collections (section «Рекомендації»)
1. «Нова добірка» with the name of an existing collection («Аніме», also try «аніме») → must be refused with a clear message; nothing changes.
2. «Редагувати» on a card: rename «Для Богдана» → «Богдану»; add one title, remove one; save. The card shows the new name/content. Open the OLD link you had before the rename — does it still open the collection? (Take the link from the share dialog BEFORE renaming.) What does the new link look like?
3. In the build dialog: tick 3 titles by hand, then switch a condition on and off — manual ticks must survive.
4. New condition chip «Лише з позначкою „раджу“» works; rows «у планах» / «без оцінки» are marked.
5. Years: only «from» = from that year on; letters cannot be typed; the count updates while typing; reversed range is swapped.
6. Name field: counter, Enter saves. Conditions block does not hide the result list.
7. Share dialog texts differ for: general recommendations / hand-picked / by conditions — and are true. On phone (375 px) nothing overflows; the dialog does not change width between tabs.
8. «Сформувати знову»: change the shelf first (e.g. give «Your Name.» a score so it matches or not); the confirmation names the titles; afterwards the share dialog does NOT open; a card with pending changes shows a badge.
9. Add a title to a condition-based collection from the title card, then «Сформувати знову» — it must stay.
10. Delete-collection confirmation text is accurate for a signed-in owner.
11. «Як бачить гість» opens in a new tab and shows a banner that it is your own list, no "100% match with yourself"; as the signed-in owner you can see friends' ratings there.

## Friends («Друзі»)
12. Header counts friends and titles; the visibility state line is on the page. «Змінити» → turning ON asks for confirmation that mentions earlier ratings; toast after; turning OFF — toast, no confirmation. Leave it OFF at the end.
13. A cell where Bogdan both rated your title and recommends it (Breaking Bad, Arcane) shows both, with both comments. Recommendation-only rows (The Dark Knight, Inception) are grouped separately. Comments are visible without hovering.
14. Person filter: «Сер.» column hidden / count follows the filter. Header stays visible when scrolling.
15. «Усі оцінки» in a title card (open it from «Друзі» and from the library) → goes to the row and highlights it.
16. «Керувати друзями»: for Bogdan — the list of what is remembered, with links; «×» on one remembered collection; «Прибрати рекомендації» asks, then really removes (turning anything back on must not resurrect them); for Віка (who never shared a link) there is NO «Показувати рекомендації» toggle.
17. «Сховати» Віку: dialog with an unchecked checkbox about deleting ratings; hide WITHOUT the checkbox → column disappears; restore from the hidden list → column and ALL her ratings are back (Frieren 3, Spirited Away 5, Attack on Titan 10, Demon Slayer 6,5). Do NOT tick the checkbox.
18. Phone: «Друзі» and «Рекомендації» are in the bottom tabs and fit; the friends table needs no sideways scrolling; long comments readable.

## Small things
19. Wording: no «від Аліса», no «його рекомендації», no «ще не бачив», one name for creating/editing a collection.
20. A toast does not survive navigation and does not cover the bottom card's main button.
21. If the catalogue is unreachable: «Показати на прикладі» on a fresh host (`http://demo3.localhost:8769/?emu=demo3`, do not sign in) still fills the shelf and reports the real count; search shows an error with retry.

Final message: the table of 21 checks (FIXED / NOT FIXED / PARTLY + one line each), then NEW problems you
noticed (numbered, with steps), then anything you could not check.
