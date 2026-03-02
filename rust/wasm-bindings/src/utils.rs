// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/// Set panic hook for better error messages in the browser
pub fn set_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Yield to the browser event loop using MessageChannel instead of setTimeout.
/// MessageChannel.postMessage fires as a macrotask WITHOUT the 4ms minimum
/// delay that browsers impose on nested setTimeout(0) calls. For 100+ batches
/// this saves ~400-500ms compared to gloo_timers::TimeoutFuture.
pub async fn yield_now() {
    use wasm_bindgen::prelude::*;

    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let channel = web_sys::MessageChannel::new().expect("MessageChannel");
        let port2 = channel.port2();
        let cb = Closure::once_into_js(move |_: web_sys::MessageEvent| {
            let _ = resolve.call0(&JsValue::NULL);
        });
        port2.set_onmessage(Some(cb.unchecked_ref()));
        channel
            .port1()
            .post_message(&JsValue::NULL)
            .expect("postMessage");
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
}
