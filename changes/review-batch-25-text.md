Fixed: Text boxes and captions: Increase Font Size and Decrease Font Size on a selection with text of different sizes now steps each part from its own size, instead of making it all one size.
Fixed: Typing with an input method (Chinese, Japanese, accents) over selected text now takes one Undo, and the selected text stays in place until the new text is confirmed.
Fixed: Text with both an outline and a shadow: every word now has its shadow in justified text and in text with character spacing, not only the first.
Fixed: Copy and paste: font names with quotes no longer break the copied text's formatting, tabs are copied as tabs, and numbered lists keep their letters and roman numbers (A., I., i., (a)) when pasted into Word.
Fixed: Copy and paste: pasted web text no longer starts the line after a line break with a space, and preformatted text keeps its line breaks and indents.
Fixed: Document: a long word broken at soft hyphens or by automatic hyphenation is broken again where the rest still does not fit the line, and words with digits (such as triethylamine-d15) are not hyphenated.
Fixed: Document: Word's character effects (border, emphasis marks, emboss, hollow letters) now show in right-to-left text, glows in a theme color are drawn, and the caret and selection after a soft hyphen are in the right place.
Fixed: Typing and Spelling: a locant is no longer made bold after "compound" while a name is typed (compound 4-nitrophenol), and a word finished with Tab gets the same italic and bold formatting as one finished with a space.
Fixed: Typing and Spelling: words left as written or kept in the dictionary are no longer formatted again as you type, an R number after an alkyl dash (t-BuCO2R1) is raised, and typing in a very long text with no spaces is no longer slowed down.
Fixed: Spelling and Grammar: words with a curly apostrophe (O’Neil) can be added to the dictionary or ignored, a failed load of the word lists is tried again later instead of turning the check off until restart, and a label such as the A in "Figure 1A" or "Compound A" is no longer reported as a wrong article.
Fixed: Insert ▸ Symbol: typing a single capital letter in the search box offers that capital, not its small letter.
Under the hood: Tests for the text, typing, spelling and clipboard fixes of code review batch 25.
