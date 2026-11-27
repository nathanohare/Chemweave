// Quitting on a Mac (⌘Q, the app menu's Quit, the Dock, logging out, a quit sent by a script)
// ends the app with -[NSApplication terminate:], which closes no window: the page was never asked
// about unsaved work. This adds applicationShouldTerminate: to the app's delegate (Tauri has none).
// It answers "later" and closes the main window, as its red button does, so the page asks
// (onCloseRequested in src/main.ts). Once the window has gone the answer is "yes"; if the person
// cancels, the page says so (quit_cancelled) and the answer is "no". A logout or restart waits for
// that answer, and is not stopped when there is nothing to ask about.

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, ffi, msg_send, sel};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, WindowEvent};

static APP: OnceLock<AppHandle> = OnceLock::new();
/// A quit is waiting for its answer.
static WAITING: AtomicBool = AtomicBool::new(false);

// NSApplicationTerminateReply
const NOW: usize = 1;
const LATER: usize = 2;

type ShouldTerminate = extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize;

extern "C-unwind" fn should_terminate(_delegate: &AnyObject, _sel: Sel, _app: &AnyObject) -> usize {
    // with the main window already closed there is nothing left to ask about
    let Some(app) = APP.get() else { return NOW };
    let Some(window) = app.get_webview_window("main") else {
        return NOW;
    };
    // (the question about unsaved work has to be seen)
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    // (set before the close: the window's Destroyed handler reads it)
    WAITING.store(true, Ordering::SeqCst);
    if window.close().is_err() {
        WAITING.store(false, Ordering::SeqCst);
        return NOW;
    }
    LATER
}

/// A slide show's audience window, or the app would stay open behind the main one. Closed only
/// once the quit is certain (the main window has gone): if the person cancels, the show goes on.
fn close_other_windows() {
    let Some(app) = APP.get() else { return };
    for (label, other) in app.webview_windows() {
        if label != "main" {
            let _ = other.destroy();
        }
    }
}

/// Answer a waiting quit (on the main thread).
fn answer(quit: bool) {
    if !WAITING.swap(false, Ordering::SeqCst) {
        return;
    }
    // SAFETY: NSApplication's own method, on the main thread, while it waits for this reply.
    unsafe {
        let ns: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![ns, replyToApplicationShouldTerminate: quit];
    }
}

/// The person chose Cancel when asked about unsaved work.
pub fn cancelled() {
    answer(false);
}

pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if let Some(window) = app.get_webview_window("main") {
        window.on_window_event(|event| {
            if matches!(event, WindowEvent::Destroyed) {
                if WAITING.load(Ordering::SeqCst) {
                    close_other_windows();
                }
                answer(true);
            }
        });
    }
    // SAFETY: called on the main thread (the app's setup). The method's signature matches the
    // type encoding: it returns an NSUInteger and takes the application.
    unsafe {
        let ns: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![ns, delegate];
        let Some(delegate) = delegate.as_ref() else {
            return;
        };
        let method: ShouldTerminate = should_terminate;
        let class = delegate.class() as *const AnyClass as *mut AnyClass;
        let _ = ffi::class_addMethod(
            class,
            sel!(applicationShouldTerminate:),
            std::mem::transmute::<ShouldTerminate, Imp>(method),
            c"Q@:@".as_ptr(),
        );
        // (AppKit notes what its delegate answers to when it is set)
        let _: () = msg_send![ns, setDelegate: delegate];
    }
}
