use std::{
    io,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use browser_native_protocol::{DesktopListener, bind_desktop_listener};
use interprocess::local_socket::{ListenerNonblockingMode, traits::Listener as _};

use crate::{
    browser_bridge::{ApprovalBroker, handle_connection},
    state::AppState,
};

const LISTENER_POLL: Duration = Duration::from_millis(25);

pub(crate) struct BrowserBridgeRuntime {
    stop: Arc<AtomicBool>,
    listener_thread: Mutex<Option<JoinHandle<()>>>,
}

impl BrowserBridgeRuntime {
    #[cfg(test)]
    pub(crate) fn inactive() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
            listener_thread: Mutex::new(None),
        }
    }

    pub(crate) fn start(app_state: AppState, broker: Arc<ApprovalBroker>) -> io::Result<Self> {
        let listener = bind_desktop_listener()?;
        Self::start_with_listener(listener, app_state, broker)
    }

    pub(crate) fn start_with_listener(
        listener: DesktopListener,
        app_state: AppState,
        broker: Arc<ApprovalBroker>,
    ) -> io::Result<Self> {
        listener.set_nonblocking(ListenerNonblockingMode::Accept)?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let listener_thread = thread::Builder::new()
            .name("nian-pass-browser-listener".to_owned())
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok(stream) => {
                            let connection_state = app_state.clone();
                            let connection_broker = broker.clone();
                            let _connection = thread::Builder::new()
                                .name("nian-pass-browser-connection".to_owned())
                                .spawn(move || {
                                    let _result = handle_connection(
                                        stream,
                                        &connection_state,
                                        &connection_broker,
                                    );
                                });
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::park_timeout(LISTENER_POLL);
                        }
                        Err(_) => break,
                    }
                }
            })?;
        Ok(Self {
            stop,
            listener_thread: Mutex::new(Some(listener_thread)),
        })
    }

    pub(crate) fn shutdown(&self) {
        self.stop.store(true, Ordering::Release);
        if let Some(handle) = self
            .listener_thread
            .lock()
            .ok()
            .and_then(|mut thread| thread.take())
        {
            let _joined = handle.join();
        }
    }
}

impl Drop for BrowserBridgeRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}
