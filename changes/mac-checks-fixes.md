Fixed: Desktop app: File ▸ Print works again on a Mac and on Linux; it stopped with "Command plugin:webview|print not allowed by ACL".
Fixed: Slides: Slide Show ▸ Record asks for the microphone on a Mac (it was refused without asking, so narration could not be recorded).
Fixed: Slides: ⌘Q quits during a full-screen slide show on a Mac; the show ends first, so the question about unsaved work can be seen.
Under the hood: a check that every desktop-app command the app's code can reach is allowed by its permissions and registered.
Under the hood: the Mac installer (.dmg) is notarized and stapled too, not just the app inside it.
Fixed: Desktop app: with Title Bar in Menu Bar on, every empty part of the menu bar moves the window, not just thin strips at its edges.
