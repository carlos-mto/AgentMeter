// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Retired browser integrations must not open another Dashboard.
    if std::env::args()
        .nth(1)
        .is_some_and(|arg| arg.starts_with("chrome-extension://"))
    {
        return;
    }
    agentmeter_lib::run()
}
