"""Build the explicit-install GNOME companion; never install or enable it silently."""
from pathlib import Path
import sys
import zipfile

FILES = ("metadata.json", "extension.js", "policy.js", "pixels.js")
def package(destination):
    source = Path(__file__).resolve().parent / "gnome"
    contents = {name: (source / name).read_bytes() for name in FILES}
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "aevra-desktop@the-long-ride.shell-extension.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for name, value in contents.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 15, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, value)
    return target

KDE_FILES = ("CMakeLists.txt", "metadata.json", "policy.h", "grant_store.h", "policy_test.cpp", "bridge.h", "bridge.cpp", "device.h", "device.cpp", "pixels.h", "pixels.cpp", "README.md")

def package_kde(destination):
    source = Path(__file__).resolve().parent / "kde"
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "aevra-wayland-kde-source.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for name in KDE_FILES:
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 15, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, (source / name).read_bytes())
    return target

if __name__ == "__main__":
    print(package(Path(sys.argv[1])))
    print(package_kde(Path(sys.argv[1])))
