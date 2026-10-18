//! Kernel authentication for hardened compositors whose /proc/exe is unreadable.

pub(super) fn socket_peer(expected: u32) -> bool {
    use std::os::unix::net::UnixStream;
    let Some(display) = std::env::var_os("WAYLAND_DISPLAY") else {
        return false;
    };
    let display = std::path::PathBuf::from(display);
    let path = if display.is_absolute() {
        display
    } else {
        let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") else {
            return false;
        };
        std::path::PathBuf::from(runtime).join(display)
    };
    let Ok(socket) = UnixStream::connect(path) else {
        return false;
    };
    authenticated_socket(&socket, expected)
}
fn authenticated_socket(socket: &std::os::unix::net::UnixStream, expected: u32) -> bool {
    use std::os::fd::AsRawFd;
    let mut credentials: libc::ucred = unsafe { std::mem::zeroed() };
    let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SO_PEERCRED is filled by the kernel for this connected Unix socket.
    let ok = unsafe {
        libc::getsockopt(
            socket.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut size,
        )
    };
    ok == 0
        && size as usize == std::mem::size_of::<libc::ucred>()
        && credentials.pid > 0
        && credentials.pid as u32 == expected
        && credentials.uid == unsafe { libc::getuid() }
        && credentials.uid == unsafe { libc::geteuid() }
}

#[test]
fn kernel_socket_identity_refuses_a_different_bus_owner() {
    let (socket, _server) = std::os::unix::net::UnixStream::pair().unwrap();
    let pid = std::process::id();
    assert!(authenticated_socket(&socket, pid));
    assert!(!authenticated_socket(&socket, pid.wrapping_add(1)));
}
