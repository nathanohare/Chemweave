Fixed: Slides: changing the effect of an animation picked in the Animation pane keeps its trigger (On Click of …) and its by-paragraph setting. The Animation Painter no longer paints an object onto itself, and clearing the After box under Transitions no longer leaves a 0:00 timing behind.
Fixed: Slides: in Slide Master view the panel shows right away what a click in it changed (Bold, Italic, Align, Own colors, Logo, ↺ buttons), and the ↺ beside Style is one Undo step.
Fixed: Slides: pressing OK in a sound or video's Playback window keeps its narration mark and every other setting the window does not show, so narration is still found by Clear Narration, Show without narration and the Slide Sorter.
Fixed: Slides: in Outline View, Ctrl+Enter and Shift+Tab to a new slide now show the new row and leave every row on its own slide (the old rows could write one slide's text into another). Shift+Tab to a new slide is one Undo step.
Fixed: Slides: in the slide show one scroll of a trackpad (however long it coasts), or one notch of a wheel, moves one slide or animation instead of running through many, and the wheel over rehearsal notes and the show bars scrolls them as before.
Fixed: Slides: Rehearse Timings stops timing the last slide when you go past it, not when you leave the End of Slide Show screen; a slide visited twice keeps the time of its last visit, and the total matches. Stopping a show while the microphone opens, or starting a rehearsal just after another one, no longer leaves a rehearsal clock or Keep Timings question behind.
Fixed: Slides: Repeat on the End of Slide Show screen of a rehearsal does nothing, and a slide shown again from a black or white screen is timed again.
Fixed: Slides: at a kiosk a number then Enter no longer jumps to a slide; only Esc and clicks on links and buttons do anything.
Fixed: Slides: Set Up Show gives back your Loop and Manually choices when you pick another show type after trying Kiosk.
Fixed: Slides: following a link out of a zoomed section no longer plays the zoom back out on the next click; the laser pointer dot goes when the mouse leaves the slide; a pen stroke being drawn when the slide changes stays on the slide it began on.
Fixed: Slides: Presenter View with one screen opens the audience window as a window instead of covering the presenter's own screen when the app can't tell which screen it is on.
Fixed: Slides: editing a theme keeps the title slide's own footer color and picture or gradient background when you leave its colors alone.
Fixed: Slides: Animate Reaction's Import Pairing is one Undo step, and the window no longer says "Saved" when the file could not be written.
Fixed: Canvas: a number typed in Scheme Format is applied when you click on the drawing to close the window; + Add in the Smart Scheme species list no longer uses a row last typed in on another scheme, and dragging its title stops when the drag is cancelled.
Fixed: Spreadsheet: duplicating a chart tile on a dashboard no longer makes both charts save the same data to Excel; typing more than 24 Columns keeps the tiles inside the grid; the last column of a table tile can't be unchecked (that showed every column).
Changed: Slides: Reuse Slides and View ▸ Notes Page open at once and draw their slide pictures a few at a time.
Changed: Spreadsheet: Insert ▸ All Charts opens at once and draws its charts a few at a time, waiting until you stop changing the selection. Tables on a dashboard sort long text columns faster.
Under the hood: new tests check each of these fixes.
