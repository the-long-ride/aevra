"""Export the canonical helper delta without creating an upstream commit.
Run: python helper/export-desktop-overlay.py ../aevra-desktop --sync
--sync updates only an exact, previously generated overlay; local drift aborts.
"""
from pathlib import Path
import argparse
import difflib
import hashlib
import json
import subprocess


def text(path):
    return path.read_text(encoding="utf-8") if path.exists() else None


def sha(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest() if value is not None else None


def export(desktop, sync):
    source = Path(__file__).resolve().parent.parent
    vendor = desktop / "vendor/aevra"
    output = desktop / "patches"
    manifest_path = output / "helper-parity.json"
    old = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else None
    revision = subprocess.check_output(["git", "-C", str(vendor), "rev-parse", "HEAD"], text=True).strip()
    if old and old["baseRevision"] != revision:
        raise RuntimeError("Pinned base changed; review the source integration before exporting")
    if sync:
        if not old:
            raise RuntimeError("Apply the initial reviewed overlay with prepare-helper before syncing")
        for file in old["files"]:
            if sha(text(vendor / file["path"])) != file["after"]:
                raise RuntimeError(f"Preserve local edits: {file['path']} differs from previous generated overlay")
    files = [p for p in [source / "helper/Cargo.toml", source / "helper/Cargo.lock"] if p.exists()]
    files += list((source / "helper/src").glob("*.rs"))
    files += list((source / "helper/tests/fixtures").glob("PortableMacFixture.swift"))
    files += list((source / "helper/tests/fixtures").glob("portable_gtk_fixture.py"))
    companion = {"extension.js", "pixels.js", "policy.js", "policy.test.mjs", "metadata.json"}
    files += [p for p in (source / "helper/wayland/gnome").glob("*") if p.name in companion]
    kde = {"CMakeLists.txt", "metadata.json", "policy.h", "grant_store.h", "policy_test.cpp", "bridge.h", "bridge.cpp", "device.h", "device.cpp", "pixels.h", "pixels.cpp", "README.md"}
    files += [p for p in (source / "helper/wayland/kde").glob("*") if p.name in kde]
    files += [p for p in [source / "helper/wayland/package-companion.py"] if p.exists()]
    files += [p for p in [source / "helper/setup-macos.mjs", source / "helper/tests/macos-build.test.mjs", source / "helper/tests/library_contract.rs", source / "helper/tests/run-wayland-gnome.sh", source / "helper/tests/run-wayland-kde.sh"] if p.exists()]
    files += [p for p in (source / "helper/tests/fixtures").glob("*") if p.name in {"portable_wayland_fixture.py", "gnome_control.js"}]
    previous = {entry["path"] for entry in old["files"]} if old else set()
    baseline = subprocess.run(["git", "-C", str(vendor), "ls-tree", "-r", "--name-only", revision, "--", "helper"], capture_output=True, check=True).stdout.decode("utf-8").splitlines()
    def managed(path):
        p = Path(path)
        return (not p.is_absolute() and ".." not in p.parts and
                (path in {"helper/Cargo.toml", "helper/Cargo.lock", "helper/tests/fixtures/PortableMacFixture.swift", "helper/tests/fixtures/portable_gtk_fixture.py", "helper/tests/fixtures/portable_wayland_fixture.py", "helper/tests/fixtures/gnome_control.js", "helper/wayland/package-companion.py", "helper/tests/run-wayland-gnome.sh", "helper/tests/run-wayland-kde.sh", "helper/setup-macos.mjs", "helper/tests/macos-build.test.mjs", "helper/tests/library_contract.rs"}
                 or (p.parent.as_posix() == "helper/wayland/kde" and p.name in kde)
                 or (p.parent.as_posix() == "helper/wayland/gnome" and p.name in companion)
                 or (p.parent.as_posix() == "helper/src" and p.suffix == ".rs")))
    if any(not managed(path) for path in previous):
        raise RuntimeError("Invalid managed helper path in previous manifest")
    paths = {file.relative_to(source).as_posix() for file in files} | previous
    paths |= {path for path in baseline if managed(path)}
    manifest = {"baseRevision": revision, "origin": "aevra/helper canonical source; export-desktop-overlay.py", "files": []}
    patch = []
    updates = []
    for path in sorted(paths):
        result = subprocess.run(["git", "-C", str(vendor), "show", f"{revision}:{path}"], capture_output=True)
        before = result.stdout.decode("utf-8").replace("\r\n", "\n") if result.returncode == 0 else None
        after = text(source / path)
        if sync and path not in previous:
            if sha(text(vendor / path)) != sha(before):
                raise RuntimeError(f"Preserve local edits: {path} has no verified generated baseline")
        # Reverted modifications and removed generated additions still need a
        # target update, even though they no longer belong in the patch.
        if sync and text(vendor / path) != after:
            updates.append((vendor / path, after))
        if before == after:
            continue
        manifest["files"].append({"path": path, "before": sha(before), "after": sha(after)})
        patch.append(f"diff --git a/{path} b/{path}\n")
        if before is None:
            patch.append("new file mode 100644\n")
        if after is None:
            patch.append("deleted file mode 100644\n")
        for line in difflib.unified_diff((before or "").splitlines(True), (after or "").splitlines(True),
            fromfile=f"a/{path}" if before is not None else "/dev/null", tofile=f"b/{path}" if after is not None else "/dev/null"):
            patch.append(line if line.endswith("\n") else line + "\n\\ No newline at end of file\n")
    # Validate every source and target before the first write.
    if sync:
        for file, content in updates:
            if content is None:
                file.unlink(missing_ok=True)
            else:
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content, encoding="utf-8", newline="\n")
    output.mkdir(exist_ok=True)
    (output / "helper-parity.patch").write_text("".join(patch), encoding="utf-8", newline="\n")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Exported {len(manifest['files'])} canonical helper files; sync={sync}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("desktop", type=Path)
    parser.add_argument("--sync", action="store_true")
    args = parser.parse_args()
    export(args.desktop.resolve(), args.sync)
